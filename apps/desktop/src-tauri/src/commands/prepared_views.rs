//! Prepared source view Tauri commands (spec 026).
//!
//! ## Commands
//!
//! - `preparedview.list` — list all prepared source views for a project.
//! - `preparedview.remove` — create a `ViewRemovalPlan` for a view, routed
//!   through the spec 017/025 plan pipeline.
//! - `preparedview.regenerate` — create a `ViewRegenerationPlan` for a removed
//!   or stale view, routed through the plan pipeline.
//!
//! All write operations return a `plan_id` that enters the standard
//! `plans.approve` → `plan.apply` pipeline. Destructive destination is always
//! `archive` (R-026-Dest-Archive).

use app_core::prepared_views;
use contracts_core::prepared_views::{
    PreparedViewListResponse, PreparedViewRegenerateResponse, PreparedViewRemoveResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

fn contract_err(e: contracts_core::ContractError) -> String {
    serde_json::to_string(&e).unwrap_or(e.code)
}

// ── preparedview.list ─────────────────────────────────────────────────────────

/// `preparedview.list` — list all prepared source views for a project.
///
/// # Errors
///
/// Returns `Err(ContractError)` on database failure or if the project does not
/// exist.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri deserializes String args by value
pub async fn preparedview_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<PreparedViewListResponse, String> {
    prepared_views::list_views(state.repo.pool(), &project_id).await.map_err(contract_err)
}

// ── preparedview.remove ───────────────────────────────────────────────────────

/// `preparedview.remove` — create a `ViewRemovalPlan` for a prepared source
/// view.
///
/// The response `planId` should be routed through `plans.approve` then
/// `plan.apply` to physically remove the view links/copies.
///
/// Destructive destination is always `archive` (R-026-Dest-Archive).
///
/// # Errors
///
/// Returns `Err(ContractError)` with codes:
/// - `view.not_found`         — view does not exist.
/// - `view.in_use`            — another plan is applying against this view.
/// - `view.mixed_kind`        — view is in `kind_diverged` state.
/// - `view.unsupported_kind`  — view uses `hardlink` (deferred to v1.x).
/// - `lifecycle.read_only`    — owning project is `archived`.
#[tauri::command]
#[specta::specta]
pub async fn preparedview_remove(
    state: State<'_, AppState>,
    view_id: String,
) -> Result<PreparedViewRemoveResponse, String> {
    prepared_views::remove_prepared_view(state.repo.pool(), &view_id).await.map_err(contract_err)
}

// ── preparedview.regenerate ───────────────────────────────────────────────────

/// `preparedview.regenerate` — create a `ViewRegenerationPlan` for a
/// previously prepared (possibly removed) source view.
///
/// Removed views have an indefinite regenerable lifetime (A4).
///
/// # Errors
///
/// Returns `Err(ContractError)` with codes:
/// - `view.not_found`         — view does not exist.
/// - `view.mixed_kind`        — view is in `kind_diverged` state.
/// - `view.unsupported_kind`  — view uses `hardlink` (deferred to v1.x).
/// - `lifecycle.read_only`    — owning project is `archived`.
#[tauri::command]
#[specta::specta]
pub async fn preparedview_regenerate(
    state: State<'_, AppState>,
    view_id: String,
) -> Result<PreparedViewRegenerateResponse, String> {
    prepared_views::regenerate_prepared_view(state.repo.pool(), &view_id)
        .await
        .map_err(contract_err)
}
