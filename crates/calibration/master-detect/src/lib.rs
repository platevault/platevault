// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration master detection (spec 040, FR-001..FR-004).
//!
//! # Architecture
//!
//! An extensible registry of [`MasterDetector`] implementations. Each detector
//! encapsulates tool-specific heuristics for determining whether a file is a
//! calibration master and what base frame type it carries.
//!
//! The public entry point is [`detect_master`]: it runs each registered
//! detector in order and returns the first match (first-wins). Callers that
//! only need the result do not need to know about individual detectors.
//!
//! Adding support for a new capture/processing tool requires only:
//! 1. Implementing `MasterDetector` in a new module.
//! 2. Appending an instance to the `Vec` returned by [`detectors`].
//!
//! No changes are needed in `classify` or any other caller (SC-004).
//!
//! # Dependency boundary
//!
//! This crate depends **only** on `metadata_core` for [`FrameType`]. It must
//! NOT depend on `domain_core`, `persistence_db`, or any UI crates (FR-003).
#![allow(clippy::doc_markdown)]

use metadata_core::FrameType;

mod pixinsight;
mod siril;

pub use pixinsight::PixInsightDetector;
pub use siril::SirilDetector;

// ── Public API ────────────────────────────────────────────────────────────────

/// Input supplied to each detector.
///
/// All string slices are borrowed from the caller; the struct is intentionally
/// cheap to build (no allocation).
pub struct DetectInput<'a> {
    /// Raw `IMAGETYP` header value, if present.
    pub imagetyp: Option<&'a str>,
    /// Value of `STACKCNT` or `NCOMBINE` (prefer `STACKCNT` when both exist).
    pub stack_count: Option<u32>,
    /// Bare file name (without directory), e.g. `"masterDark_300s.xisf"`.
    pub file_name: &'a str,
    /// Relative path from the library root, e.g. `"masters/masterDark.xisf"`.
    pub rel_path: &'a str,
}

/// Result produced by a successful detection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MasterDetection {
    /// Normalised base frame type (Light / Dark / Bias / Flat / DarkFlat).
    pub frame_type: FrameType,
    /// Whether this file is a stacked master (as opposed to a raw sub-frame).
    pub is_master: bool,
    /// Identifier of the detector that produced this result (provenance).
    pub detector: &'static str,
}

/// Trait implemented by each per-tool detector.
pub trait MasterDetector: Send + Sync {
    /// A short, stable, lowercase identifier, e.g. `"siril"` or `"pixinsight"`.
    fn id(&self) -> &'static str;

    /// Attempt to detect a master from the given input.
    ///
    /// Returns `Some(detection)` when this detector can determine the frame
    /// type (with or without master status); returns `None` when the input
    /// provides insufficient information for this tool.
    fn detect(&self, input: &DetectInput<'_>) -> Option<MasterDetection>;
}

/// Return the ordered list of registered detectors.
///
/// Detectors are tried in order; the first `Some` result wins. Add new
/// detectors at the end to keep the existing priority unchanged.
#[must_use]
pub fn detectors() -> Vec<Box<dyn MasterDetector>> {
    vec![Box::new(PixInsightDetector), Box::new(SirilDetector)]
}

/// Run all registered detectors in priority order and return the first match.
///
/// Returns `None` only when no detector could determine even the base frame
/// type from the supplied input.
#[must_use]
pub fn detect_master(input: &DetectInput<'_>) -> Option<MasterDetection> {
    for detector in detectors() {
        if let Some(result) = detector.detect(input) {
            return Some(result);
        }
    }
    None
}

// ── Shared base-frame-type parser ─────────────────────────────────────────────

/// Parse a raw `IMAGETYP` string into a [`FrameType`].
///
/// Rules (case-insensitive, trims whitespace):
/// - Contains "dark flat" or "darkflat" → `DarkFlat`
/// - Contains "dark"                    → `Dark`
/// - Contains "bias" or "offset"        → `Bias`
/// - Contains "flat"                    → `Flat`
/// - Contains "light" or "science"      → `Light`
///
/// The "master" word is stripped before matching so that `"Master Dark"`,
/// `"Dark Frame"`, etc. all normalise correctly.
#[must_use]
pub fn parse_frame_type(raw: &str) -> Option<FrameType> {
    // Strip "master" (word boundary not needed — just remove the substring)
    let normalised =
        raw.to_ascii_lowercase().replace("master", "").replace("frame", "").replace("frames", "");
    let s = normalised.trim().to_owned();

    // Dark flat must be checked before dark and flat individually.
    if s.contains("dark flat") || s.contains("darkflat") {
        return Some(FrameType::DarkFlat);
    }
    if s.contains("dark") {
        return Some(FrameType::Dark);
    }
    if s.contains("bias") || s.contains("offset") {
        return Some(FrameType::Bias);
    }
    if s.contains("flat") {
        return Some(FrameType::Flat);
    }
    if s.contains("light") || s.contains("science") || s.contains("object") {
        return Some(FrameType::Light);
    }
    None
}

/// Return `true` if the lowercased path or file name suggests a master.
///
/// Matches when either component contains `"master"` or `"_stacked"`.
#[must_use]
pub fn path_looks_like_master(file_name: &str, rel_path: &str) -> bool {
    let name_lc = file_name.to_ascii_lowercase();
    let path_lc = rel_path.to_ascii_lowercase();
    name_lc.contains("master")
        || name_lc.contains("_stacked")
        || path_lc.contains("master")
        || path_lc.contains("_stacked")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frame_type_dark_variants() {
        assert_eq!(parse_frame_type("DARK"), Some(FrameType::Dark));
        assert_eq!(parse_frame_type("Dark Frame"), Some(FrameType::Dark));
        assert_eq!(parse_frame_type("dark frames"), Some(FrameType::Dark));
        assert_eq!(parse_frame_type("Master Dark"), Some(FrameType::Dark));
    }

    #[test]
    fn parse_frame_type_bias_and_offset() {
        assert_eq!(parse_frame_type("BIAS"), Some(FrameType::Bias));
        assert_eq!(parse_frame_type("Bias Frame"), Some(FrameType::Bias));
        assert_eq!(parse_frame_type("OFFSET"), Some(FrameType::Bias));
        assert_eq!(parse_frame_type("Offset Frame"), Some(FrameType::Bias));
    }

    #[test]
    fn parse_frame_type_flat_variants() {
        assert_eq!(parse_frame_type("FLAT"), Some(FrameType::Flat));
        assert_eq!(parse_frame_type("Flat Frame"), Some(FrameType::Flat));
        assert_eq!(parse_frame_type("Master Flat"), Some(FrameType::Flat));
    }

    #[test]
    fn parse_frame_type_dark_flat() {
        assert_eq!(parse_frame_type("Dark Flat"), Some(FrameType::DarkFlat));
        assert_eq!(parse_frame_type("darkflat"), Some(FrameType::DarkFlat));
        assert_eq!(parse_frame_type("DarkFlat Frame"), Some(FrameType::DarkFlat));
    }

    #[test]
    fn parse_frame_type_light_variants() {
        assert_eq!(parse_frame_type("Light Frame"), Some(FrameType::Light));
        assert_eq!(parse_frame_type("LIGHT"), Some(FrameType::Light));
        assert_eq!(parse_frame_type("science"), Some(FrameType::Light));
    }

    #[test]
    fn parse_frame_type_unknown_returns_none() {
        assert_eq!(parse_frame_type(""), None);
        assert_eq!(parse_frame_type("UNKNOWN"), None);
    }

    #[test]
    fn path_looks_like_master_positive() {
        assert!(path_looks_like_master("masterDark_300s.xisf", "masters/"));
        assert!(path_looks_like_master("dark_stacked.fit", "calibration/"));
        assert!(path_looks_like_master("dark.fit", "masters/masterDarks/"));
        assert!(path_looks_like_master("dark_Ha_stacked.xisf", ""));
    }

    #[test]
    fn path_looks_like_master_negative() {
        assert!(!path_looks_like_master("dark_001.fit", "calibration/darks/"));
        assert!(!path_looks_like_master("light_001.fits", "lights/"));
    }
}
