//! Rust DTOs mirroring `specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json`.
//!
//! Contract version: 2.0.0.
//! Field names are camelCase to match the JSON envelope sweep.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

pub const CONTRACT_VERSION: &str = "2.0.0";

// ── State enums — mirror the JSON $defs exactly ───────────────────────────────

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
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

/// Ten-state plan lifecycle (spec 017 data-model.md `PlanState`).
/// `paused` is surfaced here so the list/detail contracts can filter on it (R-Pause-1).
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PlanState {
    Draft,
    ReadyForReview,
    Approved,
    Applying,
    /// Mid-apply suspension (R-Pause-1). Written only by spec 025's executor.
    Paused,
    Applied,
    PartiallyApplied,
    Failed,
    Cancelled,
    Discarded,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Discovered,
    Candidate,
    NeedsReview,
    Confirmed,
    Rejected,
    Ignored,
}

impl SessionState {
    /// Canonical persisted/serialized string for this state.
    ///
    /// These values MUST stay byte-identical to the `#[serde(rename_all =
    /// "snake_case")]` output and the stored DB / IPC strings.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            SessionState::Discovered => "discovered",
            SessionState::Candidate => "candidate",
            SessionState::NeedsReview => "needs_review",
            SessionState::Confirmed => "confirmed",
            SessionState::Rejected => "rejected",
            SessionState::Ignored => "ignored",
        }
    }
}

/// Error returned when a string cannot be parsed into a [`SessionState`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseSessionStateError(pub String);

impl std::fmt::Display for ParseSessionStateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown session state: {}", self.0)
    }
}

impl std::error::Error for ParseSessionStateError {}

/// Single canonical, strict parser for [`SessionState`].
///
/// Unknown values are rejected (no silent fallback); callers apply any
/// fallback explicitly (e.g. `.unwrap_or(SessionState::Discovered)`).
impl std::str::FromStr for SessionState {
    type Err = ParseSessionStateError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "discovered" => Ok(SessionState::Discovered),
            "candidate" => Ok(SessionState::Candidate),
            "needs_review" => Ok(SessionState::NeedsReview),
            "confirmed" => Ok(SessionState::Confirmed),
            "rejected" => Ok(SessionState::Rejected),
            "ignored" => Ok(SessionState::Ignored),
            other => Err(ParseSessionStateError(other.to_owned())),
        }
    }
}

impl TryFrom<&str> for SessionState {
    type Error = ParseSessionStateError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        s.parse()
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum DataSourceState {
    Active,
    Missing,
    Disabled,
    ReconnectRequired,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum FileRecordState {
    Observed,
    Missing,
    Changed,
    Classified,
    Rejected,
    Protected,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PreparedSourceState {
    NotCreated,
    Planned,
    Ready,
    Stale,
    Retired,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionState {
    Current,
    Stale,
    Regenerating,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TransitionActor {
    User,
    System,
}

// ── Per-family request DTOs ───────────────────────────────────────────────────

macro_rules! transition_request_base {
    ($name:ident, $entity_type_str:literal, $state_ty:ty) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
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

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
pub enum TransitionErrorCode {
    // Use dotted-form codes to match
    // `specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json`
    // §$defs.ErrorCode — the contract is the source of truth (Constitution §V).
    #[serde(rename = "transition.refused")]
    TransitionRefused,
    #[serde(rename = "entity.not_found")]
    EntityNotFound,
    #[serde(rename = "actor.not_authorised")]
    ActorNotAuthorised,
    #[serde(rename = "plan.required")]
    PlanRequired,
    #[serde(rename = "plan.not_approved")]
    PlanNotApproved,
    #[serde(rename = "provenance.unreviewed")]
    ProvenanceUnreviewed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransitionError {
    pub code: TransitionErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<crate::JsonAny>,
}

// ── Response ──────────────────────────────────────────────────────────────────

#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TransitionStatus {
    Success,
    Noop,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
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
    pub fn success(
        request_id: Uuid,
        applied_at: String,
        prior: String,
        new: String,
        audit_id: Uuid,
    ) -> Self {
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
