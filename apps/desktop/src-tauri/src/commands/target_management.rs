//! Gen-3 target management Tauri commands (spec 036).
//!
//! ## Commands
//!
//! - `target.get` — full detail for one canonical target (gen-3).
//! - `target.list` — list all canonical targets.
//! - `target.alias.add` — add a user alias to a target.
//! - `target.alias.remove` — remove a user alias by id (kind='user' only).
//! - `target.display_alias.set` — set the user presentation label (FR-012).
//! - `target.display_alias.clear` — clear the user presentation label (FR-012).
//!
//! The existing dotted command names `target.get`, `target.alias.add`, and
//! `target.alias.remove` are reused here (repointed from gen-2 to gen-3 per
//! spec 036 T016). New names `target.list`, `target.display_alias.set`, and
//! `target.display_alias.clear` are also registered in this module.
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks

use contracts_core::targets::{
    TargetAliasAddRequest, TargetAliasAddResult, TargetAliasRemoveRequest, TargetAliasRemoveResult,
    TargetDetailV3, TargetDisplayAliasClearRequest, TargetDisplayAliasSetRequest, TargetGetRequest,
    TargetListItem, TargetOpError,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── target.get ───────────────────────────────────────────────────────────────

/// `target.get` — return full detail for a canonical target (gen-3).
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `target.not_found`,
/// `target.invalid_id`, or `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.get")]
pub async fn target_get(
    state: State<'_, AppState>,
    req: TargetGetRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    tracing::debug!("target.get id={}", req.target_id);
    app_core::target_management::get(state.repo.pool(), &req).await
}

// ── target.list ──────────────────────────────────────────────────────────────

/// `target.list` — list all canonical targets ordered by primary designation.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.list")]
pub async fn target_list(state: State<'_, AppState>) -> Result<Vec<TargetListItem>, TargetOpError> {
    tracing::debug!("target.list");
    app_core::target_management::list(state.repo.pool()).await
}

// ── target.alias.add ─────────────────────────────────────────────────────────

/// `target.alias.add` — add a user alias to a canonical target (gen-3).
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `target.not_found`, `alias.blank`,
/// or `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.alias.add")]
pub async fn target_alias_add(
    state: State<'_, AppState>,
    req: TargetAliasAddRequest,
) -> Result<TargetAliasAddResult, TargetOpError> {
    tracing::debug!("target.alias.add target_id={} alias={:?}", req.target_id, req.alias);
    app_core::target_management::alias_add(state.repo.pool(), &req).await
}

// ── target.alias.remove ──────────────────────────────────────────────────────

/// `target.alias.remove` — remove a user alias from a canonical target (gen-3).
///
/// Only aliases with `kind='user'` are removable; returns `alias.not_removable`
/// for SIMBAD designations/common names.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `alias.not_found`,
/// `alias.not_removable`, or `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.alias.remove")]
pub async fn target_alias_remove(
    state: State<'_, AppState>,
    req: TargetAliasRemoveRequest,
) -> Result<TargetAliasRemoveResult, TargetOpError> {
    tracing::debug!("target.alias.remove target_id={} alias_id={}", req.target_id, req.alias_id);
    app_core::target_management::alias_remove(state.repo.pool(), &req).await
}

// ── target.display_alias.set ─────────────────────────────────────────────────

/// `target.display_alias.set` — set the user presentation label (FR-012).
///
/// Blank/empty input is stored as NULL (treated as a clear). Returns the
/// updated full detail.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `target.not_found`,
/// `target.invalid_id`, or `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.display_alias.set")]
pub async fn target_display_alias_set(
    state: State<'_, AppState>,
    req: TargetDisplayAliasSetRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    tracing::debug!(
        "target.display_alias.set target_id={} display_alias={:?}",
        req.target_id,
        req.display_alias
    );
    app_core::target_management::display_alias_set(state.repo.pool(), &req).await
}

// ── target.display_alias.clear ───────────────────────────────────────────────

/// `target.display_alias.clear` — clear the user presentation label (FR-012).
///
/// Sets `display_alias = NULL`; `effectiveLabel` reverts to `primaryDesignation`.
/// Returns the updated full detail.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `target.not_found`,
/// `target.invalid_id`, or `internal.database`.
#[tauri::command]
#[specta::specta(rename = "target.display_alias.clear")]
pub async fn target_display_alias_clear(
    state: State<'_, AppState>,
    req: TargetDisplayAliasClearRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    tracing::debug!("target.display_alias.clear target_id={}", req.target_id);
    app_core::target_management::display_alias_clear(state.repo.pool(), &req).await
}
