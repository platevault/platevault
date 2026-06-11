//! Rust-side contract DTOs for guided first-project-flow commands (spec 010).
//!
//! Three commands:
//! - `guided.state.get`     — read current state for UI hydration.
//! - `guided.step.complete` — mark a step complete (explicit path).
//! - `guided.dismiss`       — dismiss the coach.
//! - `guided.restart`       — restart from Settings (not a separate contract file
//!   but handled by the same use case module; returns `GuidedStateResponse`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared state DTO ─────────────────────────────────────────────────────────

/// Current coach state returned by `guided.state.get` and after transitions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedFlowStateDto {
    /// Id of the active step, or `null` when dismissed/idle/completed.
    pub current_step: Option<String>,
    /// Ids of completed steps in order of completion.
    pub completed_steps: Vec<String>,
    /// True when the coach has been dismissed.
    pub dismissed: bool,
    /// RFC-3339 UTC timestamp when dismissed, or `null`.
    pub dismissed_at: Option<String>,
    /// RFC-3339 UTC timestamp of the last transition.
    pub updated_at: String,
}

// ── guided.state.get ─────────────────────────────────────────────────────────

/// Response from `guided.state.get`.
///
/// On `state_corrupted` the row has already been reset to Idle server-side;
/// the caller should display a non-blocking notice and retry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedStateGetResponse {
    pub state: GuidedFlowStateDto,
}

// ── guided.step.complete ─────────────────────────────────────────────────────

/// Request for `guided.step.complete`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedStepCompleteRequest {
    /// Stable id of the step to complete (e.g. `inbox.confirm_first`).
    pub step_id: String,
}

/// Response from `guided.step.complete`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedStepCompleteResponse {
    /// True when this call transitioned the step into `completedSteps`.
    pub completed: bool,
    /// Id of the next uncompleted step, or `null` when the flow is complete.
    pub next_step: Option<String>,
    /// Updated state after the transition.
    pub state: GuidedFlowStateDto,
}

// ── guided.dismiss ───────────────────────────────────────────────────────────

/// Response from `guided.dismiss`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedDismissResponse {
    /// RFC-3339 UTC timestamp the dismiss was recorded.
    pub dismissed_at: String,
}

// ── guided.restart ───────────────────────────────────────────────────────────

/// Response from `guided.restart`.
///
/// - If flow was `Dismissed`: resumes at the lowest uncompleted step; previously
///   completed steps retained.
/// - If flow was `Completed`: resets all progress to Idle (replay from step 1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GuidedRestartResponse {
    /// Updated state after restart.
    pub state: GuidedFlowStateDto,
}
