//! Recursive inbox folder scan (spec 005, T-RecursiveScanImpl).
//! Each leaf directory containing at least one FITS or XISF file becomes one
//! `ScannedInboxItem`. Intermediate folders containing only sub-folders are
//! not items. Video-only folders produce items with `lane = "video"`.
//!
//! Spec 040 Phase 2a: detected calibration masters in a leaf folder are
//! extracted from the folder group and represented as individual
//! `ScannedMasterFile` entries within the same `ScannedInboxItem`. The
//! persist layer (inbox_scan_folder command) then creates individual
//! `inbox_items` rows for each master and a single grouped row for the
//! remaining sub-frames.
//!
//! Constitution §I: symlinks/junctions are NOT followed unless explicitly
//! enabled (default: false). Hashing is lazy — only the 64 KB partial read
//! used for content signatures.
#![allow(clippy::doc_markdown)]

use std::path::{Path, PathBuf};

use calibration_master_detect::{detect_master, DetectInput, MasterDetection};
use metadata_core::MetadataExtractor;
use metadata_fits::FitsExtractor;
use metadata_video::is_video_extension;
use metadata_xisf::XisfExtractor;

use super::signature::compute_content_signature;

// ── FileFormat ────────────────────────────────────────────────────────────────

/// The actual file format detected during scan.
///
/// Distinct from `Lane` — a FITS lane may contain either FITS or XISF files,
/// or a mix. This enum carries the real format so the UI can display it
/// accurately instead of always showing "FITS".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileFormat {
    /// `.fits` / `.fit` / `.fts`
    Fits,
    /// `.xisf`
    Xisf,
    /// Video files (`.ser`, `.avi`, etc.)
    Video,
    /// Folder contains both FITS and XISF files.
    Mixed,
}

impl FileFormat {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            FileFormat::Fits => "fits",
            FileFormat::Xisf => "xisf",
            FileFormat::Video => "video",
            FileFormat::Mixed => "mixed",
        }
    }
}

/// Derive the folder-level format from the file lists.
fn folder_format(
    fits_files: &[PathBuf],
    xisf_files: &[PathBuf],
    video_files: &[PathBuf],
) -> FileFormat {
    let has_fits = !fits_files.is_empty();
    let has_xisf = !xisf_files.is_empty();
    let has_video = !video_files.is_empty();

    match (has_fits || has_xisf, has_video) {
        (true, _) if has_fits && has_xisf => FileFormat::Mixed,
        (true, _) if has_xisf => FileFormat::Xisf,
        (false, true) => FileFormat::Video,
        // (true, _) FITS-only, plus the (false, false) fallback.
        _ => FileFormat::Fits,
    }
}

/// Derive per-file format from extension.
fn file_format_from_ext(ext: &str) -> FileFormat {
    match ext {
        "xisf" => FileFormat::Xisf,
        "fits" | "fit" | "fts" => FileFormat::Fits,
        _ => FileFormat::Video,
    }
}

// ── ScannedMasterFile ─────────────────────────────────────────────────────────

/// A single calibration master file detected during scan within a leaf folder.
///
/// Each master becomes its own `inbox_items` row (spec 040 FR-005, FR-006).
#[derive(Clone, Debug)]
pub struct ScannedMasterFile {
    /// Absolute path to the master file.
    pub abs_path: PathBuf,
    /// Relative path from the scan root (= the key for the inbox_items row).
    pub relative_path: String,
    /// File format (Fits or Xisf).
    pub format: FileFormat,
    /// Master detection result (frame type, detector provenance).
    pub detection: MasterDetection,
    /// Filter extracted from metadata, if available.
    pub filter: Option<String>,
    /// Exposure in seconds extracted from metadata, if available.
    pub exposure_s: Option<f64>,
}

// ── ScannedInboxItem ──────────────────────────────────────────────────────────

/// A leaf folder discovered during an inbox scan.
#[derive(Clone, Debug)]
pub struct ScannedInboxItem {
    /// Absolute path to the leaf folder.
    pub folder_path: PathBuf,
    /// Relative path from the scan root.
    pub relative_path: String,
    /// FITS (.fits/.fit/.fts) files inside this folder (direct children only).
    ///
    /// Does NOT include XISF files (those are in `xisf_files`).
    pub fits_files: Vec<PathBuf>,
    /// XISF files inside this folder (direct children only).
    pub xisf_files: Vec<PathBuf>,
    /// Video files in this folder.
    pub video_files: Vec<PathBuf>,
    /// Content signature of the folder (computed from FITS/XISF files only).
    pub content_signature: String,
    /// Classification lane.
    pub lane: Lane,
    /// Folder-level format (Fits | Xisf | Mixed | Video).
    pub format: FileFormat,
    /// Calibration masters detected within this folder.
    ///
    /// Each entry becomes its own `inbox_items` row. The remaining non-master
    /// FITS/XISF files are grouped into the folder-level row.
    pub masters: Vec<ScannedMasterFile>,
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

const FITS_ONLY_EXTENSIONS: &[&str] = &["fits", "fit", "fts"];
const XISF_EXTENSIONS: &[&str] = &["xisf"];

fn is_fits_extension(ext: &str) -> bool {
    FITS_ONLY_EXTENSIONS.contains(&ext)
}

fn is_xisf_extension(ext: &str) -> bool {
    XISF_EXTENSIONS.contains(&ext)
}

// ── Master detection at scan time ─────────────────────────────────────────────

/// Attempt to extract metadata and detect whether `path` is a calibration
/// master.  Called only for FITS/XISF files in leaf folders.
///
/// Returns `Some(ScannedMasterFile)` when the file is identified as a master.
/// Returns `None` when not a master or metadata is unreadable.
fn try_detect_master(abs_path: &Path, rel_path: &str, ext: &str) -> Option<ScannedMasterFile> {
    // Extract metadata — same extractors used by classify.rs.
    let bundle = if XisfExtractor.supports_extension(ext) {
        XisfExtractor.extract(abs_path).ok().flatten()?
    } else if FitsExtractor.supports_extension(ext) {
        FitsExtractor.extract(abs_path).ok().flatten()?
    } else {
        return None;
    };

    let image_typ_raw = bundle.image_typ.as_deref();
    let stack_count = bundle.stack_count;
    let file_name = abs_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    let detect_input = DetectInput { imagetyp: image_typ_raw, stack_count, file_name, rel_path };

    let detection = detect_master(&detect_input)?;

    if !detection.is_master {
        return None;
    }

    let format = file_format_from_ext(ext);
    let filter = bundle.filter.clone();
    let exposure_s = bundle.exposure.as_deref().and_then(|v| v.parse::<f64>().ok());

    Some(ScannedMasterFile {
        abs_path: abs_path.to_owned(),
        relative_path: rel_path.to_owned(),
        format,
        detection,
        filter,
        exposure_s,
    })
}

// ── scan_root ────────────────────────────────────────────────────────────────

/// Recursively scan `root` and return one `ScannedInboxItem` per leaf folder
/// that directly contains FITS/XISF or video files.
///
/// For FITS-lane folders, master detection is run per-file so that detected
/// masters can be split into individual `inbox_items` rows by the caller.
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
    let mut xisf_files: Vec<PathBuf> = Vec::new();
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

            if is_fits_extension(&ext) {
                fits_files.push(path);
            } else if is_xisf_extension(&ext) {
                xisf_files.push(path);
            } else if is_video_extension(&ext) {
                video_files.push(path);
            }
        }
    }

    let all_image_files: Vec<&PathBuf> = fits_files.iter().chain(xisf_files.iter()).collect();

    if !all_image_files.is_empty() || !video_files.is_empty() {
        // This is a leaf with content — make it an InboxItem.
        let relative_path = dir
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let (lane, sig_files) = if all_image_files.is_empty() {
            let sig_refs: Vec<&Path> = video_files.iter().map(PathBuf::as_path).collect();
            (Lane::Video, compute_content_signature(&sig_refs))
        } else {
            let sig_refs: Vec<&Path> = all_image_files.iter().map(|p| p.as_path()).collect();
            (Lane::Fits, compute_content_signature(&sig_refs))
        };

        let format = folder_format(&fits_files, &xisf_files, &video_files);

        // Run master detection for FITS-lane folders only.
        // Performance: we only open files that have calibration-like metadata;
        // detection returns None quickly for unreadable or non-calib files.
        let masters: Vec<ScannedMasterFile> = if lane == Lane::Fits {
            all_image_files
                .iter()
                .filter_map(|abs_path| {
                    let ext = abs_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let rel = abs_path
                        .strip_prefix(root)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default();
                    try_detect_master(abs_path, &rel, &ext)
                })
                .collect()
        } else {
            vec![]
        };

        items.push(ScannedInboxItem {
            folder_path: dir.to_owned(),
            relative_path,
            fits_files,
            xisf_files,
            video_files,
            content_signature: sig_files,
            lane,
            format,
            masters,
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
        // xisf_files list populated, fits_files empty
        assert_eq!(items[0].xisf_files.len(), 1);
        assert_eq!(items[0].fits_files.len(), 0);
    }

    #[test]
    fn non_directory_root_returns_error() {
        let tmp = tmpdir();
        let file_path = tmp.path().join("not_a_dir.fits");
        write_file(tmp.path(), "not_a_dir.fits", b"x");
        let err = scan_root(&file_path, &ScanOptions::default());
        assert!(err.is_err());
    }

    #[test]
    fn format_fits_for_fits_only_folder() {
        let tmp = tmpdir();
        write_file(tmp.path(), "dark_001.fits", b"f1");
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items[0].format, FileFormat::Fits);
    }

    #[test]
    fn format_xisf_for_xisf_only_folder() {
        let tmp = tmpdir();
        write_file(tmp.path(), "dark_001.xisf", b"f1");
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items[0].format, FileFormat::Xisf);
    }

    #[test]
    fn format_mixed_for_folder_with_fits_and_xisf() {
        let tmp = tmpdir();
        write_file(tmp.path(), "dark_001.fits", b"f1");
        write_file(tmp.path(), "dark_002.xisf", b"f2");
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items[0].format, FileFormat::Mixed);
    }

    #[test]
    fn format_video_for_video_only_folder() {
        let tmp = tmpdir();
        let planetary = tmp.path().join("p");
        fs::create_dir_all(&planetary).unwrap();
        write_file(&planetary, "jupiter.ser", b"SER");
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items[0].format, FileFormat::Video);
    }

    /// Non-FITS dummy files yield no masters (metadata unreadable → None).
    #[test]
    fn no_masters_for_dummy_fits_content() {
        let tmp = tmpdir();
        write_file(tmp.path(), "dark_001.fits", b"not a real fits file");
        let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].masters.is_empty(), "dummy file cannot be a master");
    }
}
