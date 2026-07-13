//! Target favourites Tauri commands (spec 051 US2).
//!
//! ## Commands
//!
//! - `targets.favourites.list` — list favourited canonical target ids.
//! - `targets.favourites.add` — favourite a canonical target.
//! - `targets.favourites.remove` — unfavourite a canonical target.
//!
//! Replaces the `localStorage`-only stub in
//! `apps/desktop/src/features/targets/useFavourites.ts` with durable,
//! database-backed state (migration `0061` `target_favourite`).
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks

use contracts_core::targets::{
    TargetFavouriteAddResult, TargetFavouriteRemoveResult, TargetFavouriteRequest,
    TargetFavouritesListResult,
};
use contracts_core::ContractError;
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── targets.favourites.list ──────────────────────────────────────────────────

/// `targets.favourites.list` — list the ids of every currently-favourited
/// canonical target.
///
/// # Errors
///
/// Returns `Err(ContractError)` with code `internal.database`.
#[tauri::command]
#[specta::specta]
pub async fn target_favourites_list(
    state: State<'_, AppState>,
) -> Result<TargetFavouritesListResult, ContractError> {
    tracing::debug!("targets.favourites.list");
    app_core::target_favourites::list(state.repo.pool()).await
}

// ── targets.favourites.add ───────────────────────────────────────────────────

/// `targets.favourites.add` — favourite a canonical target. Idempotent.
///
/// # Errors
///
/// Returns `Err(ContractError)` with code `target.not_found` or
/// `internal.database`.
#[tauri::command]
#[specta::specta]
pub async fn target_favourites_add(
    state: State<'_, AppState>,
    req: TargetFavouriteRequest,
) -> Result<TargetFavouriteAddResult, ContractError> {
    tracing::debug!("targets.favourites.add target_id={}", req.target_id);
    let cache = state.resolve_cache.read().await.clone();
    app_core::target_favourites::add(state.repo.pool(), &cache.cache(), &req).await
}

// ── targets.favourites.remove ────────────────────────────────────────────────

/// `targets.favourites.remove` — unfavourite a canonical target. Idempotent.
///
/// # Errors
///
/// Returns `Err(ContractError)` with code `internal.database`.
#[tauri::command]
#[specta::specta]
pub async fn target_favourites_remove(
    state: State<'_, AppState>,
    req: TargetFavouriteRequest,
) -> Result<TargetFavouriteRemoveResult, ContractError> {
    tracing::debug!("targets.favourites.remove target_id={}", req.target_id);
    app_core::target_favourites::remove(state.repo.pool(), &req).await
}
