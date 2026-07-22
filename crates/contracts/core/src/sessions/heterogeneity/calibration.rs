// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration candidate and external-handoff contracts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::shared::{
    BoundedList, CanonicalId, CanonicalRelativePath, Digest, FiniteDecimal, KeysetListOperation,
    LocalDate, MutationContext, NonBlankSafeText, PageRequest, Rfc3339Timestamp, SafeText,
    StableIdentity,
};

pub const MAX_HANDOFF_SOURCE_BYTES: u64 = 17_592_186_044_416;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationKind {
    Dark,
    Bias,
    Flat,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FilterIdentity {
    Known { normalized_captured_label_id: CanonicalId },
    Absent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationRequirement {
    pub requirement_id: CanonicalId,
    pub kind: CalibrationKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optical_profile_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_identity: Option<FilterIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_light_session_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_observing_night: Option<LocalDate>,
    pub recipe_id: CanonicalId,
    pub recipe_revision_id: CanonicalId,
    pub required_recipe_evidence_ref: SafeText,
    pub required_recipe_evidence_complete: bool,
    pub missing_required_fields: BoundedList<SafeText, 100>,
}

impl CalibrationRequirement {
    #[must_use]
    pub fn kind_fields_valid(&self) -> bool {
        match self.kind {
            CalibrationKind::Dark | CalibrationKind::Bias => {
                self.camera_id.is_some()
                    && self.optical_profile_id.is_none()
                    && self.filter_identity.is_none()
                    && self.target_light_session_id.is_none()
                    && self.target_observing_night.is_none()
            }
            CalibrationKind::Flat => {
                self.camera_id.is_none()
                    && self.optical_profile_id.is_some()
                    && self.filter_identity.is_some()
                    && self.target_light_session_id.is_some()
                    && self.target_observing_night.is_some()
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecipeCompatibility {
    Compatible,
    Incompatible,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TemperatureMode {
    Regulated,
    Unregulated,
    Unknown,
    NotApplicable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceState {
    Fresh,
    Yellow,
    Red,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "basis", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CalibrationAgeEvidence {
    ElapsedDays {
        state: EvidenceState,
        #[serde(skip_serializing_if = "Option::is_none")]
        age_days: Option<u32>,
        fresh_through_days: u32,
        red_after_days: u32,
        settings_revision: u64,
    },
    ObservingNightDistance {
        state: EvidenceState,
        #[serde(skip_serializing_if = "Option::is_none")]
        age_nights: Option<u32>,
        fresh_through_nights: u32,
        red_after_nights: u32,
        settings_revision: u64,
    },
}

impl CalibrationAgeEvidence {
    #[must_use]
    pub const fn state(&self) -> EvidenceState {
        match self {
            Self::ElapsedDays { state, .. } | Self::ObservingNightDistance { state, .. } => *state,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MeasurementState {
    Normal,
    Yellow,
    Red,
    Unknown,
    NotApplicable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThermalEvidence {
    pub state: MeasurementState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_reading_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_absolute_deviation_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub median_absolute_deviation_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_absolute_deviation_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentile95_absolute_deviation_deg: Option<FiniteDecimal>,
    pub missing_reading_count: u32,
    pub invalid_reading_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrientationEvidence {
    pub state: MeasurementState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_circular_delta_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normal_through_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub red_above_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailability {
    pub indexed_frame_count: u32,
    pub available_readable_indexed_frame_count: u32,
    pub checked_at: Rfc3339Timestamp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomaticEligibility {
    Eligible,
    ReviewRequired,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationCandidateEvidence {
    pub evidence_id: CanonicalId,
    pub session_id: CanonicalId,
    pub requirement_id: CanonicalId,
    pub recipe_compatibility: RecipeCompatibility,
    pub recipe_evidence_ref: SafeText,
    pub recipe_evidence_complete: bool,
    pub missing_recipe_fields: BoundedList<SafeText, 100>,
    pub temperature_mode: TemperatureMode,
    pub age: CalibrationAgeEvidence,
    pub thermal: ThermalEvidence,
    pub orientation: OrientationEvidence,
    pub source_availability: SourceAvailability,
    pub sufficient: bool,
    pub automatic_eligibility: AutomaticEligibility,
    pub warning_codes: BoundedList<SafeText, 100>,
    pub basis_fingerprint: Digest,
}

impl CalibrationCandidateEvidence {
    #[must_use]
    pub fn derives_blocked_state(&self) -> bool {
        self.recipe_compatibility == RecipeCompatibility::Unknown
            || !self.recipe_evidence_complete
            || self.age.state() == EvidenceState::Unknown
            || self.temperature_mode == TemperatureMode::Unknown
            || !self.sufficient
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SelectionSource {
    Automatic,
    Reviewed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelectionReview {
    pub review_id: CanonicalId,
    pub reviewed_at: Rfc3339Timestamp,
    pub decision_reason: NonBlankSafeText,
    pub acknowledged_warning_codes: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationSelection {
    pub selection_id: CanonicalId,
    pub requirement_id: CanonicalId,
    pub session_id: CanonicalId,
    pub evidence_id: CanonicalId,
    pub source: SelectionSource,
    pub selected_at: Rfc3339Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<SelectionReview>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExternalProcessor {
    PixinsightWbpp,
    Siril,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationHandoffSnapshot {
    pub handoff_id: CanonicalId,
    pub handoff_head_generation: u64,
    pub snapshot_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_snapshot_id: Option<CanonicalId>,
    pub project_id: CanonicalId,
    pub external_processor: ExternalProcessor,
    pub requirement_count: u32,
    pub selection_count: u32,
    pub frame_count: u64,
    pub source_byte_count: u64,
    pub maximum_source_bytes: u64,
    pub matching_settings_revision: u64,
    pub evaluation_at: Rfc3339Timestamp,
    pub created_at: Rfc3339Timestamp,
    pub created_by: CanonicalId,
    pub basis_fingerprint: Digest,
    pub warning_codes: BoundedList<SafeText, 100>,
}

impl CalibrationHandoffSnapshot {
    #[must_use]
    pub fn source_bytes_within_limit(&self) -> bool {
        self.maximum_source_bytes == MAX_HANDOFF_SOURCE_BYTES
            && self.source_byte_count <= MAX_HANDOFF_SOURCE_BYTES
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandoffOperationState {
    Verifying,
    Cancelling,
    Cancelled,
    Applied,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub enum HandoffFailureCode {
    #[serde(rename = "calibration.source_unavailable")]
    SourceUnavailable,
    #[serde(rename = "calibration.source_identity_changed")]
    SourceIdentityChanged,
    #[serde(rename = "calibration.source_fingerprint_changed")]
    SourceFingerprintChanged,
    #[serde(rename = "calibration.handoff_too_large")]
    HandoffTooLarge,
    #[serde(rename = "calibration.cancel_deadline_exceeded")]
    CancelDeadlineExceeded,
    #[serde(rename = "calibration.verification_failed")]
    VerificationFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationHandoffOperation {
    pub operation_id: CanonicalId,
    pub handoff_id: CanonicalId,
    pub state: HandoffOperationState,
    pub verified_frame_count: u64,
    pub total_frame_count: u64,
    pub verified_source_bytes: u64,
    pub total_source_bytes: u64,
    pub cancel_safe: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<HandoffFailureCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_detail: Option<SafeText>,
    pub updated_at: Rfc3339Timestamp,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "visibility", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CalibrationHandoffFrame {
    Authorized {
        selection_id: CanonicalId,
        session_id: CanonicalId,
        session_membership_ordinal: u32,
        frame_id: CanonicalId,
        source_state: IndexedReadableState,
        file_record_id: CanonicalId,
        source_root_id: CanonicalId,
        source_relative_path: CanonicalRelativePath,
        stable_file_identity: StableIdentity,
        strong_content_fingerprint: Digest,
        byte_size: u64,
        no_follow: bool,
        identity_verified_at: Rfc3339Timestamp,
    },
    Redacted {
        selection_id: CanonicalId,
        session_id: CanonicalId,
        session_membership_ordinal: u32,
        frame_id: CanonicalId,
        source_state: IndexedReadableState,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IndexedReadableState {
    IndexedReadable,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationListOperation {
    Candidate,
    HandoffRequirement,
    HandoffSelection,
    HandoffFrame,
}

impl CalibrationListOperation {
    pub const ALL: [Self; 4] =
        [Self::Candidate, Self::HandoffRequirement, Self::HandoffSelection, Self::HandoffFrame];
}

impl KeysetListOperation for CalibrationListOperation {
    fn query_name(&self) -> &'static str {
        match self {
            Self::Candidate => "calibration.candidate.list",
            Self::HandoffRequirement => "calibration.handoff.requirement.list",
            Self::HandoffSelection => "calibration.handoff.selection.list",
            Self::HandoffFrame => "calibration.handoff.frame.list",
        }
    }

    fn unique_order(&self) -> &'static [&'static str] {
        match self {
            Self::Candidate => &[
                "compatibilityRank ASC",
                "sufficiencyRank ASC",
                "observingNight DESC",
                "createdAt DESC",
                "sessionId ASC",
            ],
            Self::HandoffRequirement => &["requirementId ASC"],
            Self::HandoffSelection => &["selectedAt ASC", "selectionId ASC"],
            Self::HandoffFrame => {
                &["selectionId ASC", "sessionMembershipOrdinal ASC", "frameId ASC"]
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CandidateListRequest {
    pub requirement: CalibrationRequirement,
    pub as_of: Rfc3339Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automatic_eligibility: Option<AutomaticEligibility>,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffQueryRequest {
    pub handoff_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<CanonicalId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPageRequest {
    pub snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelectionListRequest {
    pub snapshot_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirement_id: Option<CanonicalId>,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffFrameListRequest {
    pub snapshot_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_id: Option<CanonicalId>,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffOperationQueryRequest {
    pub operation_id: CanonicalId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum CalibrationQuery {
    #[serde(rename = "calibration.candidate.list")]
    CandidateList(Box<CandidateListRequest>),
    #[serde(rename = "calibration.handoff.query")]
    Handoff(HandoffQueryRequest),
    #[serde(rename = "calibration.handoff.requirement.list")]
    HandoffRequirementList(SnapshotPageRequest),
    #[serde(rename = "calibration.handoff.selection.list")]
    HandoffSelectionList(SelectionListRequest),
    #[serde(rename = "calibration.handoff.frame.list")]
    HandoffFrameList(HandoffFrameListRequest),
    #[serde(rename = "calibration.handoff.operation.query")]
    HandoffOperation(HandoffOperationQueryRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffCreateRequest {
    pub project_id: CanonicalId,
    pub external_processor: ExternalProcessor,
    pub requirements: BoundedList<CalibrationRequirement, 100>,
    pub expected_project_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffReviewedAddRequest {
    pub handoff_id: CanonicalId,
    pub snapshot_id: CanonicalId,
    pub expected_handoff_head_generation: u64,
    pub session_id: CanonicalId,
    pub requirement_id: CanonicalId,
    pub expected_snapshot_basis_fingerprint: Digest,
    pub evidence_id: CanonicalId,
    pub decision_reason: NonBlankSafeText,
    pub acknowledged_warning_codes: BoundedList<SafeText, 100>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffCancelRequest {
    pub operation_id: CanonicalId,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenFrameRequest {
    pub snapshot_id: CanonicalId,
    pub frame_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenFrameResponse {
    pub local_stream_handle: SafeText,
    pub byte_size: u64,
    pub strong_content_fingerprint: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum CalibrationCommand {
    #[serde(rename = "calibration.handoff.create")]
    HandoffCreate(HandoffCreateRequest),
    #[serde(rename = "calibration.handoff.reviewed_add")]
    HandoffReviewedAdd(HandoffReviewedAddRequest),
    #[serde(rename = "calibration.handoff.cancel")]
    HandoffCancel(HandoffCancelRequest),
    #[serde(rename = "calibration.handoff.open_frame")]
    HandoffOpenFrame(OpenFrameRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "event", rename_all_fields = "camelCase")]
pub enum CalibrationEvent {
    #[serde(rename = "calibration.handoff_created")]
    HandoffCreated {
        project_id: CanonicalId,
        handoff_id: CanonicalId,
        snapshot_id: CanonicalId,
        automatic_selection_ids: BoundedList<CanonicalId, 100>,
        unselected_requirement_ids: BoundedList<CanonicalId, 100>,
        warning_codes: BoundedList<SafeText, 100>,
    },
    #[serde(rename = "calibration.handoff_reviewed_selection_added")]
    HandoffReviewedSelectionAdded {
        project_id: CanonicalId,
        handoff_id: CanonicalId,
        predecessor_snapshot_id: CanonicalId,
        snapshot_id: CanonicalId,
        requirement_id: CanonicalId,
        selection_id: CanonicalId,
        session_id: CanonicalId,
        review_id: CanonicalId,
        warning_codes: BoundedList<SafeText, 100>,
    },
}
