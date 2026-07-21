// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

use app_core_targets::metadata_cache::cached_extract;
use calibration_master_detect::{detect_master, DetectInput, MasterDetection};
use camino::Utf8Path;
use metadata_video::is_video_extension;

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

impl ScannedInboxItem {
    /// Files in this folder that classification still has to split, i.e. every
    /// file except the detected calibration masters, which become their own
    /// `inbox_items` rows.
    ///
    /// Carries the spec 058 FR-015 master carve-out: a masters-only folder must
    /// score 0 so `list_unclassified_source_groups` does not surface it as a
    /// scanned-but-unclassified row *in addition to* its master rows. The
    /// subtraction is sound only because `masters` is built by filtering
    /// `fits_files ∪ xisf_files` (see [`scan_dir`]); it is saturating so a
    /// future violation of that subset relation degrades to 0 rather than
    /// panicking.
    #[must_use]
    pub fn sub_frame_count(&self) -> usize {
        (self.fits_files.len() + self.xisf_files.len()).saturating_sub(self.masters.len())
            + self.video_files.len()
    }
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
    // Cached extract (F0): memoized by (path, mtime, size); unsupported
    // extensions and unparseable files both surface as `Err` here.
    let bundle = cached_extract(abs_path).ok()?;

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

/// Compute the root-relative path as a forward-slash UTF-8 string for the wire.
///
/// `path` is guaranteed UTF-8 here: every descendant of `root` passed the
/// non-UTF-8 skip at the `read_dir` boundary, so `Utf8Path::from_path` succeeds.
/// The previous implementation used `to_string_lossy`, which could silently
/// mangle a path; camino makes the conversion lossless by construction. The
/// `unwrap_or_else` fallback is defensive only and cannot fire for scanned
/// descendants.
fn relative_utf8(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    Utf8Path::from_path(rel)
        .map_or_else(|| rel.to_string_lossy().replace('\\', "/"), |u| u.as_str().replace('\\', "/"))
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

        // OS scan boundary: `read_dir` yields `std::path::PathBuf`, which can be
        // non-UTF-8 on a raw disk. We do not lossy-convert (that would corrupt the
        // path that later crosses the IPC boundary as a wire string). A non-UTF-8
        // entry is skipped explicitly with a diagnostic so the scan never panics
        // and never emits a mangled path. Constitution §I (Local-First custody).
        if Utf8Path::from_path(&path).is_none() {
            tracing::warn!(
                path = %path.to_string_lossy(),
                "inbox scan: skipping non-UTF-8 path (cannot represent as a faithful UTF-8 wire value)"
            );
            continue;
        }

        let Ok(file_type) = entry.file_type() else { continue };
        // Reparse-aware check (symlink + Windows junction) shared with
        // fs_inventory/fs_executor — see `fs_pathsafe` (duplication-and-
        // abstraction audit T1-a).
        let is_link = fs_pathsafe::is_link_or_junction(&path);

        if is_link && !options.follow_symlinks {
            // Constitution §I: skip symlinks/junctions unless explicitly enabled.
            continue;
        }

        if file_type.is_dir() || (is_link && options.follow_symlinks && path.is_dir()) {
            subdirs.push(path);
        } else if file_type.is_file() || (is_link && options.follow_symlinks) {
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
        let relative_path = relative_utf8(root, dir);

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
                    let rel = relative_utf8(root, abs_path);
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
    use metadata_core::{v1_normalization_table, FrameType};
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

    fn write_realistic_fits(
        dir: &Path,
        name: &str,
        imagetyp: Option<&str>,
        stack_count: Option<(&str, u32)>,
    ) {
        let mut cards = vec![
            "SIMPLE  =                    T".to_owned(),
            "BITPIX  =                   16".to_owned(),
            "NAXIS   =                    2".to_owned(),
            "NAXIS1  =                 6248".to_owned(),
            "NAXIS2  =                 4176".to_owned(),
            "INSTRUME= 'ZWO ASI2600MM Pro'".to_owned(),
            "TELESCOP= 'Esprit 100ED'".to_owned(),
            "DATE-OBS= '2026-07-09T22:14:31.125'".to_owned(),
            "EXPTIME =                300.0".to_owned(),
            "GAIN    =                  100".to_owned(),
            "OFFSET  =                   50".to_owned(),
            "FILTER  = 'Ha'".to_owned(),
            "OBJECT  = 'M42'".to_owned(),
            "XBINNING=                    1".to_owned(),
            "YBINNING=                    1".to_owned(),
        ];
        if let Some(value) = imagetyp {
            cards.push(format!("IMAGETYP= '{value}'"));
        }
        if let Some((key, value)) = stack_count {
            cards.push(format!("{key:<8}= {value:>20}"));
        }

        let mut block = vec![b' '; 2880];
        for (idx, card) in cards.iter().enumerate() {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            block[idx * 80..idx * 80 + len].copy_from_slice(&bytes[..len]);
        }
        let end = cards.len() * 80;
        block[end..end + 3].copy_from_slice(b"END");
        write_file(dir, name, &block);
    }

    struct PipelineCase {
        name: String,
        imagetyp: Option<&'static str>,
        stack_count: Option<(&'static str, u32)>,
        expected_type: FrameType,
        expected_master: bool,
        expected_detector: Option<&'static str>,
    }

    fn master_pipeline_cases() -> Vec<PipelineCase> {
        let types = [
            ("light", "LIGHT", FrameType::Light, "flat"),
            ("dark", "DARK", FrameType::Dark, "flat"),
            ("flat", "FLAT", FrameType::Flat, "dark"),
            ("bias", "BIAS", FrameType::Bias, "light"),
            ("darkflat", "DARKFLAT", FrameType::DarkFlat, "bias"),
        ];
        let mut cases = Vec::with_capacity(types.len() * 4);

        for (idx, (token, imagetyp, frame_type, conflicting_token)) in types.into_iter().enumerate()
        {
            cases.push(PipelineCase {
                name: format!("capture_{token}_001.fits"),
                imagetyp: Some(imagetyp),
                stack_count: None,
                expected_type: frame_type,
                expected_master: false,
                expected_detector: None,
            });
            cases.push(PipelineCase {
                name: format!("integration_{token}_030.fits"),
                imagetyp: Some(imagetyp),
                stack_count: Some((if idx % 2 == 0 { "STACKCNT" } else { "NCOMBINE" }, 30)),
                expected_type: frame_type,
                expected_master: true,
                expected_detector: Some("siril"),
            });
            cases.push(PipelineCase {
                name: format!("master_{token}.fits"),
                imagetyp: None,
                stack_count: None,
                expected_type: frame_type,
                expected_master: true,
                expected_detector: Some("pixinsight"),
            });
            cases.push(PipelineCase {
                name: format!("master_{conflicting_token}_header_{token}.fits"),
                imagetyp: Some(imagetyp),
                stack_count: None,
                expected_type: frame_type,
                expected_master: true,
                expected_detector: Some("pixinsight"),
            });
        }

        cases
    }

    #[test]
    fn realistic_headers_cover_master_permutations_through_scan_and_classify() {
        let cases = master_pipeline_cases();
        assert_eq!(cases.len(), 20, "five frame types must exercise four evidence paths each");

        for case in cases {
            let tmp = tmpdir();
            write_realistic_fits(tmp.path(), &case.name, case.imagetyp, case.stack_count);
            let path = tmp.path().join(&case.name);

            let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap();
            assert_eq!(items.len(), 1, "{}: scan must return its FITS folder", case.name);
            assert_eq!(
                items[0].masters.len(),
                usize::from(case.expected_master),
                "{}: scan-time master result",
                case.name
            );
            if let Some(master) = items[0].masters.first() {
                assert_eq!(master.detection.frame_type, case.expected_type, "{}", case.name);
                assert_eq!(
                    master.detection.detector,
                    case.expected_detector.unwrap(),
                    "{}",
                    case.name
                );
            }

            let classified =
                crate::classify::classify_one_file(&path, tmp.path(), &v1_normalization_table());
            assert_eq!(classified.frame_type, Some(case.expected_type), "{}", case.name);
            assert_eq!(classified.is_master, case.expected_master, "{}", case.name);
            if let Some(detector) = case.expected_detector {
                assert_eq!(classified.master_detector, Some(detector), "{}", case.name);
            }
        }
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

    /// Constitution §I regression: a symlinked subdirectory reachable from the
    /// scan root must not be traversed unless `follow_symlinks` is enabled.
    #[cfg(unix)]
    #[test]
    fn symlinked_subdir_not_traversed_by_default() {
        use std::os::unix::fs::symlink;

        let tmp = tmpdir();
        let real_target = tmp.path().join("real_target");
        fs::create_dir_all(&real_target).unwrap();
        write_file(&real_target, "hidden.fits", b"hidden");

        let scan_root_dir = tmp.path().join("scan_root");
        fs::create_dir_all(&scan_root_dir).unwrap();
        symlink(&real_target, scan_root_dir.join("linked")).unwrap();

        let items = scan_root(&scan_root_dir, &ScanOptions::default()).unwrap();
        assert!(items.is_empty(), "must not see files behind an un-enabled symlink");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_subdir_traversed_when_follow_symlinks_enabled() {
        use std::os::unix::fs::symlink;

        let tmp = tmpdir();
        let real_target = tmp.path().join("real_target");
        fs::create_dir_all(&real_target).unwrap();
        write_file(&real_target, "visible.fits", b"visible");

        let scan_root_dir = tmp.path().join("scan_root");
        fs::create_dir_all(&scan_root_dir).unwrap();
        symlink(&real_target, scan_root_dir.join("linked")).unwrap();

        let options = ScanOptions { follow_symlinks: true };
        let items = scan_root(&scan_root_dir, &options).unwrap();
        assert_eq!(items.len(), 1, "symlinked subdir is traversed when explicitly enabled");
    }

    /// Create a directory junction, the reparse-point kind `is_symlink()` does
    /// **not** report. Uses the `mklink /J` shell builtin (junctions need no
    /// admin privilege, unlike symlinks) rather than adding a dependency for
    /// two tests — the same approach as `fs_pathsafe`'s junction test.
    #[cfg(windows)]
    fn make_junction(link: &std::path::Path, target: &std::path::Path) {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", link.to_str().unwrap(), target.to_str().unwrap()])
            .status()
            .expect("mklink invocation failed");
        assert!(status.success(), "mklink /J failed to create the test junction");
    }

    /// Windows-only counterpart to the two `cfg(unix)` symlink tests above.
    ///
    /// The Unix tests give no evidence about Windows: a followed junction can
    /// walk the scan into a loop or onto an unrelated drive and produce inbox
    /// items the user never pointed at (constitution product constraints).
    #[cfg(windows)]
    #[test]
    fn junction_subdir_not_traversed_by_default() {
        let tmp = tmpdir();
        let real_target = tmp.path().join("real_target");
        fs::create_dir_all(&real_target).unwrap();
        write_file(&real_target, "hidden.fits", b"hidden");

        let scan_root_dir = tmp.path().join("scan_root");
        fs::create_dir_all(&scan_root_dir).unwrap();
        make_junction(&scan_root_dir.join("junction_to_target"), &real_target);

        let items = scan_root(&scan_root_dir, &ScanOptions::default()).unwrap();
        assert!(items.is_empty(), "must not see files behind an un-enabled junction");
    }

    /// The opt-in direction, mirroring
    /// `symlinked_subdir_traversed_when_follow_symlinks_enabled`.
    #[cfg(windows)]
    #[test]
    fn junction_subdir_traversed_when_follow_symlinks_enabled() {
        let tmp = tmpdir();
        let real_target = tmp.path().join("real_target");
        fs::create_dir_all(&real_target).unwrap();
        write_file(&real_target, "visible.fits", b"visible");

        let scan_root_dir = tmp.path().join("scan_root");
        fs::create_dir_all(&scan_root_dir).unwrap();
        make_junction(&scan_root_dir.join("junction_to_target"), &real_target);

        let options = ScanOptions { follow_symlinks: true };
        let items = scan_root(&scan_root_dir, &options).unwrap();
        assert_eq!(items.len(), 1, "junction is traversed when explicitly enabled");
    }
}
