//! Guided first-project-flow Tauri commands (spec 010).
//!
//! Thin passthroughs to `app_core::guided_flow` use cases.
//! Commands are registered in `specta_builder()` in `lib.rs`.

use contracts_core::guided::{
    GuidedDismissResponse, GuidedRestartResponse, GuidedStateGetResponse,
    GuidedStepCompleteRequest, GuidedStepCompleteResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `guided.state.get` — read current coach state for UI hydration.
///
/// Returns the current `GuidedFlowStateDto`.  On the first call after a
/// corruption reset, returns `Err` with code `state_corrupted`; the row has
/// already been reset to Idle server-side.  Retry to get the fresh state.
///
/// # Errors
/// Returns `Err(String)` on corruption (informational) or database failure.
#[tauri::command]
#[specta::specta(rename = "guided.state.get")]
pub async fn guided_state_get(
    state: State<'_, AppState>,
) -> Result<GuidedStateGetResponse, String> {
    tracing::debug!("guided.state.get");
    app_core::guided_flow::get_state(state.repo.pool(), &state.bus).await.map_err(|e| e.to_string())
}

/// `guided.step.complete` — mark a step complete and advance the coach.
///
/// The step must be a known registry id (e.g. `inbox.confirm_first`).
/// If the flow is dismissed, returns an error.
///
/// # Errors
/// Returns `Err(String)` on unknown step id, dismissed flow, or database failure.
#[tauri::command]
#[specta::specta(rename = "guided.step.complete")]
pub async fn guided_step_complete(
    state: State<'_, AppState>,
    request: GuidedStepCompleteRequest,
) -> Result<GuidedStepCompleteResponse, String> {
    tracing::debug!("guided.step.complete step_id={}", request.step_id);
    app_core::guided_flow::complete_step(state.repo.pool(), &request)
        .await
        .map_err(|e| e.to_string())
}

/// `guided.dismiss` — dismiss the coach, hiding all hints.
///
/// Idempotent: calling again on an already-dismissed flow returns the
/// original `dismissedAt` timestamp.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "guided.dismiss")]
pub async fn guided_dismiss(state: State<'_, AppState>) -> Result<GuidedDismissResponse, String> {
    tracing::debug!("guided.dismiss");
    app_core::guided_flow::dismiss(state.repo.pool()).await.map_err(|e| e.to_string())
}

/// `guided.restart` — restart the coach from Settings.
///
/// - `Dismissed → Active(lowest uncompleted step)`: retains completed steps.
/// - `Completed → Idle`: resets all progress (A1 ratified 2026-05-22).
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "guided.restart")]
pub async fn guided_restart(state: State<'_, AppState>) -> Result<GuidedRestartResponse, String> {
    tracing::debug!("guided.restart");
    app_core::guided_flow::restart(state.repo.pool()).await.map_err(|e| e.to_string())
}

/// `guided.activate` — activate the flow after first-run setup completes.
///
/// If the flow is Idle, transitions to `Active(first uncompleted step)`.
/// Idempotent when already active or dismissed.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "guided.activate")]
pub async fn guided_activate(
    state: State<'_, AppState>,
) -> Result<contracts_core::guided::GuidedFlowStateDto, String> {
    tracing::debug!("guided.activate");
    app_core::guided_flow::activate_after_setup(state.repo.pool()).await.map_err(|e| e.to_string())
}
