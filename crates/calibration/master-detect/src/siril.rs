// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Siril-specific calibration master detector (spec 040, FR-002).
//!
//! # Siril master heuristics
//!
//! Siril keeps the **base** `IMAGETYP` on masters unchanged (e.g. `"DARK"`,
//! `"FLAT"`). It marks masters through two orthogonal signals:
//!
//! - **`STACKCNT` > 1**: the number of frames combined (a value > 1 is
//!   definitive evidence of stacking). `NCOMBINE` is accepted as a fallback.
//! - **`_stacked` in the file name or path**: Siril appends `_stacked` to
//!   exported master files.
//! - **`master` in the file name or path**: a secondary naming convention.
//!
//! The `IMAGETYP` must still be present and parseable; if it is absent the
//! detector returns `None` and the next detector in the registry is tried.

use crate::{
    parse_frame_type, path_looks_like_master, DetectInput, MasterDetection, MasterDetector,
};

/// Detector for Siril-created calibration masters.
pub struct SirilDetector;

impl MasterDetector for SirilDetector {
    fn id(&self) -> &'static str {
        "siril"
    }

    fn detect(&self, input: &DetectInput<'_>) -> Option<MasterDetection> {
        // Siril always keeps the plain base IMAGETYP; without it we cannot
        // determine the frame type.
        let imagetyp = input.imagetyp?;
        let frame_type = parse_frame_type(imagetyp)?;

        // Master detection: STACKCNT > 1 OR path / name contains _stacked / master.
        let is_master = input.stack_count.is_some_and(|n| n > 1)
            || path_looks_like_master(input.file_name, input.rel_path);

        // A present STACKCNT/NCOMBINE value is decisive header evidence
        // regardless of its verdict (>1 confirms stacking, <=1 confirms it is
        // a plain sub) — it must not be shadowed by another detector's
        // naming-only guess (issue #753).
        let stack_count_evidence = input.stack_count.is_some();

        Some(MasterDetection { frame_type, is_master, detector: self.id(), stack_count_evidence })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use metadata_core::FrameType;

    fn input<'a>(
        imagetyp: Option<&'a str>,
        stack_count: Option<u32>,
        file_name: &'a str,
        rel_path: &'a str,
    ) -> DetectInput<'a> {
        DetectInput { imagetyp, stack_count, file_name, rel_path }
    }

    // ── Positive cases ────────────────────────────────────────────────────────

    /// Siril FITS master: IMAGETYP="DARK" + STACKCNT=30 → Dark + is_master=true
    #[test]
    fn siril_fits_master_dark_by_stackcnt() {
        let inp = input(Some("DARK"), Some(30), "dark_master.fit", "calibration/darks/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Dark);
        assert!(result.is_master);
        assert_eq!(result.detector, "siril");
        assert!(result.stack_count_evidence, "a present STACKCNT must be decisive header evidence");
    }

    /// Siril FITS master: IMAGETYP="FLAT" + STACKCNT=20 → Flat + is_master=true
    #[test]
    fn siril_fits_master_flat_by_stackcnt() {
        let inp = input(Some("FLAT"), Some(20), "flat_master.fit", "calibration/flats/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Flat);
        assert!(result.is_master);
    }

    /// Siril master via _stacked suffix, no STACKCNT.
    #[test]
    fn siril_master_by_stacked_suffix() {
        let inp = input(Some("DARK"), None, "dark_stacked.fit", "calibration/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Dark);
        assert!(result.is_master);
        assert!(!result.stack_count_evidence, "naming-only match must not claim header evidence");
    }

    /// Siril master via "master" in file name, no STACKCNT.
    #[test]
    fn siril_master_by_name_prefix() {
        let inp = input(Some("BIAS"), None, "masterBias.fit", "calibration/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Bias);
        assert!(result.is_master);
    }

    /// IMAGETYP="OFFSET" maps to Bias.
    #[test]
    fn siril_offset_maps_to_bias() {
        let inp = input(Some("OFFSET"), Some(50), "offset_stacked.fit", "calibration/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Bias);
        assert!(result.is_master);
    }

    // ── Negative cases ────────────────────────────────────────────────────────

    /// Single dark sub: IMAGETYP="DARK", no stack count, no master name → is_master=false.
    #[test]
    fn siril_single_dark_sub_is_not_master() {
        let inp = input(Some("DARK"), None, "dark_001.fit", "calibration/darks/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert_eq!(result.frame_type, FrameType::Dark);
        assert!(!result.is_master, "a single sub with STACKCNT absent must not be a master");
        assert_eq!(result.detector, "siril");
    }

    /// STACKCNT=1 (exactly 1 combined frame) is not a master (strict > 1).
    #[test]
    fn siril_stackcnt_one_is_not_master() {
        let inp = input(Some("DARK"), Some(1), "dark_001.fit", "calibration/darks/");
        let result = SirilDetector.detect(&inp).unwrap();
        assert!(!result.is_master);
        assert!(result.stack_count_evidence, "STACKCNT=1 is still a decisive header read");
    }

    /// Missing IMAGETYP → None.
    #[test]
    fn siril_no_imagetyp_returns_none() {
        let inp = input(None, Some(30), "dark_stacked.fit", "calibration/");
        assert!(SirilDetector.detect(&inp).is_none());
    }
}
