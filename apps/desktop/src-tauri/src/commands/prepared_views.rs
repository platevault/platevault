// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
//! - `sourceview.verify` (spec 049 US4) — read-only pre-processing check that
//!   every link in a view still resolves to a present source. Never mutates
//!   the filesystem and never auto-repairs (FR-014/FR-015).
//!
//! All write operations return a `plan_id` that enters the standard
//! `plans.approve` → `plan.apply` pipeline. Destructive destination is always
//! `archive` (R-026-Dest-Archive).

use app_core::{prepared_views, source_view_generate, source_view_verify};
use contracts_core::prepared_views::{
    PreparedViewListResponse, PreparedViewRegenerateResponse, PreparedViewRemoveResponse,
};
use contracts_core::source_view_generate::{
    SourceViewDestinationGetResponse, SourceViewDestinationSetRequest,
    SourceViewDestinationSetResponse, SourceViewGenerateRequest, SourceViewGenerateResponse,
};
use contracts_core::source_view_verify::SourceViewVerifyResponse;
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

// ── sourceview.verify (spec 049 US4) ──────────────────────────────────────────

/// `sourceview.verify` — read-only check that every link in a generated
/// source view still resolves to a present canonical source.
///
/// Never mutates the filesystem and never auto-repairs (FR-014/FR-015);
/// repair is via explicit `preparedview.regenerate`.
///
/// # Errors
///
/// Returns `Err(ContractError)` with code `view.not_found` when the view does
/// not exist, or an `internal.*` error on failure.
#[tauri::command]
#[specta::specta]
pub async fn sourceview_verify(
    state: State<'_, AppState>,
    view_id: String,
) -> Result<SourceViewVerifyResponse, ContractError> {
    source_view_verify::verify_source_view(state.repo.pool(), &view_id).await
}

// ── sourceview.destination.get / .set (spec 049 T041) ─────────────────────────

/// `sourceview.destination.get` — read the persisted per-project destination
/// override (FR-021b). `destination: null` means no override is persisted and
/// the project-envelope default applies.
///
/// # Errors
///
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn sourceview_destination_get(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<SourceViewDestinationGetResponse, ContractError> {
    let destination =
        source_view_generate::get_destination_override(state.repo.pool(), &project_id).await?;
    Ok(SourceViewDestinationGetResponse { destination })
}

/// `sourceview.destination.set` — persist (or clear, with `destination: null`)
/// the per-project destination override (FR-021b). Applied at the next
/// `sourceview.generate` call for this project unless a per-generation
/// `destinationOverride` is also given (per-generation wins).
///
/// # Errors
///
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn sourceview_destination_set(
    state: State<'_, AppState>,
    req: SourceViewDestinationSetRequest,
) -> Result<SourceViewDestinationSetResponse, ContractError> {
    source_view_generate::set_destination_override(
        state.repo.pool(),
        &req.project_id,
        req.destination.as_deref(),
    )
    .await?;
    Ok(SourceViewDestinationSetResponse { ok: true })
}
