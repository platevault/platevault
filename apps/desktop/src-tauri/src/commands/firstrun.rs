//! Spec 003 first-run wizard and batch registration Tauri commands.
//!
//! Delegates to `app_core::first_run` use cases. Commands are registered
//! in `specta_builder()` in `lib.rs` for TS binding generation.

use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartResponse, FirstRunStateResponse,
    RegisterSourceBatchRequest, RegisterSourceBatchResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `firstrun.state` — get the current first-run wizard state.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "firstrun.state")]
pub async fn firstrun_state(state: State<'_, AppState>) -> Result<FirstRunStateResponse, String> {
    tracing::debug!("firstrun.state");
    app_core::first_run::get_first_run_state(state.repo.pool()).await.map_err(|e| e.message)
}

/// `firstrun.complete` — mark the first-run wizard as complete.
///
/// Requires at least one raw source and one project source to be registered.
///
/// # Errors
/// Returns `Err(String)` if preconditions are not met or on database failure.
#[tauri::command]
#[specta::specta(rename = "firstrun.complete")]
pub async fn firstrun_complete(
    state: State<'_, AppState>,
) -> Result<FirstRunCompleteResponse, String> {
    tracing::debug!("firstrun.complete");
    app_core::first_run::complete_first_run(state.repo.pool(), &state.bus)
        .await
        .map_err(|e| e.message)
}

/// `firstrun.restart` — restart the first-run wizard, returning existing sources.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "firstrun.restart")]
pub async fn firstrun_restart(
    state: State<'_, AppState>,
) -> Result<FirstRunRestartResponse, String> {
    tracing::debug!("firstrun.restart");
    app_core::first_run::restart_first_run(state.repo.pool()).await.map_err(|e| e.message)
}

/// `roots.register.batch` — register multiple source directories at once.
///
/// # Errors
/// Returns `Err(String)` on catastrophic failure; per-item errors are in the response.
#[tauri::command]
#[specta::specta(rename = "roots.register.batch")]
pub async fn roots_register_batch(
    state: State<'_, AppState>,
    request: RegisterSourceBatchRequest,
) -> Result<RegisterSourceBatchResponse, String> {
    tracing::debug!("roots.register.batch ({} items)", request.sources.len());
    app_core::first_run::register_source_batch(state.repo.pool(), &request)
        .await
        .map_err(|e| e.message)
}
