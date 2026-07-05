//! Prepared source view Tauri commands (spec 026 remove/regenerate; spec 049
//! generation).
//!
//! ## Commands
//!
//! - `preparedview.list` — list all prepared source views for a project.
//! - `preparedview.remove` — create a `ViewRemovalPlan` for a view, routed
//!   through the spec 017/025 plan pipeline.
//! - `preparedview.regenerate` — create a `ViewRegenerationPlan` for a removed
//!   or stale view, routed through the plan pipeline.
//! - `sourceview.generate` (spec 049) — create a `prepared_view_generation`
//!   plan first-materializing a project's selected lights + matched
//!   calibration, routed through the same plan pipeline.
//!
//! All write operations return a `plan_id` that enters the standard
//! `plans.approve` → `plan.apply` pipeline. Destructive destination is always
//! `archive` (R-026-Dest-Archive).

use app_core::{prepared_views, source_view_generate};
use contracts_core::prepared_views::{
    PreparedViewListResponse, PreparedViewRegenerateResponse, PreparedViewRemoveResponse,
};
use contracts_core::source_view_generate::{SourceViewGenerateRequest, SourceViewGenerateResponse};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

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
) -> Result<PreparedViewListResponse, ContractError> {
    prepared_views::list_views(state.repo.pool(), &project_id).await
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
) -> Result<PreparedViewRemoveResponse, ContractError> {
    prepared_views::remove_prepared_view(state.repo.pool(), &view_id).await
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
) -> Result<PreparedViewRegenerateResponse, ContractError> {
    prepared_views::regenerate_prepared_view(state.repo.pool(), &view_id).await
}

// ── sourceview.generate (spec 049) ────────────────────────────────────────────

/// `sourceview.generate` — create a `prepared_view_generation` plan
/// first-materializing a project's selected light frames plus their matched
/// calibration as per-item link (or, with explicit opt-in, copy) actions.
///
/// The response `planId` should be routed through `plans.approve` then
/// `plan.apply`, exactly like `preparedview.regenerate`. Nothing is written to
/// disk before apply (FR-001). On successful apply, the `PreparedSourceView`
/// (state `current`) is written by the apply-success hook
/// (`app_core::plan_apply::finalize_view_generation`).
///
/// # Errors
///
/// Returns `Err(ContractError)` with codes:
/// - `project.not_found`      — project does not exist.
/// - `lifecycle.read_only`    — owning project is `archived`.
/// - `no_selection`           — no selected light frame resolved.
/// - `no_link_kind`           — no achievable link kind and `copyOptIn` is false.
/// - `destination.collision`  — two sources resolve to the same destination path.
/// - `destination.exists`     — a destination path already exists on disk.
#[tauri::command]
#[specta::specta]
pub async fn sourceview_generate(
    state: State<'_, AppState>,
    req: SourceViewGenerateRequest,
) -> Result<SourceViewGenerateResponse, ContractError> {
    source_view_generate::generate_source_view(state.repo.pool(), &req).await
}
