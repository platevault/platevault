// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Inbox planning and session-materialization contracts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::shared::{
    BoundedList, CanonicalId, Digest, KeysetListOperation, LocalDate, MaterializationKind,
    MutationContext, NonBlankSafeText, PageRequest, Rfc3339Timestamp, SafeText, SupportedFrameKind,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InboxPlanState {
    Open,
    Approved,
    Applied,
    Discarded,
    Stale,
    Refused,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxMaterializationPlan {
    pub plan_id: CanonicalId,
    pub plan_revision: u64,
    pub state: InboxPlanState,
    pub canonical_plan_digest: Digest,
    pub input_evidence_revision: u64,
    pub configuration_revision_id: CanonicalId,
    pub acquisition_site_resolution_count: u64,
    pub plan_result_snapshot_id: CanonicalId,
    pub candidate_frame_count: u64,
    pub proposed_session_count: u64,
    pub blocked_frame_count: u64,
    pub warning_codes: BoundedList<SafeText, 100>,
    pub created_at: Rfc3339Timestamp,
    pub created_by: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<CanonicalId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SiteResolutionState {
    NeedsReview,
    Resolved,
    Conflict,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SiteResolutionDecision {
    Unresolved,
    AcceptedCandidate,
    Corrected,
    ReviewedLocalFallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimestampDecision {
    CanonicalInstantConfirmed,
    ReviewedLocalFallback,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionSiteResolution {
    pub resolution_id: CanonicalId,
    pub revision: u64,
    pub state: SiteResolutionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_site_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_timezone: Option<SafeText>,
    pub decision: SiteResolutionDecision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_decision: Option<TimestampDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_exposure_instant: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_exposure_timestamp: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_observing_night: Option<LocalDate>,
    pub conflict_codes: BoundedList<SafeText, 100>,
    pub evidence_refs: BoundedList<SafeText, 100>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_by: Option<CanonicalId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CandidateConfidence {
    Exact,
    Review,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionSiteCandidate {
    pub site_id: CanonicalId,
    pub label: SafeText,
    pub timezone: SafeText,
    pub confidence: CandidateConfidence,
    pub basis_codes: BoundedList<SafeText, 100>,
    pub evidence_refs: BoundedList<SafeText, 100>,
    pub derived_observing_night: LocalDate,
    pub conflict_codes: BoundedList<SafeText, 100>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MaterializationState {
    Ready,
    Applying,
    Cancelling,
    Cancelled,
    Applied,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMaterializationOperation {
    pub operation_id: CanonicalId,
    pub kind: MaterializationKind,
    pub state: MaterializationState,
    pub source_plan_id: CanonicalId,
    pub approved_plan_digest: Digest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_snapshot_id: Option<CanonicalId>,
    pub session_count: u64,
    pub frame_membership_count: u64,
    pub singleton_panel_group_count: u64,
    pub blocked_frame_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<Rfc3339Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<SafeText>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializationResultSession {
    pub ordinal: u64,
    pub session_id: CanonicalId,
    pub frame_kind: SupportedFrameKind,
    pub frame_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub singleton_panel_group_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub singleton_panel_revision_id: Option<CanonicalId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxProposedSession {
    pub ordinal: u64,
    pub proposed_session_key: SafeText,
    pub frame_kind: SupportedFrameKind,
    pub proposed_identity_digest: Digest,
    pub proposed_frame_count: u64,
    pub acquisition_site_resolution_id: CanonicalId,
    pub acquisition_site_resolution_revision: u64,
    pub warning_codes: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializationFrameItem {
    pub ordinal: u64,
    pub frame_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockedFrameItem {
    pub ordinal: u64,
    pub frame_id: CanonicalId,
    pub reason_codes: BoundedList<SafeText, 100>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMaterializationProgress {
    pub operation_id: CanonicalId,
    pub state: MaterializationState,
    pub processed_session_count: u64,
    pub total_session_count: u64,
    pub processed_frame_count: u64,
    pub total_frame_count: u64,
    pub cancel_safe: bool,
    pub updated_at: Rfc3339Timestamp,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InboxListOperation {
    AcquisitionSiteCandidate,
    ProposedSession,
    ProposedFrame,
    PlanBlockedFrame,
    ResultSession,
    ResultFrame,
    ResultBlockedFrame,
}

impl InboxListOperation {
    pub const ALL: [Self; 7] = [
        Self::AcquisitionSiteCandidate,
        Self::ProposedSession,
        Self::ProposedFrame,
        Self::PlanBlockedFrame,
        Self::ResultSession,
        Self::ResultFrame,
        Self::ResultBlockedFrame,
    ];
}

impl KeysetListOperation for InboxListOperation {
    fn query_name(&self) -> &'static str {
        match self {
            Self::AcquisitionSiteCandidate => "inbox.acquisition_site_candidate.list",
            Self::ProposedSession => "inbox.materialization_plan.proposed_session.list",
            Self::ProposedFrame => "inbox.materialization_plan.proposed_frame.list",
            Self::PlanBlockedFrame => "inbox.materialization_plan.blocked_frame.list",
            Self::ResultSession => "session.materialization.result_session.list",
            Self::ResultFrame => "session.materialization.result_frame.list",
            Self::ResultBlockedFrame => "session.materialization.blocked_frame.list",
        }
    }

    fn unique_order(&self) -> &'static [&'static str] {
        match self {
            Self::AcquisitionSiteCandidate => {
                &["confidenceRank DESC", "normalizedLabel ASC", "siteId ASC"]
            }
            Self::ProposedSession => &["ordinal ASC", "proposedSessionKey ASC"],
            Self::ProposedFrame
            | Self::PlanBlockedFrame
            | Self::ResultFrame
            | Self::ResultBlockedFrame => &["ordinal ASC", "frameId ASC"],
            Self::ResultSession => &["ordinal ASC", "sessionId ASC"],
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxPlanQueryRequest {
    pub plan_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteResolutionQueryRequest {
    pub plan_id: CanonicalId,
    pub resolution_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteCandidateListRequest {
    pub plan_id: CanonicalId,
    pub resolution_id: CanonicalId,
    pub resolution_revision: u64,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanSnapshotListRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposedFrameListRequest {
    pub plan_id: CanonicalId,
    pub plan_result_snapshot_id: CanonicalId,
    pub proposed_session_key: SafeText,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationQueryRequest {
    pub operation_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshotListRequest {
    pub operation_id: CanonicalId,
    pub result_snapshot_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationResultFrameListRequest {
    pub operation_id: CanonicalId,
    pub result_snapshot_id: CanonicalId,
    pub session_id: CanonicalId,
    pub page: PageRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum InboxQuery {
    #[serde(rename = "inbox.materialization_plan.query")]
    MaterializationPlan(InboxPlanQueryRequest),
    #[serde(rename = "inbox.acquisition_site_resolution.query")]
    AcquisitionSiteResolution(SiteResolutionQueryRequest),
    #[serde(rename = "inbox.acquisition_site_candidate.list")]
    AcquisitionSiteCandidateList(SiteCandidateListRequest),
    #[serde(rename = "inbox.materialization_plan.proposed_session.list")]
    ProposedSessionList(PlanSnapshotListRequest),
    #[serde(rename = "inbox.materialization_plan.proposed_frame.list")]
    ProposedFrameList(ProposedFrameListRequest),
    #[serde(rename = "inbox.materialization_plan.blocked_frame.list")]
    PlanBlockedFrameList(PlanSnapshotListRequest),
    #[serde(rename = "session.materialization.query")]
    Materialization(OperationQueryRequest),
    #[serde(rename = "session.materialization.result_session.list")]
    ResultSessionList(OperationSnapshotListRequest),
    #[serde(rename = "session.materialization.result_frame.list")]
    ResultFrameList(OperationResultFrameListRequest),
    #[serde(rename = "session.materialization.blocked_frame.list")]
    ResultBlockedFrameList(OperationSnapshotListRequest),
    #[serde(rename = "session.materialization.progress.query")]
    Progress(OperationQueryRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteResolutionDecisionInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_site_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corrected_timezone: Option<SafeText>,
    pub timestamp_decision: TimestampDecision,
    pub evidence_refs: BoundedList<SafeText, 100>,
    pub note: NonBlankSafeText,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteResolutionDecideRequest {
    pub plan_id: CanonicalId,
    pub resolution_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub expected_resolution_revision: u64,
    pub decision: SiteResolutionDecisionInput,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteResolutionDecideResponse {
    pub plan: InboxMaterializationPlan,
    pub resolution: AcquisitionSiteResolution,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxApproveRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub expected_input_evidence_revision: u64,
    pub expected_site_resolution_revisions_digest: Digest,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxApproveResponse {
    pub plan_id: CanonicalId,
    pub plan_revision: u64,
    pub approved_plan_digest: Digest,
    pub approved_at: Rfc3339Timestamp,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxApplyRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxApplyResponse {
    pub operation: SessionMaterializationOperation,
    pub audit_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxDiscardRequest {
    pub plan_id: CanonicalId,
    pub expected_plan_revision: u64,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializationCancelRequest {
    pub operation_id: CanonicalId,
    pub mutation_context: MutationContext,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "operation")]
pub enum InboxCommand {
    #[serde(rename = "inbox.acquisition_site_resolution.decide")]
    AcquisitionSiteResolutionDecide(SiteResolutionDecideRequest),
    #[serde(rename = "inbox.materialization.approve")]
    MaterializationApprove(InboxApproveRequest),
    #[serde(rename = "inbox.materialization.apply")]
    MaterializationApply(InboxApplyRequest),
    #[serde(rename = "inbox.materialization.discard")]
    MaterializationDiscard(InboxDiscardRequest),
    #[serde(rename = "session.materialization.cancel")]
    MaterializationCancel(MaterializationCancelRequest),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(
    tag = "event",
    content = "payload",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InboxEvent {
    AcquisitionSiteResolved {
        plan_id: CanonicalId,
        resolution_id: CanonicalId,
        revision: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        selected_site_id: Option<CanonicalId>,
        #[serde(skip_serializing_if = "Option::is_none")]
        selected_timezone: Option<SafeText>,
        decision: SiteResolutionDecision,
        derived_observing_night: LocalDate,
    },
    MaterializationApproved {
        plan_id: CanonicalId,
        plan_revision: u64,
        approved_plan_digest: Digest,
    },
    MaterializationProgressed {
        operation_id: CanonicalId,
        processed_session_count: u64,
        total_session_count: u64,
        processed_frame_count: u64,
        total_frame_count: u64,
    },
    MaterializationCancelled {
        operation_id: CanonicalId,
        source_plan_id: CanonicalId,
    },
    MaterializationApplied {
        operation_id: CanonicalId,
        kind: MaterializationKind,
        source_plan_id: CanonicalId,
        approved_plan_digest: Digest,
        result_snapshot_id: CanonicalId,
        session_count: u64,
        frame_membership_count: u64,
        singleton_panel_group_count: u64,
        blocked_frame_count: u64,
    },
    MaterializationFailed {
        operation_id: CanonicalId,
        kind: MaterializationKind,
        source_plan_id: CanonicalId,
        failure_code: SafeText,
    },
    MaterializationDiscarded {
        plan_id: CanonicalId,
    },
}
