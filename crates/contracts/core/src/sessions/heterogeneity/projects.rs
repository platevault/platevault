// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Related-session, project-pin, and Update View contracts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::shared::{
    BoundedList, CanonicalId, CanonicalRelativePath, DestinationCollisionKey, Digest,
    FiniteDecimal, KeysetListOperation, MutationContext, PageRequest, Rfc3339Timestamp, SafeText,
    StableIdentity,
};

const fn default_true() -> bool {
    true
}

pub const MAX_UPDATE_VIEW_SESSIONS: u64 = 500;
pub const MAX_UPDATE_VIEW_ITEMS: u64 = 100_000;
pub const MAX_UPDATE_VIEW_SOURCE_FRAMES: u64 = 100_000;
pub const MAX_UPDATE_VIEW_SOURCE_BYTES: u64 = 17_592_186_044_416;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RelatedSessionKind {
    PanelSibling,
    MosaicPanel,
    SessionReplacement,
    ReviewedCrossTarget,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RelatedEvidenceSummary {
    pub target_compatibility: SafeText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint_coverage_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_separation_percent: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub residual_sky_rotation_deg: Option<FiniteDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equipment_compatibility: Option<SafeText>,
    pub warning_codes: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RelatedSession {
    pub project_id: CanonicalId,
    pub session_id: CanonicalId,
    pub relation_kind: RelatedSessionKind,
    pub related_through_session_ids: BoundedList<CanonicalId, 100>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel_group_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mosaic_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_for_session_id: Option<CanonicalId>,
    pub evidence_id: CanonicalId,
    pub evidence_summary: RelatedEvidenceSummary,
    pub first_available_at: Rfc3339Timestamp,
    pub already_pinned: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PinSource {
    ExplicitAdd,
    ExplicitReplacement,
    ProjectCreation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionPin {
    pub project_id: CanonicalId,
    pub session_id: CanonicalId,
    pub pin_revision: u64,
    pub pinned_at: Rfc3339Timestamp,
    pub pinned_by: CanonicalId,
    pub source: PinSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_session_evidence_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaces_session_id: Option<CanonicalId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLifecycle {
    SetupIncomplete,
    Ready,
    Prepared,
    Processing,
    Blocked,
    Completed,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectViewState {
    pub project_id: CanonicalId,
    pub project_revision: u64,
    pub lifecycle: ProjectLifecycle,
    pub pinned_session_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized_snapshot_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_manifest_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_manifest_version: Option<u64>,
    pub materialized_session_count: u64,
    pub unmaterialized_session_count: u64,
    pub stale: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_view_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub manifest_id: CanonicalId,
    pub version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_manifest_id: Option<CanonicalId>,
    pub materialized_snapshot_id: CanonicalId,
    pub active_entry_count: u64,
    pub active_correction_overlay_count: u64,
    pub created_at: Rfc3339Timestamp,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionOverlay {
    pub overlay_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_overlay_id: Option<CanonicalId>,
    pub applied_reclassification_plan_revision_id: CanonicalId,
    pub mapping_count: u64,
    pub created_at: Rfc3339Timestamp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpdateViewPlanState {
    Open,
    Approved,
    Applying,
    Stopped,
    Applied,
    Failed,
    Stale,
    Discarded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DestinationPlatform {
    Linux,
    Macos,
    Windows,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DestinationRootIdentity {
    pub root_id: CanonicalId,
    pub canonical_root_key: SafeText,
    pub stable_file_identity: StableIdentity,
    pub platform: DestinationPlatform,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewWorkLimits {
    pub maximum_sessions: u64,
    pub maximum_items: u64,
    pub maximum_source_frames: u64,
    pub maximum_source_bytes: u64,
}

impl Default for UpdateViewWorkLimits {
    fn default() -> Self {
        Self {
            maximum_sessions: MAX_UPDATE_VIEW_SESSIONS,
            maximum_items: MAX_UPDATE_VIEW_ITEMS,
            maximum_source_frames: MAX_UPDATE_VIEW_SOURCE_FRAMES,
            maximum_source_bytes: MAX_UPDATE_VIEW_SOURCE_BYTES,
        }
    }
}

impl UpdateViewWorkLimits {
    #[must_use]
    pub const fn is_contract_limit(&self) -> bool {
        self.maximum_sessions == MAX_UPDATE_VIEW_SESSIONS
            && self.maximum_items == MAX_UPDATE_VIEW_ITEMS
            && self.maximum_source_frames == MAX_UPDATE_VIEW_SOURCE_FRAMES
            && self.maximum_source_bytes == MAX_UPDATE_VIEW_SOURCE_BYTES
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewContinuation {
    pub remaining_session_count: u64,
    pub next_session_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionOverlayPreview {
    pub predecessor_session_id: CanonicalId,
    pub applied_reclassification_plan_revision_id: CanonicalId,
    pub mapping_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewApproval {
    pub approval_id: CanonicalId,
    pub approved_at: Rfc3339Timestamp,
    pub approved_by: CanonicalId,
    pub plan_revision: u64,
    pub approved_plan_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewPlan {
    pub plan_id: CanonicalId,
    pub plan_revision: u64,
    pub project_id: CanonicalId,
    pub state: UpdateViewPlanState,
    pub project_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_snapshot_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_view_revision: Option<u64>,
    pub destination_root: DestinationRootIdentity,
    pub plan_digest: Digest,
    pub pinned_session_snapshot_count: u64,
    pub added_session_count: u64,
    pub item_count: u64,
    pub source_frame_count: u64,
    pub source_byte_count: u64,
    pub conflict_count: u64,
    pub work_limits: UpdateViewWorkLimits,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<UpdateViewContinuation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correction_overlay_preview: Option<CorrectionOverlayPreview>,
    pub created_at: Rfc3339Timestamp,
    pub created_by: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<UpdateViewApproval>,
}

impl UpdateViewPlan {
    #[must_use]
    pub fn within_work_limits(&self) -> bool {
        self.work_limits.is_contract_limit()
            && self.added_session_count <= MAX_UPDATE_VIEW_SESSIONS
            && self.item_count <= MAX_UPDATE_VIEW_ITEMS
            && self.source_frame_count <= MAX_UPDATE_VIEW_SOURCE_FRAMES
            && self.source_byte_count <= MAX_UPDATE_VIEW_SOURCE_BYTES
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSourceIdentity {
    pub file_record_id: CanonicalId,
    pub stable_file_identity: StableIdentity,
    pub source_root_id: CanonicalId,
    pub source_relative_path: CanonicalRelativePath,
    pub no_follow: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpdateViewAction {
    CreateDirectory,
    CreateLink,
    Copy,
    WriteManifest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExpectedDestinationState {
    Absent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewItem {
    pub ordinal: u64,
    pub item_id: CanonicalId,
    pub session_id: CanonicalId,
    pub action: UpdateViewAction,
    pub destination_relative_path: CanonicalRelativePath,
    pub destination_collision_key: DestinationCollisionKey,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PinnedSourceIdentity>,
    pub expected_destination_state: ExpectedDestinationState,
    pub approved_content_fingerprint: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpdateViewConflictCode {
    PathExists,
    IncompatibleDestination,
    SourceUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewConflict {
    pub ordinal: u64,
    pub code: UpdateViewConflictCode,
    pub item_id: CanonicalId,
    pub destination_relative_path: CanonicalRelativePath,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_entry_fingerprint: Option<Digest>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewOverlayMapping {
    pub ordinal: u64,
    pub predecessor_entry_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_entry_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclusion_reason_code: Option<SafeText>,
}

impl UpdateViewOverlayMapping {
    #[must_use]
    pub fn has_exactly_one_outcome(&self) -> bool {
        self.replacement_entry_id.is_some() != self.exclusion_reason_code.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpdateViewOperationState {
    Applying,
    Stopping,
    Stopped,
    Applied,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewOperationProgress {
    pub operation_id: CanonicalId,
    pub plan_id: CanonicalId,
    pub state: UpdateViewOperationState,
    pub completed_items: u64,
    pub total_items: u64,
    pub completed_source_bytes: u64,
    pub total_source_bytes: u64,
    pub cancel_safe: bool,
    pub updated_at: Rfc3339Timestamp,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectListOperation {
    RelatedSession,
    Pin,
    MaterializedSession,
    UnmaterializedSession,
    ManifestEntry,
    ManifestCorrectionOverlay,
    CorrectionOverlayMapping,
    PlanPinnedSession,
    PlanAddedSession,
    PlanItem,
    PlanConflict,
    PlanOverlayMapping,
}

impl ProjectListOperation {
    pub const ALL: [Self; 12] = [
        Self::RelatedSession,
        Self::Pin,
        Self::MaterializedSession,
        Self::UnmaterializedSession,
        Self::ManifestEntry,
        Self::ManifestCorrectionOverlay,
        Self::CorrectionOverlayMapping,
        Self::PlanPinnedSession,
        Self::PlanAddedSession,
        Self::PlanItem,
        Self::PlanConflict,
        Self::PlanOverlayMapping,
    ];
}

impl KeysetListOperation for ProjectListOperation {
    fn query_name(&self) -> &'static str {
        match self {
            Self::RelatedSession => "project.related_session.list",
            Self::Pin => "project.view_state.pin.list",
            Self::MaterializedSession => "project.view_state.materialized_session.list",
            Self::UnmaterializedSession => "project.view_state.unmaterialized_session.list",
            Self::ManifestEntry => "project.manifest.entry.list",
            Self::ManifestCorrectionOverlay => "project.manifest.correction_overlay.list",
            Self::CorrectionOverlayMapping => "project.correction_overlay.mapping.list",
            Self::PlanPinnedSession => "project.update_view.pinned_session.list",
            Self::PlanAddedSession => "project.update_view.added_session.list",
            Self::PlanItem => "project.update_view.item.list",
            Self::PlanConflict => "project.update_view.conflict.list",
            Self::PlanOverlayMapping => "project.update_view.overlay_mapping.list",
        }
    }

    fn unique_order(&self) -> &'static [&'static str] {
        match self {
            Self::RelatedSession => &["firstAvailableAt DESC", "sessionId ASC"],
            Self::Pin | Self::MaterializedSession | Self::UnmaterializedSession => {
                &["sessionId ASC"]
            }
            Self::ManifestEntry
            | Self::ManifestCorrectionOverlay
            | Self::CorrectionOverlayMapping
            | Self::PlanPinnedSession
            | Self::PlanAddedSession
            | Self::PlanItem
            | Self::PlanConflict
            | Self::PlanOverlayMapping => &["ordinal ASC"],
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RelatedSessionListRequest {
    pub project_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation_kinds: Option<BoundedList<RelatedSessionKind, 100>>,
    #[serde(default = "default_true")]
    #[schemars(default = "default_true")]
    pub include_pinned: bool,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectQueryRequest {
    pub project_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRevisionPageRequest {
    pub project_id: CanonicalId,
    pub project_revision: u64,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotPageRequest {
    pub project_id: CanonicalId,
    pub materialized_snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnmaterializedSessionListRequest {
    pub project_id: CanonicalId,
    pub project_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized_snapshot_id: Option<CanonicalId>,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManifestQueryRequest {
    pub project_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_id: Option<CanonicalId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPageRequest {
    pub project_id: CanonicalId,
    pub manifest_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPageRequest {
    pub project_id: CanonicalId,
    pub overlay_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanQueryRequest {
    pub plan_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanPageRequest {
    pub plan_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewOperationQueryRequest {
    pub operation_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum ProjectQuery {
    #[serde(rename = "project.related_session.list")]
    RelatedSessionList(RelatedSessionListRequest),
    #[serde(rename = "project.view_state.query")]
    ViewState(ProjectQueryRequest),
    #[serde(rename = "project.view_state.pin.list")]
    PinList(ProjectRevisionPageRequest),
    #[serde(rename = "project.view_state.materialized_session.list")]
    MaterializedSessionList(ProjectSnapshotPageRequest),
    #[serde(rename = "project.view_state.unmaterialized_session.list")]
    UnmaterializedSessionList(UnmaterializedSessionListRequest),
    #[serde(rename = "project.manifest.query")]
    Manifest(ManifestQueryRequest),
    #[serde(rename = "project.manifest.entry.list")]
    ManifestEntryList(ManifestPageRequest),
    #[serde(rename = "project.manifest.correction_overlay.list")]
    ManifestCorrectionOverlayList(ManifestPageRequest),
    #[serde(rename = "project.correction_overlay.mapping.list")]
    CorrectionOverlayMappingList(OverlayPageRequest),
    #[serde(rename = "project.update_view.query")]
    UpdateView(PlanQueryRequest),
    #[serde(rename = "project.update_view.pinned_session.list")]
    UpdateViewPinnedSessionList(PlanPageRequest),
    #[serde(rename = "project.update_view.added_session.list")]
    UpdateViewAddedSessionList(PlanPageRequest),
    #[serde(rename = "project.update_view.item.list")]
    UpdateViewItemList(PlanPageRequest),
    #[serde(rename = "project.update_view.conflict.list")]
    UpdateViewConflictList(PlanPageRequest),
    #[serde(rename = "project.update_view.overlay_mapping.list")]
    UpdateViewOverlayMappingList(PlanPageRequest),
    #[serde(rename = "project.update_view.operation.query")]
    UpdateViewOperation(UpdateViewOperationQueryRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionPinAddRequest {
    pub project_id: CanonicalId,
    pub session_id: CanonicalId,
    pub expected_project_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_session_evidence_id: Option<CanonicalId>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionPinAddResponse {
    pub pin: ProjectSessionPin,
    pub view_state: ProjectViewState,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionPinReplaceRequest {
    pub project_id: CanonicalId,
    pub predecessor_session_id: CanonicalId,
    pub replacement_session_ids: BoundedList<CanonicalId, 500>,
    pub applied_reclassification_plan_revision_id: CanonicalId,
    pub expected_project_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementContext {
    pub predecessor_session_id: CanonicalId,
    pub applied_reclassification_plan_revision_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewPlanRequest {
    pub project_id: CanonicalId,
    pub expected_project_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_source_view_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_ids: Option<BoundedList<CanonicalId, 500>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_context: Option<ReplacementContext>,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewApproveRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewApplyRequest {
    pub plan_id: CanonicalId,
    pub approval_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewApplyResponse {
    pub operation_id: CanonicalId,
    pub plan_id: CanonicalId,
    pub state: UpdateViewOperationState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewDiscardRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateViewCancelRequest {
    pub operation_id: CanonicalId,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum ProjectCommand {
    #[serde(rename = "project.session_pin.add")]
    SessionPinAdd(ProjectSessionPinAddRequest),
    #[serde(rename = "project.session_pin.replace")]
    SessionPinReplace(ProjectSessionPinReplaceRequest),
    #[serde(rename = "project.update_view.plan")]
    UpdateViewPlan(UpdateViewPlanRequest),
    #[serde(rename = "project.update_view.approve")]
    UpdateViewApprove(UpdateViewApproveRequest),
    #[serde(rename = "project.update_view.apply")]
    UpdateViewApply(UpdateViewApplyRequest),
    #[serde(rename = "project.update_view.discard")]
    UpdateViewDiscard(UpdateViewDiscardRequest),
    #[serde(rename = "project.update_view.cancel")]
    UpdateViewCancel(UpdateViewCancelRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(
    tag = "event",
    content = "payload",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ProjectEvent {
    RelatedSessionAvailable {
        project_id: CanonicalId,
        session_id: CanonicalId,
        relation_kind: RelatedSessionKind,
        evidence_id: CanonicalId,
    },
    SessionPinned {
        project_id: CanonicalId,
        session_id: CanonicalId,
        pin_revision: u64,
        source: PinSource,
    },
    SessionPinReplaced {
        project_id: CanonicalId,
        predecessor_session_id: CanonicalId,
        replacement_session_ids: BoundedList<CanonicalId, 500>,
        applied_reclassification_plan_revision_id: CanonicalId,
    },
    ViewStale {
        project_id: CanonicalId,
        unmaterialized_session_count: u64,
    },
    UpdateViewPlanned {
        project_id: CanonicalId,
        plan_id: CanonicalId,
        added_session_count: u64,
        item_count: u64,
        source_frame_count: u64,
        source_byte_count: u64,
        conflict_count: u64,
        overlay_mapping_count: u64,
        remaining_session_count: u64,
    },
    UpdateViewApproved {
        project_id: CanonicalId,
        plan_id: CanonicalId,
        approval_id: CanonicalId,
        plan_revision: u64,
    },
    UpdateViewItemApplied {
        operation_id: CanonicalId,
        plan_id: CanonicalId,
        item_id: CanonicalId,
        session_id: CanonicalId,
        destination_relative_path: CanonicalRelativePath,
    },
    UpdateViewStopped {
        operation_id: CanonicalId,
        plan_id: CanonicalId,
        #[serde(skip_serializing_if = "Option::is_none")]
        item_id: Option<CanonicalId>,
        error_code: SafeText,
    },
    UpdateViewFailed {
        operation_id: CanonicalId,
        plan_id: CanonicalId,
        #[serde(skip_serializing_if = "Option::is_none")]
        item_id: Option<CanonicalId>,
        error_code: SafeText,
        resumable: bool,
    },
    UpdateViewApplied {
        operation_id: CanonicalId,
        plan_id: CanonicalId,
        materialized_snapshot_id: CanonicalId,
        applied_item_count: u64,
    },
}
