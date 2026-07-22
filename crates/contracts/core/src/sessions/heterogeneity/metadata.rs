// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Metadata, equipment-resolution, and reclassification contracts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::shared::{
    BoundedList, CanonicalId, FiniteDecimal, KeysetListOperation, LocalDate, MutationContext,
    NonBlankSafeText, PageRequest, RevisionRef, Rfc3339Timestamp, SafeText, SupportedFrameKind,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum MetadataValue {
    Boolean(bool),
    Integer(i64),
    Decimal(FiniteDecimal),
    Text(SafeText),
    Array(BoundedList<MetadataValue, 256>),
    Object(BoundedList<MetadataProperty, 128>),
    Null,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataProperty {
    pub key: SafeText,
    pub value: MetadataValue,
}

impl MetadataValue {
    /// # Errors
    ///
    /// Returns an error when the metadata exceeds the contract's depth or object-key limits.
    pub fn validate_depth_and_keys(&self) -> Result<(), &'static str> {
        self.validate_at_depth(0)
    }

    fn validate_at_depth(&self, depth: usize) -> Result<(), &'static str> {
        if depth > 8 {
            return Err("metadata_depth_exceeded");
        }
        match self {
            Self::Array(items) => {
                for item in items {
                    item.validate_at_depth(depth + 1)?;
                }
            }
            Self::Object(properties) => {
                let mut keys = std::collections::BTreeSet::new();
                for property in properties {
                    if property.key.chars().count() > 128 || !keys.insert(property.key.as_str()) {
                        return Err("metadata_key_invalid");
                    }
                    property.value.validate_at_depth(depth + 1)?;
                }
            }
            Self::Boolean(_) | Self::Integer(_) | Self::Decimal(_) | Self::Text(_) | Self::Null => {
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MetadataFieldState {
    Known,
    Absent,
    Invalid,
    Contradictory,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceConfidence {
    Confirmed,
    Reported,
    Calculated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidenceField {
    pub canonical_field: SafeText,
    pub source_field: SafeText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_value: Option<SafeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_value: Option<MetadataValue>,
    pub state: MetadataFieldState,
    pub confidence: EvidenceConfidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ObservingNightState {
    Confirmed,
    TimezoneMissing,
    Contradictory,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataObservingNightEvidence {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<LocalDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<SafeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_instant: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_timestamp: Option<Rfc3339Timestamp>,
    pub state: ObservingNightState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidence {
    pub evidence_id: CanonicalId,
    pub session_id: CanonicalId,
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_software: Option<SafeText>,
    pub fields: BoundedList<MetadataEvidenceField, 256>,
    pub observing_night: MetadataObservingNightEvidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionState {
    Resolved,
    NeedsReview,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionDecision {
    Automatic,
    Accepted,
    Corrected,
    Unresolved,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionChoice<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_id: Option<CanonicalId>,
    pub candidates: BoundedList<T, 100>,
    pub basis: BoundedList<SafeText, 100>,
    pub decision: ResolutionDecision,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CameraCandidate {
    pub camera_id: CanonicalId,
    pub display_name: SafeText,
    pub matched_aliases: BoundedList<SafeText, 100>,
    pub geometry_compatible: bool,
    pub confidence: super::inbox::CandidateConfidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OpticalProfileClassification {
    Same,
    Review,
    Different,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpticalProfileCandidate {
    pub optical_profile_id: CanonicalId,
    pub display_name: SafeText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_focal_length_mm: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_focal_length_mm: Option<FiniteDecimal>,
    pub representative_focal_length_mm: FiniteDecimal,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub representative_difference_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_calculated_difference_percent: Option<FiniteDecimal>,
    pub classification: OpticalProfileClassification,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WarningSeverity {
    Yellow,
    Red,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionWarning {
    pub code: SafeText,
    pub severity: WarningSeverity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<SafeText>,
    pub evidence_refs: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentResolution {
    pub resolution_id: CanonicalId,
    pub session_id: CanonicalId,
    pub revision: u64,
    pub state: ResolutionState,
    pub camera: ResolutionChoice<CameraCandidate>,
    pub optical_profile: ResolutionChoice<OpticalProfileCandidate>,
    pub warnings: BoundedList<ResolutionWarning, 100>,
    pub evidence_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_by: Option<CanonicalId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NightDerivationKind {
    AcquisitionTimezone,
    ReviewedLocalFallback,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    pub frame_kind: SupportedFrameKind,
    pub observing_night: LocalDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition_timezone: Option<SafeText>,
    pub night_derivation: NightDerivationKind,
    pub night_evidence_refs: BoundedList<SafeText, 100>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_target_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optical_profile_id: Option<CanonicalId>,
    pub filter: MetadataValue,
    pub exposure_ms: MetadataValue,
    pub gain: MetadataValue,
    pub offset: MetadataValue,
    pub binning_x: MetadataValue,
    pub binning_y: MetadataValue,
    pub readout_mode: MetadataValue,
    pub raster_width: u32,
    pub raster_height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReclassificationPlanState {
    Open,
    Applied,
    Discarded,
    Stale,
    Refused,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCorrection {
    pub canonical_field: SafeText,
    pub corrected_value: Option<MetadataValue>,
    pub evidence_refs: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationPlan {
    pub plan_id: CanonicalId,
    pub plan_revision: u64,
    pub state: ReclassificationPlanState,
    pub source_session_id: CanonicalId,
    pub source_session_evidence_revision: u64,
    pub requested_corrections: BoundedList<MetadataCorrection, 256>,
    pub plan_result_snapshot_id: CanonicalId,
    pub replacement_session_count: u64,
    pub panel_consequence_count: u64,
    pub predecessor_group_retirement_count: u64,
    pub panel_lineage_count: u64,
    pub stale_mosaic_edge_count: u64,
    pub project_consequence_count: u64,
    pub warnings: BoundedList<ResolutionWarning, 100>,
    pub created_at: Rfc3339Timestamp,
    pub created_by: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationProjectConsequence {
    pub project_id: CanonicalId,
    pub unchanged_pinned_session_id: CanonicalId,
    pub replacement_session_count: u64,
    pub proposal_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_replacement_proposal_id: Option<CanonicalId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationReplacementSession {
    pub replacement_key: SafeText,
    pub frame_count: u64,
    pub proposed_identity: SessionIdentity,
    pub proposed_equipment_resolution: EquipmentResolution,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PanelConsequenceAction {
    SuccessorRevision,
    NewGroup,
    ReviewRequired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationPanelConsequence {
    pub panel_group_id: CanonicalId,
    pub source_revision_id: CanonicalId,
    pub proposed_destination_panel_group_id: CanonicalId,
    pub proposed_destination_revision_id: CanonicalId,
    pub proposed_session_count: u64,
    pub predecessor_group_retirement_count: u64,
    pub lineage_edge_count: u64,
    pub action: PanelConsequenceAction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationPanelLineage {
    pub predecessor_panel_group_id: CanonicalId,
    pub successor_panel_group_id: CanonicalId,
    pub kind: IdentityChangeKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IdentityChangeKind {
    IdentityChange,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationStaleMosaicEdge {
    pub mosaic_id: CanonicalId,
    pub mosaic_revision_id: CanonicalId,
    pub edge_id: CanonicalId,
    pub reason_code: SafeText,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationApplyResult {
    pub apply_result_snapshot_id: CanonicalId,
    pub replacement_session_count: u64,
    pub accepted_panel_revision_count: u64,
    pub retired_predecessor_group_count: u64,
    pub panel_lineage_count: u64,
    pub invalidated_mosaic_edge_count: u64,
    pub project_replacement_proposal_count: u64,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MetadataListOperation {
    ReplacementFrame,
    ReplacementSession,
    PanelConsequence,
    PanelConsequenceSession,
    PanelConsequenceRetirement,
    PanelConsequenceLineage,
    StaleMosaicEdge,
    ProjectConsequence,
    ProjectConsequenceReplacement,
    ApplyReplacementSession,
    ApplyPanelRevision,
    ApplyInvalidatedEdge,
    ApplyRetiredPanelGroup,
    ApplyPanelLineage,
    ApplyProjectProposal,
}

impl MetadataListOperation {
    pub const ALL: [Self; 15] = [
        Self::ReplacementFrame,
        Self::ReplacementSession,
        Self::PanelConsequence,
        Self::PanelConsequenceSession,
        Self::PanelConsequenceRetirement,
        Self::PanelConsequenceLineage,
        Self::StaleMosaicEdge,
        Self::ProjectConsequence,
        Self::ProjectConsequenceReplacement,
        Self::ApplyReplacementSession,
        Self::ApplyPanelRevision,
        Self::ApplyInvalidatedEdge,
        Self::ApplyRetiredPanelGroup,
        Self::ApplyPanelLineage,
        Self::ApplyProjectProposal,
    ];
}

impl KeysetListOperation for MetadataListOperation {
    fn query_name(&self) -> &'static str {
        match self {
            Self::ReplacementFrame => "metadata.reclassification.replacement_frame.list",
            Self::ReplacementSession => "metadata.reclassification.replacement_session.list",
            Self::PanelConsequence => "metadata.reclassification.panel_consequence.list",
            Self::PanelConsequenceSession => {
                "metadata.reclassification.panel_consequence_session.list"
            }
            Self::PanelConsequenceRetirement => {
                "metadata.reclassification.panel_consequence_retirement.list"
            }
            Self::PanelConsequenceLineage => {
                "metadata.reclassification.panel_consequence_lineage.list"
            }
            Self::StaleMosaicEdge => "metadata.reclassification.stale_mosaic_edge.list",
            Self::ProjectConsequence => "metadata.reclassification.project_consequence.list",
            Self::ProjectConsequenceReplacement => {
                "metadata.reclassification.project_consequence_replacement.list"
            }
            Self::ApplyReplacementSession => {
                "metadata.reclassification.apply_result.replacement_session.list"
            }
            Self::ApplyPanelRevision => {
                "metadata.reclassification.apply_result.panel_revision.list"
            }
            Self::ApplyInvalidatedEdge => {
                "metadata.reclassification.apply_result.invalidated_edge.list"
            }
            Self::ApplyRetiredPanelGroup => {
                "metadata.reclassification.apply_result.retired_panel_group.list"
            }
            Self::ApplyPanelLineage => "metadata.reclassification.apply_result.panel_lineage.list",
            Self::ApplyProjectProposal => {
                "metadata.reclassification.apply_result.project_proposal.list"
            }
        }
    }

    fn unique_order(&self) -> &'static [&'static str] {
        match self {
            Self::ReplacementFrame => &["ordinal ASC", "frameId ASC"],
            Self::ReplacementSession | Self::ProjectConsequenceReplacement => {
                &["ordinal ASC", "replacementKey ASC"]
            }
            Self::PanelConsequence | Self::ApplyRetiredPanelGroup => {
                &["ordinal ASC", "panelGroupId ASC"]
            }
            Self::PanelConsequenceSession => &["ordinal ASC", "proposedSessionId ASC"],
            Self::PanelConsequenceRetirement => &["ordinal ASC", "predecessorPanelGroupId ASC"],
            Self::PanelConsequenceLineage | Self::ApplyPanelLineage => &[
                "ordinal ASC",
                "lineage.predecessorPanelGroupId ASC",
                "lineage.successorPanelGroupId ASC",
            ],
            Self::StaleMosaicEdge | Self::ApplyInvalidatedEdge => &["ordinal ASC", "edgeId ASC"],
            Self::ProjectConsequence => &["projectId ASC", "unchangedPinnedSessionId ASC"],
            Self::ApplyReplacementSession => &["ordinal ASC", "replacementSessionId ASC"],
            Self::ApplyPanelRevision => &["ordinal ASC", "revisionRef.revisionId ASC"],
            Self::ApplyProjectProposal => &["ordinal ASC", "projectReplacementProposalId ASC"],
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidenceQueryRequest {
    pub session_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentResolutionQueryRequest {
    pub session_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationQueryRequest {
    pub plan_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationResultPageRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementFrameListRequest {
    pub plan_id: CanonicalId,
    pub replacement_key: SafeText,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PanelConsequenceSessionListRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub panel_group_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PanelConsequenceDestinationListRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub proposed_destination_panel_group_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConsequenceReplacementListRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub project_id: CanonicalId,
    pub unchanged_pinned_session_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationApplyResultPageRequest {
    pub plan_id: CanonicalId,
    pub apply_result_snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum MetadataQuery {
    #[serde(rename = "metadata.evidence.query")]
    Evidence(MetadataEvidenceQueryRequest),
    #[serde(rename = "equipment.resolution.query")]
    EquipmentResolution(EquipmentResolutionQueryRequest),
    #[serde(rename = "metadata.reclassification.query")]
    Reclassification(ReclassificationQueryRequest),
    #[serde(rename = "metadata.reclassification.replacement_frame.list")]
    ReplacementFrameList(ReplacementFrameListRequest),
    #[serde(rename = "metadata.reclassification.replacement_session.list")]
    ReplacementSessionList(ReclassificationResultPageRequest),
    #[serde(rename = "metadata.reclassification.panel_consequence.list")]
    PanelConsequenceList(ReclassificationResultPageRequest),
    #[serde(rename = "metadata.reclassification.panel_consequence_session.list")]
    PanelConsequenceSessionList(PanelConsequenceSessionListRequest),
    #[serde(rename = "metadata.reclassification.panel_consequence_retirement.list")]
    PanelConsequenceRetirementList(PanelConsequenceDestinationListRequest),
    #[serde(rename = "metadata.reclassification.panel_consequence_lineage.list")]
    PanelConsequenceLineageList(PanelConsequenceDestinationListRequest),
    #[serde(rename = "metadata.reclassification.stale_mosaic_edge.list")]
    StaleMosaicEdgeList(ReclassificationResultPageRequest),
    #[serde(rename = "metadata.reclassification.project_consequence.list")]
    ProjectConsequenceList(ReclassificationResultPageRequest),
    #[serde(rename = "metadata.reclassification.project_consequence_replacement.list")]
    ProjectConsequenceReplacementList(ProjectConsequenceReplacementListRequest),
    #[serde(rename = "metadata.reclassification.apply_result.replacement_session.list")]
    ApplyReplacementSessionList(ReclassificationApplyResultPageRequest),
    #[serde(rename = "metadata.reclassification.apply_result.panel_revision.list")]
    ApplyPanelRevisionList(ReclassificationApplyResultPageRequest),
    #[serde(rename = "metadata.reclassification.apply_result.invalidated_edge.list")]
    ApplyInvalidatedEdgeList(ReclassificationApplyResultPageRequest),
    #[serde(rename = "metadata.reclassification.apply_result.retired_panel_group.list")]
    ApplyRetiredPanelGroupList(ReclassificationApplyResultPageRequest),
    #[serde(rename = "metadata.reclassification.apply_result.panel_lineage.list")]
    ApplyPanelLineageList(ReclassificationApplyResultPageRequest),
    #[serde(rename = "metadata.reclassification.apply_result.project_proposal.list")]
    ApplyProjectProposalList(ReclassificationApplyResultPageRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentDecisionInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optical_profile_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark_camera_unregulated: Option<bool>,
    pub note: NonBlankSafeText,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentResolutionDecideRequest {
    pub session_id: CanonicalId,
    pub expected_resolution_revision: u64,
    pub decision: EquipmentDecisionInput,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentResolutionDecideResponse {
    pub resolution: EquipmentResolution,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationPlanRequest {
    pub session_id: CanonicalId,
    pub expected_metadata_resolution_revision: u64,
    pub corrections: BoundedList<MetadataCorrection, 256>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationApplyRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub expected_source_session_evidence_revision: u64,
    pub expected_group_head_revision_refs: BoundedList<RevisionRef, 500>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationApplyResponse {
    pub plan: ReclassificationPlan,
    pub applied_reclassification_plan_revision_id: CanonicalId,
    pub predecessor_session_id: CanonicalId,
    pub result: ReclassificationApplyResult,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReclassificationDiscardRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum MetadataCommand {
    #[serde(rename = "equipment.resolution.decide")]
    EquipmentResolutionDecide(EquipmentResolutionDecideRequest),
    #[serde(rename = "metadata.reclassification.plan")]
    ReclassificationPlan(ReclassificationPlanRequest),
    #[serde(rename = "metadata.reclassification.apply")]
    ReclassificationApply(ReclassificationApplyRequest),
    #[serde(rename = "metadata.reclassification.discard")]
    ReclassificationDiscard(ReclassificationDiscardRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(
    tag = "event",
    content = "payload",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MetadataEvent {
    EquipmentResolutionDecided {
        resolution_id: CanonicalId,
        session_id: CanonicalId,
        revision: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        camera_id: Option<CanonicalId>,
        #[serde(skip_serializing_if = "Option::is_none")]
        optical_profile_id: Option<CanonicalId>,
        decision: ResolutionDecision,
    },
    CameraMarkedUnregulated {
        camera_id: CanonicalId,
        effective_after: Rfc3339Timestamp,
        resolution_id: CanonicalId,
    },
    ReclassificationPlanned {
        plan_id: CanonicalId,
        source_session_id: CanonicalId,
        plan_result_snapshot_id: CanonicalId,
        replacement_session_count: u64,
        panel_consequence_count: u64,
        predecessor_group_retirement_count: u64,
        panel_lineage_count: u64,
        stale_mosaic_edge_count: u64,
        project_consequence_count: u64,
    },
    ReclassificationApplied {
        plan_id: CanonicalId,
        applied_reclassification_plan_revision_id: CanonicalId,
        predecessor_session_id: CanonicalId,
        apply_result_snapshot_id: CanonicalId,
        replacement_session_count: u64,
        accepted_panel_revision_count: u64,
        retired_predecessor_group_count: u64,
        panel_lineage_count: u64,
        invalidated_mosaic_edge_count: u64,
        project_replacement_proposal_count: u64,
    },
    ReclassificationDiscarded {
        plan_id: CanonicalId,
    },
}
