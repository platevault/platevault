// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Matching-settings contracts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::shared::{
    BoundedList, CanonicalId, FiniteDecimal, MutationContext, Rfc3339Timestamp, SafeText,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SettingsSeverity {
    Yellow,
    Red,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationAgeKind {
    Dark,
    Bias,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeometryThresholds {
    pub coverage_min_percent: FiniteDecimal,
    pub center_separation_max_percent: FiniteDecimal,
    pub rotation_max_deg: FiniteDecimal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MosaicThresholds {
    pub overlap_min_percent: FiniteDecimal,
    pub overlap_max_percent: FiniteDecimal,
    pub residual_sky_rotation_cap_deg: FiniteDecimal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DarkThermalThresholds {
    pub moderate_deg: FiniteDecimal,
    pub severe_deg: FiniteDecimal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationAgePolicy {
    pub camera_id: CanonicalId,
    pub kind: CalibrationAgeKind,
    pub fresh_through_days: u32,
    pub red_after_days: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FlatOrientationThresholds {
    pub normal_through_deg: FiniteDecimal,
    pub red_above_deg: FiniteDecimal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FlatAgeThresholds {
    pub red_after_nights: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FixedMatchingRules {
    pub optical_profile_same_max_percent: u32,
    pub optical_profile_review_max_percent: u32,
    pub optical_profile_evidence_conflict_percent: u32,
    pub flat_same_night_fresh_max_nights: u32,
    pub flat_yellow_starts_nights: u32,
}

impl Default for FixedMatchingRules {
    fn default() -> Self {
        Self {
            optical_profile_same_max_percent: 5,
            optical_profile_review_max_percent: 10,
            optical_profile_evidence_conflict_percent: 10,
            flat_same_night_fresh_max_nights: 1,
            flat_yellow_starts_nights: 2,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettings {
    pub revision: u64,
    pub same_session: GeometryThresholds,
    pub sibling: GeometryThresholds,
    pub mosaic: MosaicThresholds,
    pub dark_thermal: DarkThermalThresholds,
    pub calibration_age: BoundedList<CalibrationAgePolicy, 500>,
    pub flat_orientation: FlatOrientationThresholds,
    pub flat_age: FlatAgeThresholds,
    pub fixed_rules: FixedMatchingRules,
    pub updated_at: Rfc3339Timestamp,
    pub updated_by: CanonicalId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValue {
    pub field_path: SafeText,
    #[serde(flatten)]
    pub value: SettingsScalar,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SettingsScalar {
    Decimal(FiniteDecimal),
    Unsigned(u32),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsIssue {
    pub code: SafeText,
    pub severity: SettingsSeverity,
    pub field_paths: BoundedList<SafeText, 50>,
    pub values: BoundedList<SettingsValue, 50>,
    pub message_key: SafeText,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValidation {
    pub valid: bool,
    pub issues: BoundedList<SettingsIssue, 500>,
    pub effective: MatchingSettings,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeometryThresholdPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_min_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_separation_max_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation_max_deg: Option<FiniteDecimal>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same_session: Option<GeometryThresholdPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sibling: Option<GeometryThresholdPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mosaic: Option<MosaicThresholds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dark_thermal: Option<DarkThermalThresholds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_age: Option<BoundedList<CalibrationAgePolicy, 500>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flat_orientation: Option<FlatOrientationThresholds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flat_age: Option<FlatAgeThresholds>,
}

impl MatchingSettings {
    #[must_use]
    pub fn apply_patch(&self, patch: &MatchingSettingsPatch) -> Self {
        let mut effective = self.clone();
        if let Some(value) = &patch.same_session {
            apply_geometry_patch(&mut effective.same_session, value);
        }
        if let Some(value) = &patch.sibling {
            apply_geometry_patch(&mut effective.sibling, value);
        }
        if let Some(value) = &patch.mosaic {
            effective.mosaic = value.clone();
        }
        if let Some(value) = &patch.dark_thermal {
            effective.dark_thermal = value.clone();
        }
        if let Some(value) = &patch.calibration_age {
            effective.calibration_age = value.clone();
        }
        if let Some(value) = &patch.flat_orientation {
            effective.flat_orientation = value.clone();
        }
        if let Some(value) = &patch.flat_age {
            effective.flat_age = value.clone();
        }
        effective
    }

    #[must_use]
    /// # Panics
    ///
    /// Panics only if the fixed set of validation rules produces more than 500 issues.
    #[allow(clippy::too_many_lines)]
    pub fn validate(&self) -> SettingsValidation {
        let mut issues = Vec::new();
        check_range(
            &mut issues,
            "sameSession.coverageMinPercent",
            self.same_session.coverage_min_percent,
            90.0,
            99.5,
            Some((93.0, false)),
        );
        check_range(
            &mut issues,
            "sameSession.centerSeparationMaxPercent",
            self.same_session.center_separation_max_percent,
            0.5,
            5.0,
            Some((3.0, true)),
        );
        check_range(
            &mut issues,
            "sameSession.rotationMaxDeg",
            self.same_session.rotation_max_deg,
            0.25,
            3.0,
            Some((2.0, true)),
        );
        check_range(
            &mut issues,
            "sibling.coverageMinPercent",
            self.sibling.coverage_min_percent,
            80.0,
            95.0,
            Some((85.0, false)),
        );
        check_range(
            &mut issues,
            "sibling.centerSeparationMaxPercent",
            self.sibling.center_separation_max_percent,
            2.0,
            15.0,
            Some((10.0, true)),
        );
        check_range(
            &mut issues,
            "sibling.rotationMaxDeg",
            self.sibling.rotation_max_deg,
            1.0,
            15.0,
            Some((10.0, true)),
        );
        check_range(
            &mut issues,
            "mosaic.overlapMinPercent",
            self.mosaic.overlap_min_percent,
            1.0,
            20.0,
            Some((3.0, false)),
        );
        check_range(
            &mut issues,
            "mosaic.overlapMaxPercent",
            self.mosaic.overlap_max_percent,
            20.0,
            60.0,
            Some((50.0, true)),
        );
        check_range(
            &mut issues,
            "darkThermal.moderateDeg",
            self.dark_thermal.moderate_deg,
            0.1,
            2.0,
            Some((1.0, true)),
        );
        check_range(
            &mut issues,
            "darkThermal.severeDeg",
            self.dark_thermal.severe_deg,
            0.5,
            5.0,
            Some((3.0, true)),
        );
        check_range(
            &mut issues,
            "flatOrientation.normalThroughDeg",
            self.flat_orientation.normal_through_deg,
            0.5,
            5.0,
            Some((3.0, true)),
        );
        check_range(
            &mut issues,
            "flatOrientation.redAboveDeg",
            self.flat_orientation.red_above_deg,
            0.5,
            15.0,
            Some((8.0, true)),
        );
        if !(7..=365).contains(&self.flat_age.red_after_nights) {
            issues.push(issue(
                "settings.out_of_bounds",
                SettingsSeverity::Red,
                "flatAge.redAfterNights",
            ));
        } else if self.flat_age.red_after_nights > 90 {
            issues.push(issue(
                "settings.warning.flat_age",
                SettingsSeverity::Yellow,
                "flatAge.redAfterNights",
            ));
        }
        for policy in &self.calibration_age {
            if policy.fresh_through_days > 1_795 || !(30..=1_825).contains(&policy.red_after_days) {
                issues.push(issue(
                    "settings.out_of_bounds",
                    SettingsSeverity::Red,
                    "calibrationAge",
                ));
            }
            if policy.red_after_days < policy.fresh_through_days.saturating_add(30) {
                issues.push(issue(
                    "settings.calibration_age_gap",
                    SettingsSeverity::Red,
                    "calibrationAge",
                ));
            } else if policy.red_after_days > 730 {
                issues.push(issue(
                    "settings.warning.calibration_age",
                    SettingsSeverity::Yellow,
                    "calibrationAge",
                ));
            }
        }
        cross_constraints(self, &mut issues);
        let valid = !issues.iter().any(|item| item.severity == SettingsSeverity::Red);
        SettingsValidation {
            valid,
            issues: BoundedList::try_new(issues).expect("settings checks are bounded"),
            effective: self.clone(),
        }
    }
}

fn apply_geometry_patch(target: &mut GeometryThresholds, patch: &GeometryThresholdPatch) {
    if let Some(value) = patch.coverage_min_percent {
        target.coverage_min_percent = value;
    }
    if let Some(value) = patch.center_separation_max_percent {
        target.center_separation_max_percent = value;
    }
    if let Some(value) = patch.rotation_max_deg {
        target.rotation_max_deg = value;
    }
}

fn safe(value: &str) -> SafeText {
    SafeText::try_new(value).expect("static settings text is safe")
}

fn issue(code: &str, severity: SettingsSeverity, field_path: &str) -> SettingsIssue {
    SettingsIssue {
        code: safe(code),
        severity,
        field_paths: BoundedList::try_new(vec![safe(field_path)]).expect("one field path"),
        values: BoundedList::default(),
        message_key: safe(code),
    }
}

fn check_range(
    issues: &mut Vec<SettingsIssue>,
    field: &str,
    value: FiniteDecimal,
    min: f64,
    max: f64,
    warning: Option<(f64, bool)>,
) {
    if !(min..=max).contains(&value.get()) {
        issues.push(issue("settings.out_of_bounds", SettingsSeverity::Red, field));
    } else if let Some((boundary, warn_above)) = warning {
        if (warn_above && value.get() > boundary) || (!warn_above && value.get() < boundary) {
            issues.push(issue("settings.warning.risky_value", SettingsSeverity::Yellow, field));
        }
    }
}

fn cross_constraints(settings: &MatchingSettings, issues: &mut Vec<SettingsIssue>) {
    if settings.sibling.coverage_min_percent > settings.same_session.coverage_min_percent {
        issues.push(issue(
            "settings.sibling_coverage_stricter",
            SettingsSeverity::Red,
            "sibling.coverageMinPercent",
        ));
    }
    if settings.sibling.center_separation_max_percent
        < settings.same_session.center_separation_max_percent
    {
        issues.push(issue(
            "settings.sibling_center_stricter",
            SettingsSeverity::Red,
            "sibling.centerSeparationMaxPercent",
        ));
    }
    if settings.sibling.rotation_max_deg < settings.same_session.rotation_max_deg {
        issues.push(issue(
            "settings.sibling_rotation_stricter",
            SettingsSeverity::Red,
            "sibling.rotationMaxDeg",
        ));
    }
    if settings.mosaic.overlap_min_percent >= settings.mosaic.overlap_max_percent {
        issues.push(issue(
            "settings.mosaic_overlap_order",
            SettingsSeverity::Red,
            "mosaic.overlapMinPercent",
        ));
    }
    if settings.mosaic.overlap_max_percent.get()
        > settings.sibling.coverage_min_percent.get() - 10.0
    {
        issues.push(issue(
            "settings.mosaic_sibling_gap",
            SettingsSeverity::Red,
            "mosaic.overlapMaxPercent",
        ));
    }
    if settings.dark_thermal.severe_deg.get() < settings.dark_thermal.moderate_deg.get() + 0.5 {
        issues.push(issue(
            "settings.dark_thermal_gap",
            SettingsSeverity::Red,
            "darkThermal.severeDeg",
        ));
    }
    if settings.flat_orientation.red_above_deg <= settings.flat_orientation.normal_through_deg {
        issues.push(issue(
            "settings.flat_orientation_order",
            SettingsSeverity::Red,
            "flatOrientation.redAboveDeg",
        ));
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsGetRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsValidateRequest {
    pub base_revision: u64,
    pub patch: MatchingSettingsPatch,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsUpdateRequest {
    pub expected_revision: u64,
    pub patch: MatchingSettingsPatch,
    pub acknowledged_warning_codes: BoundedList<SafeText, 500>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsUpdateResponse {
    pub settings: MatchingSettings,
    pub warnings: BoundedList<SettingsIssue, 500>,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchingSettingsUpdatedEvent {
    pub previous_revision: u64,
    pub revision: u64,
    pub changed_field_paths: BoundedList<SafeText, 500>,
    pub warning_codes: BoundedList<SafeText, 500>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation", content = "payload", rename_all = "snake_case")]
pub enum MatchingSettingsQuery {
    Get(MatchingSettingsGetRequest),
    Validate(MatchingSettingsValidateRequest),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation", content = "payload", rename_all = "snake_case")]
pub enum MatchingSettingsCommand {
    Update(MatchingSettingsUpdateRequest),
}
