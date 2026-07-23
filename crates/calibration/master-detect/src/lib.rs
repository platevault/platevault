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
//! detector in order. A detector whose determination rests on authoritative
//! header evidence (`STACKCNT`/`NCOMBINE`) wins regardless of registry order;
//! otherwise the first `Some` result wins. Callers that only need the result
//! do not need to know about individual detectors.
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
    /// Whether `is_master` was determined from an authoritative header
    /// integration count (`STACKCNT`/`NCOMBINE`) rather than from a file
    /// name or path naming convention.
    ///
    /// Header counts are hard facts read from the FITS/XISF header; naming
    /// conventions are inference and can be wrong (renamed files, generic
    /// tool defaults). [`detect_master`] lets decisive header evidence from
    /// any registered detector outrank a naming-only (or no-evidence) match
    /// returned by an earlier detector in the registry (issue #753).
    pub stack_count_evidence: bool,
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
/// Detectors are tried in order; absent decisive header evidence (see
/// [`detect_master`]), the first `Some` result wins. Add new detectors at the
/// end to keep the existing priority unchanged.
#[must_use]
pub fn detectors() -> Vec<Box<dyn MasterDetector>> {
    vec![Box::new(PixInsightDetector), Box::new(SirilDetector)]
}

/// Run all registered detectors and return the strongest match.
///
/// A result backed by decisive header evidence
/// (`MasterDetection::stack_count_evidence`) wins immediately, even if a
/// weaker (naming-convention or no-evidence) result was already produced by
/// an earlier detector in the registry — header facts must not be shadowed by
/// registry ordering (issue #753). When no detector reports header evidence,
/// the first `Some` result wins, preserving prior behaviour.
///
/// Returns `None` only when no detector could determine even the base frame
/// type from the supplied input.
#[must_use]
pub fn detect_master(input: &DetectInput<'_>) -> Option<MasterDetection> {
    let mut fallback = None;
    for detector in detectors() {
        if let Some(result) = detector.detect(input) {
            if result.stack_count_evidence {
                return Some(result);
            }
            fallback.get_or_insert(result);
        }
    }
    fallback
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

    // ── Registry-level tests (detect_master) ─────────────────────────────────
    //
    // These exercise the full registry, not a single detector, and
    // deliberately avoid "master"/"_stacked" in fixture names so the naming
    // heuristic cannot mask a registry-ordering bug (issue #753).

    /// Issue #753 counter-example (spec 040 SC-001 scenario 2): a Siril
    /// master renamed away from any "master"/"_stacked" convention must
    /// still be detected via STACKCNT, even though PixInsightDetector runs
    /// first in the registry and would otherwise win with a false negative.
    #[test]
    fn detect_master_prefers_stackcnt_evidence_over_earlier_registry_entry() {
        let input = DetectInput {
            imagetyp: Some("DARK"),
            stack_count: Some(30),
            file_name: "dark_030.fits",
            rel_path: "calibration/darks/",
        };
        let result = detect_master(&input).unwrap();
        assert_eq!(result.frame_type, FrameType::Dark);
        assert!(result.is_master, "STACKCNT=30 must win even without 'master' in the name/path");
        assert_eq!(result.detector, "siril");
    }

    /// A decisive STACKCNT=1 (definitely not stacked) must also win over an
    /// earlier detector's naming-based positive guess. The `IMAGETYP` text
    /// itself says "Master Dark" (PixInsight's naming convention) but
    /// neither the file name nor path carries a "master"/"_stacked" signal,
    /// isolating the registry-ordering decision from Siril's own path
    /// heuristic.
    #[test]
    fn detect_master_prefers_stackcnt_negative_over_earlier_naming_positive() {
        let input = DetectInput {
            imagetyp: Some("Master Dark"),
            stack_count: Some(1),
            file_name: "dark_001.fits",
            rel_path: "calibration/darks/",
        };
        let result = detect_master(&input).unwrap();
        assert!(!result.is_master, "decisive STACKCNT=1 must override a naming-only positive");
        assert_eq!(result.detector, "siril");
    }

    /// With no header evidence from any detector, first-registered
    /// (PixInsight) still wins — preserves prior behaviour.
    #[test]
    fn detect_master_falls_back_to_first_match_without_header_evidence() {
        let input = DetectInput {
            imagetyp: Some("Master Dark"),
            stack_count: None,
            file_name: "masterDark.xisf",
            rel_path: "masterDarks/",
        };
        let result = detect_master(&input).unwrap();
        assert!(result.is_master);
        assert_eq!(result.detector, "pixinsight");
    }

    /// No detector can determine anything → None.
    #[test]
    fn detect_master_returns_none_when_no_detector_matches() {
        let input = DetectInput {
            imagetyp: None,
            stack_count: None,
            file_name: "readme.txt",
            rel_path: "",
        };
        assert!(detect_master(&input).is_none());
    }
}
