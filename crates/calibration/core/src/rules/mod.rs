// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-type matching rules for the calibration engine.
pub mod bias;
pub mod dark;
pub mod flat;

/// Float-equality tolerance for hard-rule numeric dimensions (gain, offset).
/// Guards against floating-point representation noise from FITS/XISF header
/// parsing — this is not a tuning knob (unlike the soft-dimension tolerances
/// in [`crate::ranking::MatchingRuleConfig`]).
pub const HARD_RULE_EPSILON: f64 = 1e-9;

/// Hard-rule numeric dimension check shared by the gain/offset comparisons in
/// `bias`/`dark`/`flat` and by `assign::collect_hard_violations`: `true` only
/// when both values are present and equal within [`HARD_RULE_EPSILON`].
/// Missing either side always excludes.
#[must_use]
pub fn hard_rule_numeric(session_val: Option<f64>, master_val: Option<f64>) -> bool {
    matches!((session_val, master_val), (Some(s), Some(m)) if (s - m).abs() < HARD_RULE_EPSILON)
}

/// Hard-rule string dimension check shared by the filter/binning/optic_train
/// comparisons in `flat` and by `assign::collect_hard_violations`: `true`
/// only when both values are present and exactly equal. Missing either side
/// always excludes.
#[must_use]
pub fn hard_rule_string(session_val: Option<&str>, master_val: Option<&str>) -> bool {
    matches!((session_val, master_val), (Some(s), Some(m)) if s == m)
}
