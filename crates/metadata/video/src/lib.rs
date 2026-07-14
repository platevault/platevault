// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Video file detection for the Inbox `video` lane (spec 005 T-VideoDetect).
//!
//! This crate performs extension-based detection only. No pixel or container
//! parsing is done here. Files with video extensions are routed to
//! `lane = "video"` in the inbox scan and are NOT subject to FITS/XISF
//! classification.
//!
//! Out-of-scope for spec 005: planetary/lunar metadata extraction, SER header
//! parsing, frame-count/duration extraction. Those belong to a future spec.
//! (Ref: R-Video-1, T-VideoLaneDocs)
#![allow(clippy::doc_markdown)]

use std::path::Path;

/// A video file record discovered during an inbox scan.
///
/// Contains path metadata only; no frame content is inspected here.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoFileRecord {
    /// Absolute or root-relative path to the file.
    pub path: std::path::PathBuf,
    /// File name (last component of `path`).
    pub file_name: String,
    /// Lower-case extension without the leading dot.
    pub extension: String,
}

/// Video extensions recognized for inbox `lane = "video"` routing.
///
/// `.ser` — SharpCap, FireCapture, ZWO, ASIAIR planetary capture
/// `.avi` — legacy Windows video container (various)
/// `.mp4` — modern compressed video
/// `.mov` — QuickTime container (macOS capture tools)
const VIDEO_EXTENSIONS: &[&str] = &["ser", "avi", "mp4", "mov"];

/// Returns `true` if the given file extension (without dot, case-insensitive)
/// is recognized as a video format.
#[must_use]
pub fn is_video_extension(ext: &str) -> bool {
    let lower = ext.trim().to_ascii_lowercase();
    VIDEO_EXTENSIONS.contains(&lower.as_str())
}

/// Returns `true` if the file at `path` should be routed to the video lane,
/// based purely on its extension.
///
/// Does not inspect the file contents; does not require the file to exist.
#[must_use]
pub fn is_video_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(is_video_extension)
}

/// Build a [`VideoFileRecord`] from a path.
///
/// Returns `None` if the path does not have a recognized video extension.
pub fn video_record(path: impl Into<std::path::PathBuf>) -> Option<VideoFileRecord> {
    let path = path.into();
    if !is_video_file(&path) {
        return None;
    }
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_owned();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

    Some(VideoFileRecord { path, file_name, extension })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_ser_extension() {
        assert!(is_video_extension("ser"));
        assert!(is_video_extension("SER"));
        assert!(is_video_extension("Ser"));
    }

    #[test]
    fn recognizes_avi_mp4_mov() {
        assert!(is_video_extension("avi"));
        assert!(is_video_extension("AVI"));
        assert!(is_video_extension("mp4"));
        assert!(is_video_extension("MP4"));
        assert!(is_video_extension("mov"));
        assert!(is_video_extension("MOV"));
    }

    #[test]
    fn rejects_fits_and_xisf() {
        assert!(!is_video_extension("fits"));
        assert!(!is_video_extension("fit"));
        assert!(!is_video_extension("xisf"));
    }

    #[test]
    fn is_video_file_checks_extension() {
        assert!(is_video_file(Path::new("/astro/planetary/Jupiter_2025.ser")));
        assert!(is_video_file(Path::new("capture.AVI")));
        assert!(!is_video_file(Path::new("light_frame.fits")));
        assert!(!is_video_file(Path::new("noext")));
    }

    #[test]
    fn video_record_returns_none_for_non_video() {
        assert!(video_record(Path::new("frame.fits")).is_none());
    }

    #[test]
    fn video_record_builds_correctly() {
        let rec = video_record(Path::new("/data/Jupiter.ser")).unwrap();
        assert_eq!(rec.file_name, "Jupiter.ser");
        assert_eq!(rec.extension, "ser");
    }
}
