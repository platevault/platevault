//! Recursive inbox folder scan (spec 005, T-RecursiveScanImpl).
//!
//! Each leaf directory containing at least one FITS or XISF file becomes one
//! `ScannedInboxItem`. Intermediate folders containing only sub-folders are
//! not items. Video-only folders produce items with `lane = "video"`.
//!
//! Constitution §I: symlinks/junctions are NOT followed unless explicitly
//! enabled (default: false). Hashing is lazy — only the 64 KB partial read
//! used for content signatures.
#![allow(clippy::doc_markdown)]

use std::path::{Path, PathBuf};

use metadata_video::is_video_extension;

use super::signature::compute_content_signature;

// ── ScannedInboxItem ──────────────────────────────────────────────────────────

/// A leaf folder discovered during an inbox scan.
#[derive(Clone, Debug)]
pub struct ScannedInboxItem {
    /// Absolute path to the leaf folder.
    pub folder_path: PathBuf,
    /// Relative path from the scan root.
    pub relative_path: String,
    /// Absolute paths to FITS/XISF files inside this folder (direct children only).
    pub fits_files: Vec<PathBuf>,
    /// Video files in this folder.
    pub video_files: Vec<PathBuf>,
    /// Content signature of the folder (computed from FITS/XISF files only).
    pub content_signature: String,
    /// Classification lane.
    pub lane: Lane,
}

/// Whether this item should be classified as FITS or routed to the video lane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lane {
    Fits,
    Video,
}

impl Lane {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Lane::Fits => "fits",
            Lane::Video => "video",
        }
    }
}

// ── ScanOptions ───────────────────────────────────────────────────────────────

/// Options controlling the scan behaviour.
#[derive(Clone, Debug, Default)]
pub struct ScanOptions {
    /// Follow symlinks/junctions. Default `false` per constitution §I.
    pub follow_symlinks: bool,
}

// ── FITS / XISF extensions ────────────────────────────────────────────────────

const FITS_EXTENSIONS: &[&str] = &["fits", "fit", "fts", "xisf"];

fn is_fits_or_xisf_extension(ext: &str) -> bool {
    let lower = ext.to_ascii_lowercase();
    FITS_EXTENSIONS.contains(&lower.as_str())
}

// ── scan_root ────────────────────────────────────────────────────────────────

/// Recursively scan `root` and return one `ScannedInboxItem` per leaf folder
/// that directly contains FITS/XISF or video files.
///
/// Intermediate folders are not items. Symlinks are not followed unless
/// `options.follow_symlinks = true`.
///
/// # Errors
///
/// Returns an error string if `root` is not a directory or cannot be read.
pub fn scan_root(root: &Path, options: &ScanOptions) -> Result<Vec<ScannedInboxItem>, String> {
    if !root.is_dir() {
        return Err(format!("scan root is not a directory: {}", root.display()));
    }

    let mut items = Vec::new();
    scan_dir(root, root, options, &mut items)?;
    Ok(items)
}

fn scan_dir(
    root: &Path,
    dir: &Path,
    options: &ScanOptions,
    items: &mut Vec<ScannedInboxItem>,
) -> Result<(), String> {
    let read_dir = std::fs::read_dir(dir)
        .map_err(|e| format!("cannot read directory {}: {e}", dir.display()))?;

    let mut fits_files: Vec<PathBuf> = Vec::new();
    let mut video_files: Vec<PathBuf> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();

    for entry in read_dir.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };

        if file_type.is_symlink() && !options.follow_symlinks {
            // Constitution §I: skip symlinks unless explicitly enabled.
            continue;
        }

        if file_type.is_dir()
            || (file_type.is_symlink() && options.follow_symlinks && path.is_dir())
        {
            subdirs.push(path);
        } else if file_type.is_file() || (file_type.is_symlink() && options.follow_symlinks) {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

            if is_fits_or_xisf_extension(&ext) {
                fits_files.push(path);
            } else if is_video_extension(&ext) {
                video_files.push(path);
            }
        }
    }

    if !fits_files.is_empty() || !video_files.is_empty() {
        // This is a leaf with content — make it an InboxItem.
        let relative_path = dir
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let (lane, sig_files) = if fits_files.is_empty() {
            let sig_refs: Vec<&Path> = video_files.iter().map(PathBuf::as_path).collect();
            (Lane::Video, compute_content_signature(&sig_refs))
        } else {
            let sig_refs: Vec<&Path> = fits_files.iter().map(PathBuf::as_path).collect();
            (Lane::Fits, compute_content_signature(&sig_refs))
        };

        items.push(ScannedInboxItem {
            folder_path: dir.to_owned(),
            relative_path,
            fits_files,
            video_files,
            content_signature: sig_files,
            lane,
        });
    }

    // Always recurse into subdirs regardless of whether this dir has files.
    for subdir in subdirs {
        scan_dir(root, &subdir, options, items)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn tmpdir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_file(dir: &Path, name: &str, content: &[u8]) {
        let path = dir.join(name);
        let mut f = fs::File::create(path).unwrap();
        f.write_all(content).unwrap();
    }

    #[test]
    fn single_light_folder() {
        let tmp = tmpdir();
        write_file(tmp.path(), "light_001.fits", b"dummy fits content");
        write_file(tmp.path(), "light_002.fits", b"dummy fits content 2");

        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].fits_files.len(), 2);
        assert_eq!(items[0].lane, Lane::Fits);
    }

    #[test]
    fn recursive_subfolders_produce_leaf_items() {
        let tmp = tmpdir();
        let lights = tmp.path().join("lights");
        let darks = tmp.path().join("darks");
        fs::create_dir_all(&lights).unwrap();
        fs::create_dir_all(&darks).unwrap();

        write_file(&lights, "light_001.fits", b"l1");
        write_file(&darks, "dark_001.fits", b"d1");

        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 2, "each leaf folder is one item");
    }

    #[test]
    fn intermediate_folder_without_files_is_not_an_item() {
        let tmp = tmpdir();
        let sub = tmp.path().join("date").join("target").join("lights");
        fs::create_dir_all(&sub).unwrap();
        write_file(&sub, "frame.fits", b"f");

        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 1, "only the leaf with fits file is an item");
        assert!(items[0].folder_path.ends_with("lights"));
    }

    #[test]
    fn video_files_routed_to_video_lane() {
        let tmp = tmpdir();
        let planetary = tmp.path().join("planetary");
        fs::create_dir_all(&planetary).unwrap();
        write_file(&planetary, "jupiter.ser", b"SER data");

        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].lane, Lane::Video);
        assert_eq!(items[0].video_files.len(), 1);
    }

    #[test]
    fn empty_root_returns_no_items() {
        let tmp = tmpdir();
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn xisf_files_included_in_fits_lane() {
        let tmp = tmpdir();
        write_file(tmp.path(), "frame.xisf", b"XISF0100 data");

        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].lane, Lane::Fits);
        assert_eq!(items[0].fits_files.len(), 1);
    }

    #[test]
    fn non_directory_root_returns_error() {
        let tmp = tmpdir();
        let file_path = tmp.path().join("not_a_dir.fits");
        write_file(tmp.path(), "not_a_dir.fits", b"x");
        let err = scan_root(&file_path, &ScanOptions::default());
        assert!(err.is_err());
    }
}
