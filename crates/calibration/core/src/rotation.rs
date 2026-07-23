// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Flat↔light rotation applicability matcher (spec 041 T080, FR-040).
//!
//! Distinct from the *soft, tolerance-scored* `rotation` dimension used in
//! `rules::flat` for ranking confidence. This module implements the
//! **applicability** check defined by research R-18 (real-FITS-verified):
//!
//! - Flat↔light applicability matches on the **mechanical** rotator angle
//!   `ROTATANG` (= `ROTATOR`), NEVER `OBJCTROT` (sky PA, informational only).
//! - The match is **(near-)exact**, NOT tolerance-scored: any deviation beyond a
//!   tiny float-epsilon produces a [`RotationWarning::Deviation`] — a flat may
//!   not be valid for lights at a different mechanical rotation.
//! - When `ROTATANG` is **absent**, the configurable `flat_rotation_required`
//!   flag (default OFF) decides whether the missing rotation **excludes** the
//!   flat. When matching without it, a [`RotationWarning::RotationUnavailable`]
//!   is emitted ("rotation (ROTATANG) unavailable — matched without rotation").
//! - Drift is NOT detectable with a manual rotator (`ROTATANG` stays at the set
//!   value), so the only determinable signal is the **flat-group-vs-light-group**
//!   deviation. Matching is therefore at the group level.
//!
//! This module is pure: it takes two already-extracted `ROTATANG` values
//! (group-level) plus the policy flag and returns a verdict the UI can surface.

#![allow(clippy::must_use_candidate)]

use serde::{Deserialize, Serialize};

/// Epsilon below which a rotation difference is treated as no deviation.
///
/// `ROTATANG` is recorded with ~13 significant digits (real NINA value
/// `12.4320640563965`); two frames from the same group serialize the identical
/// value, so a difference under this threshold is float noise, not a real
/// rotation change. Anything at or above it is a genuine deviation worth a
/// warning.
pub const ROTATION_EPSILON_DEG: f64 = 1e-6;

/// A non-blocking metadata-quality warning about flat↔light rotation.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum RotationWarning {
    /// The flat group's `ROTATANG` differs from the light group's by `deg`
    /// (beyond [`ROTATION_EPSILON_DEG`]). The flat may not be valid for the
    /// lights. `deg` is the absolute deviation in degrees.
    Deviation { deg: f64 },
    /// `ROTATANG` was unavailable on the flat and/or the light group, and
    /// `flat_rotation_required` is OFF, so the flat was matched without a
    /// rotation check. Surfaced as "rotation (ROTATANG) unavailable — matched
    /// without rotation".
    RotationUnavailable,
}

/// Verdict of the flat↔light rotation applicability check.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationMatch {
    /// `true` when the flat is applicable to the lights (possibly with a
    /// warning); `false` only when `ROTATANG` is absent and
    /// `flat_rotation_required` is ON.
    pub matched: bool,
    /// An optional non-blocking warning. Present even when `matched` is `true`
    /// (a deviation warns but does not exclude — R-18: exact-but-warn).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<RotationWarning>,
}

impl RotationMatch {
    /// Matched, no warning (exact rotation agreement).
    const fn matched_clean() -> Self {
        Self { matched: true, warning: None }
    }

    /// Matched but carrying a non-blocking warning.
    const fn matched_with(warning: RotationWarning) -> Self {
        Self { matched: true, warning: Some(warning) }
    }

    /// Excluded — `ROTATANG` absent while `flat_rotation_required` is ON.
    /// No warning is attached: exclusion is a hard verdict, not a warning.
    const fn excluded() -> Self {
        Self { matched: false, warning: None }
    }
}

/// Evaluate flat↔light rotation applicability (FR-040, R-18).
///
/// Compares a flat group's mechanical rotator angle (`flat_rotang`) against the
/// matched light group's (`light_rotang`). Both are `ROTATANG` (= `ROTATOR`),
/// the mechanical image-train angle — never `OBJCTROT`.
///
/// Semantics:
/// - **Both present**: exact comparison. Equal within [`ROTATION_EPSILON_DEG`]
///   → matched, no warning. Any larger deviation → matched **with** a
///   [`RotationWarning::Deviation`] carrying the absolute degree difference
///   (R-18: near-exact, warn on any deviation, do NOT score/exclude).
/// - **Either absent** and `flat_rotation_required == false` → matched with a
///   [`RotationWarning::RotationUnavailable`].
/// - **Either absent** and `flat_rotation_required == true` → excluded
///   (the flat is dropped from the candidate set).
pub fn flat_light_rotation_match(
    flat_rotang: Option<f64>,
    light_rotang: Option<f64>,
    flat_rotation_required: bool,
) -> RotationMatch {
    match (flat_rotang, light_rotang) {
        (Some(flat), Some(light)) => {
            let deviation = (flat - light).abs();
            if deviation < ROTATION_EPSILON_DEG {
                RotationMatch::matched_clean()
            } else {
                RotationMatch::matched_with(RotationWarning::Deviation { deg: deviation })
            }
        }
        // At least one side has no recorded ROTATANG.
        _ => {
            if flat_rotation_required {
                RotationMatch::excluded()
            } else {
                RotationMatch::matched_with(RotationWarning::RotationUnavailable)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_no_warning() {
        let r = flat_light_rotation_match(Some(12.432), Some(12.432), false);
        assert!(r.matched);
        assert_eq!(r.warning, None);
    }

    #[test]
    fn float_noise_under_epsilon_is_clean_match() {
        // Difference below ROTATION_EPSILON_DEG must not warn.
        let r = flat_light_rotation_match(
            Some(12.432_064_056_396_5),
            Some(12.432_064_106_396_5),
            false,
        );
        assert!(r.matched);
        assert_eq!(r.warning, None, "sub-epsilon difference is float noise, not a deviation");
    }

    #[test]
    fn any_deviation_warns_with_degrees() {
        // 12.4 vs 13.0 → 0.6° deviation. Even a small change can invalidate a flat.
        let r = flat_light_rotation_match(Some(12.4), Some(13.0), false);
        assert!(r.matched, "deviation warns but does NOT exclude (R-18)");
        match r.warning {
            Some(RotationWarning::Deviation { deg }) => {
                assert!((deg - 0.6).abs() < 1e-9, "expected 0.6° deviation, got {deg}");
            }
            other => panic!("expected Deviation warning, got {other:?}"),
        }
    }

    #[test]
    fn tiny_deviation_at_epsilon_boundary_warns() {
        // Just above epsilon → warns (near-exact, not tolerance-scored).
        let r = flat_light_rotation_match(Some(0.0), Some(ROTATION_EPSILON_DEG * 10.0), false);
        assert!(r.matched);
        assert!(matches!(r.warning, Some(RotationWarning::Deviation { .. })));
    }

    #[test]
    fn absent_flat_rotang_required_off_matches_with_unavailable() {
        let r = flat_light_rotation_match(None, Some(12.4), false);
        assert!(r.matched, "missing rotation does not exclude when not required");
        assert_eq!(r.warning, Some(RotationWarning::RotationUnavailable));
    }

    #[test]
    fn absent_light_rotang_required_off_matches_with_unavailable() {
        let r = flat_light_rotation_match(Some(12.4), None, false);
        assert!(r.matched);
        assert_eq!(r.warning, Some(RotationWarning::RotationUnavailable));
    }

    #[test]
    fn both_absent_required_off_matches_with_unavailable() {
        let r = flat_light_rotation_match(None, None, false);
        assert!(r.matched);
        assert_eq!(r.warning, Some(RotationWarning::RotationUnavailable));
    }

    #[test]
    fn absent_flat_rotang_required_on_excludes() {
        let r = flat_light_rotation_match(None, Some(12.4), true);
        assert!(!r.matched, "missing rotation excludes when flat_rotation_required is ON");
        assert_eq!(r.warning, None);
    }

    #[test]
    fn absent_light_rotang_required_on_excludes() {
        let r = flat_light_rotation_match(Some(12.4), None, true);
        assert!(!r.matched);
        assert_eq!(r.warning, None);
    }

    #[test]
    fn present_rotation_ignores_required_flag() {
        // When both present, the required flag is irrelevant — exact compare wins.
        let clean = flat_light_rotation_match(Some(5.0), Some(5.0), true);
        assert!(clean.matched);
        assert_eq!(clean.warning, None);

        let dev = flat_light_rotation_match(Some(5.0), Some(7.5), true);
        assert!(dev.matched);
        assert!(matches!(dev.warning, Some(RotationWarning::Deviation { .. })));
    }

    #[test]
    fn warning_serializes_with_kind_tag() {
        let dev = serde_json::to_value(RotationWarning::Deviation { deg: 0.6 }).unwrap();
        assert_eq!(dev["kind"], "deviation");
        assert!((dev["deg"].as_f64().unwrap() - 0.6).abs() < 1e-9);

        let unavail = serde_json::to_value(RotationWarning::RotationUnavailable).unwrap();
        assert_eq!(unavail["kind"], "rotation_unavailable");
    }

    #[test]
    fn rotation_match_serializes_camel_case() {
        let r = flat_light_rotation_match(Some(1.0), Some(2.0), false);
        let v = serde_json::to_value(r).unwrap();
        assert_eq!(v["matched"], true);
        // warning present (deviation); snake_case kind tag.
        assert_eq!(v["warning"]["kind"], "deviation");
    }
}
