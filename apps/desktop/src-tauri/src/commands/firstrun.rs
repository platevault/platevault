//! Spec 003 first-run wizard and batch registration Tauri commands.
//!
//! Delegates to `app_core::first_run` use cases. Commands are registered
//! in `specta_builder()` in `lib.rs` for TS binding generation.

use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartRequest, FirstRunRestartResponse,
    FirstRunStateResponse, OrganizationState, RegisterSourceBatchRequest,
    RegisterSourceBatchResponse, RegisterSourceRequest, SourceKind,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

/// `firstrun.state` — get the current first-run wizard state.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn firstrun_state(
    state: State<'_, AppState>,
) -> Result<FirstRunStateResponse, ContractError> {
    tracing::debug!("firstrun.state");
    app_core::first_run::get_first_run_state(state.repo.pool()).await
}

/// `firstrun.complete` — mark the first-run wizard as complete.
///
/// Requires at least one raw source and one project source to be registered.
///
/// # Errors
/// Returns `Err(String)` if preconditions are not met or on database failure.
#[tauri::command]
#[specta::specta]
pub async fn firstrun_complete(
    state: State<'_, AppState>,
) -> Result<FirstRunCompleteResponse, ContractError> {
    tracing::debug!("firstrun.complete");
    app_core::first_run::complete_first_run(state.repo.pool(), &state.bus).await
}

/// `firstrun.restart` — restart the first-run wizard, returning existing sources.
///
/// Requires `confirm: true` in the request to prevent accidental restarts.
///
/// # Errors
/// Returns `Err(String)` if `confirm` is not `true` or on database failure.
#[tauri::command]
#[specta::specta]
pub async fn firstrun_restart(
    state: State<'_, AppState>,
    request: FirstRunRestartRequest,
) -> Result<FirstRunRestartResponse, ContractError> {
    tracing::debug!("firstrun.restart (confirm={})", request.confirm);
    if !request.confirm {
        return Err(ContractError::internal("firstrun.restart requires confirm=true"));
    }
    app_core::first_run::restart_first_run(state.repo.pool()).await
}

/// `roots.register.batch` — register multiple source directories at once.
///
/// Enforces that `inbox` kind sources are always `unorganized`, overriding
/// any value supplied by the frontend (spec 041 R-7).
///
/// # Errors
/// Returns `Err(String)` on catastrophic failure; per-item errors are in the response.
#[tauri::command]
#[specta::specta]
pub async fn roots_register_batch(
    state: State<'_, AppState>,
    request: RegisterSourceBatchRequest,
) -> Result<RegisterSourceBatchResponse, ContractError> {
    tracing::debug!("roots.register.batch ({} items)", request.sources.len());
    // Enforce inbox=unorganized regardless of what the frontend sent.
    let enforced_sources: Vec<RegisterSourceRequest> = request
        .sources
        .into_iter()
        .map(|mut src| {
            if src.kind == SourceKind::Inbox {
                src.organization_state = OrganizationState::Unorganized;
            }
            src
        })
        .collect();
    let enforced_request = RegisterSourceBatchRequest { sources: enforced_sources };

    app_core::first_run::register_source_batch(state.repo.pool(), &enforced_request).await
}
