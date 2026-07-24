// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration family domain model (spec 062 US4, FR-062 through FR-075).
//!
//! Pure domain types — no SQL, no filesystem reads.
//! Persistence repositories map these to/from DB rows.
//! App-layer use cases use these to evaluate candidate evidence.

use serde::{Deserialize, Serialize};

use crate::CalibrationKind;

// ── Temperature mode ──────────────────────────────────────────────────────────

/// Temperature regulation mode for a dark family or calibration session.
///
/// `Unregulated` is only valid for dark families after an explicit reviewed
/// camera decision (FR-067, FR-068). `Unknown` applies to a dark session with
/// no cooling set point when the camera has no accepted regulation decision.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemperatureMode {
    Regulated,
    Unregulated,
    Unknown,
    /// Applies to bias frames and non-dark calibration types.
    NotApplicable,
}

impl TemperatureMode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Regulated => "regulated",
            Self::Unregulated => "unregulated",
            Self::Unknown => "unknown",
            Self::NotApplicable => "not_applicable",
        }
    }
}

// ── Age state ────────────────────────────────────────────────────────────────

/// Freshness/age severity for a calibration candidate relative to a requirement.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgeState {
    Fresh,
    Yellow,
    Red,
    Unknown,
}

impl AgeState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Yellow => "yellow",
            Self::Red => "red",
            Self::Unknown => "unknown",
        }
    }
}

// ── Thermal state ─────────────────────────────────────────────────────────────

/// Thermal severity for a regulated dark session based on per-frame sensor
/// temperature deviation from the cooling set point (FR-088).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThermalState {
    Normal,
    Yellow,
    Red,
    Unknown,
    NotApplicable,
}

impl ThermalState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Yellow => "yellow",
            Self::Red => "red",
            Self::Unknown => "unknown",
            Self::NotApplicable => "not_applicable",
        }
    }
}

// ── Orientation state ─────────────────────────────────────────────────────────

/// Physical orientation compatibility severity for a flat candidate (FR-073, FR-089).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrientationState {
    Normal,
    Yellow,
    Red,
    Unknown,
    NotApplicable,
}

impl OrientationState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Yellow => "yellow",
            Self::Red => "red",
            Self::Unknown => "unknown",
            Self::NotApplicable => "not_applicable",
        }
    }
}

// ── Recipe compatibility ──────────────────────────────────────────────────────

/// Recipe-level compatibility result when comparing a candidate to a requirement.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecipeCompatibility {
    Compatible,
    Incompatible,
    Unknown,
}

// ── Automatic eligibility ─────────────────────────────────────────────────────

/// Whether a calibration candidate can be selected automatically by the
/// handoff creation command (contract `CalibrationCandidateEvidence.automaticEligibility`).
///
/// `Blocked` overrides `ReviewRequired`; review cannot override blocked.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomaticEligibility {
    Eligible,
    ReviewRequired,
    Blocked,
}

impl AutomaticEligibility {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Eligible => "eligible",
            Self::ReviewRequired => "review_required",
            Self::Blocked => "blocked",
        }
    }
}

// ── Assignment state ──────────────────────────────────────────────────────────

/// Family assignment state for a calibration session (FR-067).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentState {
    Assigned,
    BlockedUnknownTemperature,
    NeedsReview,
}

impl AssignmentState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Assigned => "assigned",
            Self::BlockedUnknownTemperature => "blocked_unknown_temperature",
            Self::NeedsReview => "needs_review",
        }
    }
}

// ── Exposure tolerance ────────────────────────────────────────────────────────

/// Compute the dark exposure matching tolerance in microseconds (FR-065).
///
/// Formula: `max(1000, min(100000, representative_us / 2000))`.
///
/// Uses integer microseconds to avoid floating-point accumulation across
/// the tolerance boundary. The spec states the same formula as
/// `max(1 ms, min(100 ms, 0.05% of representative))`.
///
/// # Examples
///
/// ```
/// use calibration_core::families::dark_exposure_tolerance_us;
/// assert_eq!(dark_exposure_tolerance_us(0), 1_000);
/// assert_eq!(dark_exposure_tolerance_us(60_000_000), 30_000);
/// assert_eq!(dark_exposure_tolerance_us(300_000_000), 100_000);
/// ```
#[must_use]
pub fn dark_exposure_tolerance_us(representative_us: u64) -> u64 {
    let raw = representative_us / 2000;
    raw.clamp(1_000, 100_000)
}

// ── Dark thermal evidence ─────────────────────────────────────────────────────

/// Per-session dark thermal deviation statistics (FR-066, FR-088).
///
/// All deviation fields are in integer milli-Celsius. Missing readings are
/// excluded from statistics; fewer than 80 % valid readings yields `Unknown`
/// severity from the DB trigger, not derived here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DarkThermalEvidence {
    pub valid_count: u32,
    pub missing_count: u32,
    pub invalid_count: u32,
    /// All deviation fields in milli-Celsius; `None` when `valid_count == 0`.
    pub minimum_abs_deviation_millic: Option<i32>,
    pub median_abs_deviation_millic: Option<i32>,
    pub maximum_abs_deviation_millic: Option<i32>,
    pub p95_abs_deviation_millic: Option<i32>,
    /// Parts per million of valid readings. `< 800_000` → severity `Unknown`.
    pub valid_ratio_ppm: u32,
    pub severity: ThermalState,
}

// ── Source availability ───────────────────────────────────────────────────────

/// Rebuilt per-session frame-availability projection (FR-071 sufficiency rule).
///
/// `sufficient` is true when `readable_frame_count >= 1` and the parent
/// calibration-session recipe evidence is complete. Sufficiency is evaluated
/// at query time, not stored here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceAvailability {
    pub indexed_frame_count: u32,
    pub available_readable_indexed_frame_count: u32,
    /// UTC RFC 3339 timestamp string when this projection was observed.
    pub checked_at: String,
}

// ── Family recipe types ───────────────────────────────────────────────────────

/// Physical orientation evidence state for a flat session (FR-089).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhysicalRotatorState {
    /// Confirmed from a verified capture field; angle is present.
    Verified,
    /// Field not populated.
    Absent,
    /// Field present but not from a verified capture field.
    Unverified,
}

/// State/value pair encoding for an optional discrete field.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldState {
    Present,
    Absent,
}

/// Dark family recipe identity (FR-065, FR-067).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DarkRecipe {
    pub temperature_mode: TemperatureMode,
    /// `Some` only when `temperature_mode == Regulated`.
    pub cooling_setpoint_millic: Option<i32>,
    pub representative_exposure_us: u64,
    pub gain_text: String,
    pub offset_state: FieldState,
    pub offset_value: Option<i64>,
    pub binning_state: FieldState,
    pub bin_x: Option<u32>,
    pub bin_y: Option<u32>,
    pub readout_state: FieldState,
    pub readout_mode: Option<String>,
    pub raster_width: u32,
    pub raster_height: u32,
}

impl DarkRecipe {
    /// Exposure tolerance in microseconds for this recipe (FR-065).
    #[must_use]
    pub fn exposure_tolerance_us(&self) -> u64 {
        dark_exposure_tolerance_us(self.representative_exposure_us)
    }

    /// Return `true` when `candidate_exposure_us` is within tolerance.
    #[must_use]
    pub fn exposure_matches(&self, candidate_exposure_us: u64) -> bool {
        let tol = self.exposure_tolerance_us();
        let rep = self.representative_exposure_us;
        let lo = rep.saturating_sub(tol);
        let hi = rep.saturating_add(tol);
        (lo..=hi).contains(&candidate_exposure_us)
    }
}

/// Bias family recipe identity (FR-069).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BiasRecipe {
    pub gain_text: String,
    pub offset_state: FieldState,
    pub offset_value: Option<i64>,
    pub binning_state: FieldState,
    pub bin_x: Option<u32>,
    pub bin_y: Option<u32>,
    pub readout_state: FieldState,
    pub readout_mode: Option<String>,
    pub raster_width: u32,
    pub raster_height: u32,
}

/// Flat family identity (FR-072).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlatFamilyIdentity {
    pub gain_text: String,
    pub offset_state: FieldState,
    pub offset_value: Option<i64>,
    pub binning_state: FieldState,
    pub bin_x: Option<u32>,
    pub bin_y: Option<u32>,
    pub readout_state: FieldState,
    pub readout_mode: Option<String>,
    pub raster_width: u32,
    pub raster_height: u32,
    /// Physical orientation state: `Verified`, `Absent`, or `Unverified`.
    pub physical_rotator_state: PhysicalRotatorState,
    /// Micro-degrees; `Some` only when `physical_rotator_state == Verified`.
    pub physical_rotator_udeg: Option<i32>,
}

/// A calibration family aggregating sessions sharing the same recipe.
///
/// `kind` is one of `dark`, `bias`, or `flat`.
/// Dark and bias families are owned by a `camera_id`; flat families by
/// `optical_profile_id` and `filter_label_id` scoped to that profile.
#[derive(Clone, Debug)]
pub struct CalibrationFamily {
    /// Public UUIDv7 identity.
    pub public_id: String,
    pub kind: CalibrationKind,
    /// Present for dark and bias families.
    pub camera_id: Option<String>,
    /// Present for flat families.
    pub optical_profile_id: Option<String>,
    /// Present for flat families (scoped to optical_profile_id).
    pub filter_label_id: Option<String>,
    pub identity_digest: String,
    /// Public ID of the representative session (immutable once set).
    pub representative_session_id: String,
}

// ── Age evaluation ────────────────────────────────────────────────────────────

/// Default dark/bias age thresholds in days (FR-070).
pub const DARK_BIAS_FRESH_DAYS_DEFAULT: u32 = 270;
pub const DARK_BIAS_RED_DAYS_DEFAULT: u32 = 365;

/// Default flat age thresholds in observing-night distance (FR-074).
pub const FLAT_FRESH_NIGHTS_DEFAULT: u32 = 1;
pub const FLAT_RED_NIGHTS_DEFAULT: u32 = 7;

/// Evaluate dark or bias age severity given elapsed calendar days.
///
/// Uses per-camera-kind configured boundaries when available; falls back to
/// [`DARK_BIAS_FRESH_DAYS_DEFAULT`] / [`DARK_BIAS_RED_DAYS_DEFAULT`].
///
/// Yellow is `[fresh_days + 1, red_days]`; red is `> red_days`.
#[must_use]
pub fn dark_bias_age_state(
    age_days: u32,
    fresh_through_days: u32,
    red_after_days: u32,
) -> AgeState {
    if age_days <= fresh_through_days {
        AgeState::Fresh
    } else if age_days <= red_after_days {
        AgeState::Yellow
    } else {
        AgeState::Red
    }
}

/// Evaluate flat age severity given observing-night distance (FR-074).
///
/// Same-night (distance 0) and one-night-old are `Fresh`. Two through
/// `red_after_nights` (exclusive) are `Yellow`. Above is `Red`.
#[must_use]
pub fn flat_age_state(night_distance: u32, red_after_nights: u32) -> AgeState {
    if night_distance <= FLAT_FRESH_NIGHTS_DEFAULT {
        AgeState::Fresh
    } else if night_distance <= red_after_nights {
        AgeState::Yellow
    } else {
        AgeState::Red
    }
}

/// Evaluate flat physical orientation severity (FR-073, FR-088).
///
/// `delta_udeg` is the minimum circular delta in micro-degrees.
/// `normal_through_udeg` / `red_above_udeg` are the configured thresholds.
/// Absent or unverified physical orientation yields `Unknown`.
#[must_use]
pub fn flat_orientation_state(
    delta_udeg: Option<u32>,
    normal_through_udeg: u32,
    red_above_udeg: u32,
) -> OrientationState {
    match delta_udeg {
        None => OrientationState::Unknown,
        Some(d) => {
            if d <= normal_through_udeg {
                OrientationState::Normal
            } else if d <= red_above_udeg {
                OrientationState::Yellow
            } else {
                OrientationState::Red
            }
        }
    }
}

/// Default flat orientation thresholds in micro-degrees (FR-073).
pub const FLAT_ORIENTATION_NORMAL_UDEG_DEFAULT: u32 = 2_000_000;
pub const FLAT_ORIENTATION_RED_UDEG_DEFAULT: u32 = 5_000_000;

/// Evaluate dark regulated thermal severity from p95 absolute deviation (FR-088).
///
/// `moderate_millic` / `severe_millic` come from `matching_settings_revision`.
#[must_use]
pub fn dark_thermal_state_from_p95(
    p95_millic: Option<i32>,
    valid_ratio_ppm: u32,
    moderate_millic: i32,
    severe_millic: i32,
) -> ThermalState {
    // Fewer than 80 % valid readings → unknown, blocks automatic selection.
    if valid_ratio_ppm < 800_000 {
        return ThermalState::Unknown;
    }
    match p95_millic {
        None => ThermalState::Unknown,
        Some(p95) => {
            let p95_abs = p95.unsigned_abs();
            // Thresholds are schema-guaranteed positive; cast to u32 to avoid
            // a signed comparison that could wrap (clippy::cast_possible_wrap).
            let moderate = moderate_millic.unsigned_abs();
            let severe = severe_millic.unsigned_abs();
            if p95_abs <= moderate {
                ThermalState::Normal
            } else if p95_abs <= severe {
                ThermalState::Yellow
            } else {
                ThermalState::Red
            }
        }
    }
}

/// Default dark thermal thresholds in milli-Celsius (FR-088).
pub const DARK_THERMAL_MODERATE_MILLIC_DEFAULT: i32 = 500;
pub const DARK_THERMAL_SEVERE_MILLIC_DEFAULT: i32 = 2_000;

// ── Automatic eligibility evaluation ─────────────────────────────────────────

/// Parameters for computing [`AutomaticEligibility`].
///
/// Mirrors the conditions in the contract definition and FR-071 / FR-074.
#[allow(clippy::struct_excessive_bools)] // all flags are independent eligibility conditions, not state machine axes
pub struct EligibilityInput {
    pub kind: CalibrationKind,
    pub recipe_compatibility: RecipeCompatibility,
    pub required_evidence_complete: bool,
    pub candidate_evidence_complete: bool,
    pub sufficient: bool,
    pub age_state: AgeState,
    pub thermal_state: ThermalState,
    pub temperature_mode: TemperatureMode,
    pub orientation_state: OrientationState,
    /// True when this flat candidate is from the same observing night as its
    /// light requirement (FR-074, contract).
    pub is_same_night_flat: bool,
}

/// Evaluate automatic eligibility from pre-computed evidence fields.
///
/// The returned eligibility follows the contract priority: `Blocked` ≥
/// `ReviewRequired` ≥ `Eligible`.
#[must_use]
pub fn automatic_eligibility(input: &EligibilityInput) -> AutomaticEligibility {
    // Blocked conditions (cannot be overridden by review).
    if !input.required_evidence_complete
        || !input.candidate_evidence_complete
        || !input.sufficient
        || matches!(input.age_state, AgeState::Unknown)
        || matches!(input.recipe_compatibility, RecipeCompatibility::Unknown)
        || matches!(input.temperature_mode, TemperatureMode::Unknown)
    {
        return AutomaticEligibility::Blocked;
    }
    // Dark: unregulated temperature mode is blocked for automatic.
    if input.kind == CalibrationKind::Dark
        && matches!(input.temperature_mode, TemperatureMode::Unregulated)
    {
        return AutomaticEligibility::Blocked;
    }
    // Incompatible recipe is always blocked.
    if matches!(input.recipe_compatibility, RecipeCompatibility::Incompatible) {
        return AutomaticEligibility::Blocked;
    }

    // Review required conditions.
    if matches!(input.age_state, AgeState::Red) {
        return AutomaticEligibility::ReviewRequired;
    }
    if input.kind == CalibrationKind::Dark && matches!(input.thermal_state, ThermalState::Red) {
        return AutomaticEligibility::ReviewRequired;
    }
    // Flat: cross-night or red orientation → review required.
    if input.kind == CalibrationKind::Flat {
        if !input.is_same_night_flat {
            return AutomaticEligibility::ReviewRequired;
        }
        if matches!(input.orientation_state, OrientationState::Red) {
            return AutomaticEligibility::ReviewRequired;
        }
    }

    AutomaticEligibility::Eligible
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_exposure_tolerance_clamps_low() {
        assert_eq!(dark_exposure_tolerance_us(0), 1_000);
        assert_eq!(dark_exposure_tolerance_us(1_000_000), 1_000); // 1s → 500 µs → clamp to 1000
    }

    #[test]
    fn dark_exposure_tolerance_clamps_high() {
        // 300s = 300_000_000 µs → 300_000_000 / 2000 = 150_000 → clamp to 100_000
        assert_eq!(dark_exposure_tolerance_us(300_000_000), 100_000);
    }

    #[test]
    fn dark_exposure_tolerance_midrange() {
        // 60s = 60_000_000 µs → 60_000_000 / 2000 = 30_000 → no clamp
        assert_eq!(dark_exposure_tolerance_us(60_000_000), 30_000);
    }

    #[test]
    fn dark_exposure_matches() {
        let recipe = DarkRecipe {
            temperature_mode: TemperatureMode::Regulated,
            cooling_setpoint_millic: Some(-10_000),
            representative_exposure_us: 60_000_000, // 60 s → tol 30_000
            gain_text: "100".to_owned(),
            offset_state: FieldState::Present,
            offset_value: Some(50),
            binning_state: FieldState::Present,
            bin_x: Some(1),
            bin_y: Some(1),
            readout_state: FieldState::Absent,
            readout_mode: None,
            raster_width: 4096,
            raster_height: 2160,
        };
        assert!(recipe.exposure_matches(60_000_000));
        assert!(recipe.exposure_matches(60_030_000));
        assert!(recipe.exposure_matches(59_970_000));
        assert!(!recipe.exposure_matches(60_030_001));
    }

    #[test]
    fn dark_bias_age_thresholds() {
        let (fresh, red) = (270, 365);
        assert_eq!(dark_bias_age_state(0, fresh, red), AgeState::Fresh);
        assert_eq!(dark_bias_age_state(270, fresh, red), AgeState::Fresh);
        assert_eq!(dark_bias_age_state(271, fresh, red), AgeState::Yellow);
        assert_eq!(dark_bias_age_state(365, fresh, red), AgeState::Yellow);
        assert_eq!(dark_bias_age_state(366, fresh, red), AgeState::Red);
    }

    #[test]
    fn flat_age_thresholds() {
        assert_eq!(flat_age_state(0, 7), AgeState::Fresh);
        assert_eq!(flat_age_state(1, 7), AgeState::Fresh);
        assert_eq!(flat_age_state(2, 7), AgeState::Yellow);
        assert_eq!(flat_age_state(7, 7), AgeState::Yellow);
        assert_eq!(flat_age_state(8, 7), AgeState::Red);
    }

    #[test]
    fn flat_orientation_thresholds() {
        let (n, r) = (2_000_000, 5_000_000);
        assert_eq!(flat_orientation_state(None, n, r), OrientationState::Unknown);
        assert_eq!(flat_orientation_state(Some(0), n, r), OrientationState::Normal);
        assert_eq!(flat_orientation_state(Some(2_000_000), n, r), OrientationState::Normal);
        assert_eq!(flat_orientation_state(Some(2_000_001), n, r), OrientationState::Yellow);
        assert_eq!(flat_orientation_state(Some(5_000_000), n, r), OrientationState::Yellow);
        assert_eq!(flat_orientation_state(Some(5_000_001), n, r), OrientationState::Red);
    }

    #[test]
    fn thermal_state_low_valid_ratio_is_unknown() {
        // < 80% valid reads → Unknown regardless of p95
        assert_eq!(
            dark_thermal_state_from_p95(Some(100), 799_999, 500, 2_000),
            ThermalState::Unknown
        );
    }

    #[test]
    fn thermal_state_normal() {
        assert_eq!(
            dark_thermal_state_from_p95(Some(500), 900_000, 500, 2_000),
            ThermalState::Normal
        );
    }

    #[test]
    fn thermal_state_yellow_and_red() {
        assert_eq!(
            dark_thermal_state_from_p95(Some(2_000), 900_000, 500, 2_000),
            ThermalState::Yellow
        );
        assert_eq!(
            dark_thermal_state_from_p95(Some(2_001), 900_000, 500, 2_000),
            ThermalState::Red
        );
    }

    #[test]
    fn eligibility_blocked_incomplete_evidence() {
        let input = EligibilityInput {
            kind: CalibrationKind::Dark,
            recipe_compatibility: RecipeCompatibility::Compatible,
            required_evidence_complete: false,
            candidate_evidence_complete: true,
            sufficient: true,
            age_state: AgeState::Fresh,
            thermal_state: ThermalState::Normal,
            temperature_mode: TemperatureMode::Regulated,
            orientation_state: OrientationState::NotApplicable,
            is_same_night_flat: false,
        };
        assert_eq!(automatic_eligibility(&input), AutomaticEligibility::Blocked);
    }

    #[test]
    fn eligibility_dark_red_age_review_required() {
        let input = EligibilityInput {
            kind: CalibrationKind::Dark,
            recipe_compatibility: RecipeCompatibility::Compatible,
            required_evidence_complete: true,
            candidate_evidence_complete: true,
            sufficient: true,
            age_state: AgeState::Red,
            thermal_state: ThermalState::Normal,
            temperature_mode: TemperatureMode::Regulated,
            orientation_state: OrientationState::NotApplicable,
            is_same_night_flat: false,
        };
        assert_eq!(automatic_eligibility(&input), AutomaticEligibility::ReviewRequired);
    }

    #[test]
    fn eligibility_flat_same_night_eligible() {
        let input = EligibilityInput {
            kind: CalibrationKind::Flat,
            recipe_compatibility: RecipeCompatibility::Compatible,
            required_evidence_complete: true,
            candidate_evidence_complete: true,
            sufficient: true,
            age_state: AgeState::Fresh,
            thermal_state: ThermalState::NotApplicable,
            temperature_mode: TemperatureMode::NotApplicable,
            orientation_state: OrientationState::Normal,
            is_same_night_flat: true,
        };
        assert_eq!(automatic_eligibility(&input), AutomaticEligibility::Eligible);
    }

    #[test]
    fn eligibility_flat_cross_night_review_required() {
        let input = EligibilityInput {
            kind: CalibrationKind::Flat,
            recipe_compatibility: RecipeCompatibility::Compatible,
            required_evidence_complete: true,
            candidate_evidence_complete: true,
            sufficient: true,
            age_state: AgeState::Yellow,
            thermal_state: ThermalState::NotApplicable,
            temperature_mode: TemperatureMode::NotApplicable,
            orientation_state: OrientationState::Normal,
            is_same_night_flat: false,
        };
        assert_eq!(automatic_eligibility(&input), AutomaticEligibility::ReviewRequired);
    }

    #[test]
    fn eligibility_unregulated_dark_blocked() {
        let input = EligibilityInput {
            kind: CalibrationKind::Dark,
            recipe_compatibility: RecipeCompatibility::Compatible,
            required_evidence_complete: true,
            candidate_evidence_complete: true,
            sufficient: true,
            age_state: AgeState::Fresh,
            thermal_state: ThermalState::NotApplicable,
            temperature_mode: TemperatureMode::Unregulated,
            orientation_state: OrientationState::NotApplicable,
            is_same_night_flat: false,
        };
        assert_eq!(automatic_eligibility(&input), AutomaticEligibility::Blocked);
    }
}
