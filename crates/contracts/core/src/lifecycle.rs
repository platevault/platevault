//! Rust DTOs mirroring `specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json`.
//!
//! Contract version: 2.0.0.
//! Field names are camelCase to match the JSON envelope sweep.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const CONTRACT_VERSION: &str = "2.0.0";

// ── State enums — mirror the JSON $defs exactly ───────────────────────────────

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectState {
    SetupIncomplete,
    Ready,
    Prepared,
    Processing,
    Completed,
    Archived,
    Blocked,
}

/// Note: `paused` is a domain-internal state (R-Pause-1); not surfaced in the transition contract.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PlanState {
    Draft,
    ReadyForReview,
    Approved,
    Applying,
    Applied,
    PartiallyApplied,
    Failed,
    Cancelled,
    Discarded,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Discovered,
    Candidate,
    NeedsReview,
    Confirmed,
    Rejected,
    Ignored,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DataSourceState {
    Active,
    Missing,
    Disabled,
    ReconnectRequired,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileRecordState {
    Observed,
    Missing,
    Changed,
    Classified,
    Rejected,
    Protected,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PreparedSourceState {
    NotCreated,
    Planned,
    Ready,
    Stale,
    Retired,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionState {
    Current,
    Stale,
    Regenerating,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransitionActor {
    User,
    System,
}

// ── Per-family request DTOs ───────────────────────────────────────────────────

macro_rules! transition_request_base {
    ($name:ident, $entity_type_str:literal, $state_ty:ty) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            pub contract_version: String,
            pub request_id: Uuid,
            pub entity_type: String,
            pub entity_id: Uuid,
            pub current_state: $state_ty,
            pub next_state: $state_ty,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub action_label: Option<String>,
            pub actor: TransitionActor,
        }

        impl $name {
            #[must_use]
            pub fn new(
                request_id: Uuid,
                entity_id: Uuid,
                current_state: $state_ty,
                next_state: $state_ty,
                actor: TransitionActor,
            ) -> Self {
                Self {
                    contract_version: CONTRACT_VERSION.to_owned(),
                    request_id,
                    entity_type: $entity_type_str.to_owned(),
                    entity_id,
                    current_state,
                    next_state,
                    action_label: None,
                    actor,
                }
            }
        }
    };
}

transition_request_base!(ProjectTransitionRequest, "project", ProjectState);
transition_request_base!(PlanTransitionRequest, "plan", PlanState);
transition_request_base!(InventorySessionTransitionRequest, "inventory_session", SessionState);
transition_request_base!(CalibrationSessionTransitionRequest, "calibration_session", SessionState);
transition_request_base!(DataSourceTransitionRequest, "data_source", DataSourceState);
transition_request_base!(PreparedSourceTransitionRequest, "prepared_source", PreparedSourceState);
transition_request_base!(ProjectionTransitionRequest, "projection", ProjectionState);
transition_request_base!(FileRecordTransitionRequest, "file_record", FileRecordState);

// ── Discriminated request enum ────────────────────────────────────────────────

/// Discriminated request — one variant per entity family.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "entityType", rename_all = "snake_case")]
pub enum TransitionRequest {
    Project(ProjectTransitionRequest),
    Plan(PlanTransitionRequest),
    InventorySession(InventorySessionTransitionRequest),
    CalibrationSession(CalibrationSessionTransitionRequest),
    DataSource(DataSourceTransitionRequest),
    PreparedSource(PreparedSourceTransitionRequest),
    Projection(ProjectionTransitionRequest),
    FileRecord(FileRecordTransitionRequest),
}

// ── Error envelope ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransitionErrorCode {
    TransitionRefused,
    EntityNotFound,
    ActorNotAuthorised,
    PlanRequired,
    PlanNotApproved,
    ProvenanceUnreviewed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransitionError {
    pub code: TransitionErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ── Response ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransitionStatus {
    Success,
    Noop,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransitionResponse {
    pub status: TransitionStatus,
    pub contract_version: String,
    pub request_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TransitionError>,
}

impl TransitionResponse {
    #[must_use]
    pub fn success(request_id: Uuid, applied_at: String, prior: String, new: String, audit_id: Uuid) -> Self {
        Self {
            status: TransitionStatus::Success,
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            applied_at: Some(applied_at),
            prior_state: Some(prior),
            new_state: Some(new),
            audit_id: Some(audit_id),
            plan_id: None,
            error: None,
        }
    }

    #[must_use]
    pub fn noop(request_id: Uuid) -> Self {
        Self {
            status: TransitionStatus::Noop,
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            applied_at: None,
            prior_state: None,
            new_state: None,
            audit_id: None,
            plan_id: None,
            error: None,
        }
    }

    #[must_use]
    pub fn error(request_id: Uuid, error: TransitionError) -> Self {
        Self {
            status: TransitionStatus::Error,
            contract_version: CONTRACT_VERSION.to_owned(),
            request_id,
            applied_at: None,
            prior_state: None,
            new_state: None,
            audit_id: None,
            plan_id: None,
            error: Some(error),
        }
    }
}
