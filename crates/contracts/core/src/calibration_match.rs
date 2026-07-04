//! Contract DTOs for `calibration.match.suggest`, `calibration.match.assign`,
//! and `calibration.match.suggest.batch` (spec 007).
//!
//! These types mirror the JSON Schemas in:
//!   - `specs/007-calibration-matching-rules/contracts/calibration.match.suggest.json` (v2.0.0)
//!   - `specs/007-calibration-matching-rules/contracts/calibration.match.assign.json` (v2.0.0)
//!   - `specs/007-calibration-matching-rules/contracts/calibration.match.suggest.batch.json` (v1.0)
//!
//! The `CalibrationType` enum MUST NOT include `dark_flat` in v1 (FR-001,
//! data-model invariant 6). The domain `CalibrationKind::DarkFlat` slot exists
//! in the Rust enum but is never exposed through these DTOs.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── Shared enums ──────────────────────────────────────────────────────────────

/// Calibration type exposed in v1 contracts.
///
/// `dark_flat` is intentionally absent per FR-001 (R-DarkFlat-Reserved).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationType {
    Dark,
    Flat,
    Bias,
}

/// Why a dimension was not satisfied.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MismatchReason {
    OutOfTolerance,
    MetadataMissing,
    HardRuleViolation,
}

/// How a candidate was selected (observing-night provenance).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SelectionReason {
    SameSession,
    SameNight,
    CompatibleFallback,
}

// ── Dimension breakdown types ─────────────────────────────────────────────────

/// A dimension that matched.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchedDimDto {
    pub dimension: String,
    /// Observed value (may be numeric, string, or absent).
    /// Uses `JsonAny` to avoid an infinitely-recursive specta TypeScript type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed: Option<JsonAny>,
    /// Reference value from the matching rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<JsonAny>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
}

/// A dimension that did not match.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MismatchedDimDto {
    pub dimension: String,
    pub reason: MismatchReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
}

/// A ranked calibration master suggestion.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchDto {
    pub session_id: String,
    pub master_id: String,
    pub calibration_type: CalibrationType,
    pub confidence: f64,
    pub dimensions_matched: Vec<MatchedDimDto>,
    pub dimensions_mismatched: Vec<MismatchedDimDto>,
    pub selection_reason: SelectionReason,
    /// Session context enrichment (spec P9): the light session's resolved
    /// target, filter, observing night, and frame count. `None` when the
    /// context cannot be resolved (e.g. no canonical target link, no
    /// fingerprint row, or the session id is unknown). Populated by
    /// `app_core_calibration` as a post-processing step — the pure
    /// `calibration_core` matching engine never touches persistence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition_night: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_count: Option<u32>,
}

// ── calibration.match.suggest ─────────────────────────────────────────────────

/// Contract version for calibration.match.suggest.
pub const SUGGEST_CONTRACT_VERSION: &str = "2.0.0";

/// Result status for a suggest call.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SuggestStatus {
    Match,
    Ambiguous,
    NoMatch,
    /// Session lacks `observer_location` or `exposure_start_utc` (A6).
    ObserverLocationMissing,
}

/// Request DTO for `calibration.match.suggest`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchSuggestRequest {
    pub contract_version: String,
    pub request_id: String,
    pub session_id: String,
    /// Subset to suggest. When absent, all three types are returned.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_types: Option<Vec<CalibrationType>>,
}

/// Response DTO for `calibration.match.suggest`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchSuggestResponse {
    pub status: String, // "success" | "error"
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggest_status: Option<SuggestStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matches: Option<Vec<CalibrationMatchDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<SuggestErrorDto>,
}

/// Error envelope for suggest.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SuggestErrorDto {
    pub code: String,
    pub message: String,
}

// ── calibration.match.assign ──────────────────────────────────────────────────

/// Contract version for calibration.match.assign.
pub const ASSIGN_CONTRACT_VERSION: &str = "2.0.0";

/// Request DTO for `calibration.match.assign`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchAssignRequest {
    pub contract_version: String,
    pub request_id: String,
    pub session_id: String,
    pub master_id: String,
    pub r#override: bool,
}

/// Successful assign payload.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssignedDto {
    pub assignment_id: String,
    pub session_id: String,
    pub master_id: String,
    pub calibration_type: CalibrationType,
    pub was_override: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mismatched_dimensions: Option<Vec<String>>,
    pub assigned_at: String,
}

/// Response DTO for `calibration.match.assign`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchAssignResponse {
    pub status: String, // "success" | "error"
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned: Option<AssignedDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AssignErrorDto>,
}

/// Error envelope for assign.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssignErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<AssignErrorDetails>,
}

/// Error details for `incompatible.dimensions`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssignErrorDetails {
    pub dimensions: Vec<String>,
}

// ── calibration.match.suggest.batch ──────────────────────────────────────────

/// Contract version for calibration.match.suggest.batch.
pub const BATCH_CONTRACT_VERSION: &str = "1.0";

/// Request DTO for `calibration.match.suggest.batch`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchBatchRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Non-empty list of light session IDs.
    pub session_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_types: Option<Vec<CalibrationType>>,
}

/// Per-(session, `calibration_type`) result within a batch response.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchSessionResultDto {
    pub session_id: String,
    pub calibration_type: CalibrationType,
    /// `"match"` | `"ambiguous"` | `"no_match"` | `"observer_location_missing"` | `"session.mixed_state"`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<CalibrationMatchDto>>,
}

/// Hard error for sessions that could not be evaluated at all (e.g. not found).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Response DTO for `calibration.match.suggest.batch`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatchBatchResponse {
    /// `"success"` | `"partial"` | `"error"`
    pub status: String,
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<BatchSessionResultDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<BatchErrorDto>>,
}

// ── Domain → DTO converters ───────────────────────────────────────────────────

use calibration_core::{
    candidate::{
        CalibrationMatch, MatchedDim, MismatchReason as DomainMismatchReason, MismatchedDim,
        SelectionReason as DomainSelectionReason,
    },
    CalibrationKind,
};

/// Convert domain `CalibrationKind` to contract `CalibrationType`.
///
/// Returns `None` for `DarkFlat` (not exposed in v1 contracts).
#[must_use]
pub fn kind_to_contract(kind: CalibrationKind) -> Option<CalibrationType> {
    match kind {
        CalibrationKind::Dark => Some(CalibrationType::Dark),
        CalibrationKind::Flat => Some(CalibrationType::Flat),
        CalibrationKind::Bias => Some(CalibrationType::Bias),
        CalibrationKind::DarkFlat => None,
    }
}

/// Convert contract `CalibrationType` to domain `CalibrationKind`.
#[must_use]
pub fn contract_to_kind(ct: CalibrationType) -> CalibrationKind {
    match ct {
        CalibrationType::Dark => CalibrationKind::Dark,
        CalibrationType::Flat => CalibrationKind::Flat,
        CalibrationType::Bias => CalibrationKind::Bias,
    }
}

/// Convert a domain `MatchedDim` to its DTO.
#[must_use]
pub fn matched_dim_to_dto(d: &MatchedDim) -> MatchedDimDto {
    MatchedDimDto {
        dimension: d.dimension.clone(),
        observed: d.observed.clone().map(JsonAny),
        reference: d.reference.clone().map(JsonAny),
        delta: d.delta,
    }
}

/// Convert a domain `MismatchedDim` to its DTO.
#[must_use]
pub fn mismatched_dim_to_dto(d: &MismatchedDim) -> MismatchedDimDto {
    MismatchedDimDto {
        dimension: d.dimension.clone(),
        reason: match d.reason {
            DomainMismatchReason::OutOfTolerance => MismatchReason::OutOfTolerance,
            DomainMismatchReason::MetadataMissing => MismatchReason::MetadataMissing,
            DomainMismatchReason::HardRuleViolation => MismatchReason::HardRuleViolation,
        },
        delta: d.delta,
    }
}

/// Convert a domain `CalibrationMatch` to its DTO.
///
/// Returns `None` when the `calibration_type` cannot be expressed in v1 contracts.
#[must_use]
pub fn match_to_dto(m: &CalibrationMatch) -> Option<CalibrationMatchDto> {
    let calibration_type = kind_to_contract(m.calibration_type)?;
    let selection_reason = match m.selection_reason {
        DomainSelectionReason::SameSession => SelectionReason::SameSession,
        DomainSelectionReason::SameNight => SelectionReason::SameNight,
        DomainSelectionReason::CompatibleFallback => SelectionReason::CompatibleFallback,
    };
    Some(CalibrationMatchDto {
        session_id: m.session_id.clone(),
        master_id: m.master_id.clone(),
        calibration_type,
        confidence: m.confidence,
        dimensions_matched: m.dimensions_matched.iter().map(matched_dim_to_dto).collect(),
        dimensions_mismatched: m.dimensions_mismatched.iter().map(mismatched_dim_to_dto).collect(),
        selection_reason,
        // Session context is not known to the pure domain match; the caller
        // (`app_core_calibration`) enriches these fields via a batched DB
        // lookup after conversion.
        target_name: None,
        filter: None,
        acquisition_night: None,
        frame_count: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calibration_type_serializes_correctly() {
        assert_eq!(serde_json::to_value(CalibrationType::Dark).unwrap(), serde_json::json!("dark"));
        assert_eq!(serde_json::to_value(CalibrationType::Flat).unwrap(), serde_json::json!("flat"));
        assert_eq!(serde_json::to_value(CalibrationType::Bias).unwrap(), serde_json::json!("bias"));
    }

    #[test]
    fn kind_to_contract_dark_flat_is_none() {
        assert!(kind_to_contract(CalibrationKind::DarkFlat).is_none());
    }

    #[test]
    fn kind_to_contract_round_trips() {
        for kind in [CalibrationKind::Dark, CalibrationKind::Flat, CalibrationKind::Bias] {
            let ct = kind_to_contract(kind).unwrap();
            assert_eq!(contract_to_kind(ct), kind);
        }
    }

    #[test]
    fn selection_reason_serializes() {
        assert_eq!(
            serde_json::to_value(SelectionReason::SameSession).unwrap(),
            serde_json::json!("same_session")
        );
    }

    #[test]
    fn mismatch_reason_serializes() {
        assert_eq!(
            serde_json::to_value(MismatchReason::HardRuleViolation).unwrap(),
            serde_json::json!("hard_rule_violation")
        );
    }
}
