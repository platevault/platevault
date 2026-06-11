//! Tauri command adapters for spec 023 — Target Identity, History, and Notes.
//!
//! Exposes the five spec-023 use cases as typed Tauri commands:
//!   - `target.get`            — full target aggregate (identity + aliases + catalog refs).
//!   - `target.note.update`    — replace per-target free-text note.
//!   - `target.alias.add`      — append an alias.
//!   - `target.alias.remove`   — remove an alias.
//!   - `target.primary.rename` — promote an existing alias to primary designation.
//!
//! All commands delegate to `app_core::target_identity` and return typed
//! result / error envelopes compatible with the JSON Schema contracts in
//! `specs/023-target-identity-history-notes/contracts/`.

use app_core::target_identity;
use contracts_core::targets::{
    TargetAliasAddRequest, TargetAliasAddResult, TargetAliasRemoveRequest, TargetAliasRemoveResult,
    TargetGetResult, TargetNoteUpdateRequest, TargetNoteUpdateResult, TargetOpError,
    TargetPrimaryRenameRequest, TargetPrimaryRenameResult,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── target.get ────────────────────────────────────────────────────────────────

/// `target.get` — load the full target aggregate.
///
/// Returns [`TargetGetResult`] on success or [`TargetOpError`] as `Err`.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with code `"target.not_found"` when the
/// target does not exist.
#[tauri::command]
#[specta::specta(rename = "target.get")]
pub async fn target_get(
    state: State<'_, AppState>,
    target_id: String,
) -> Result<TargetGetResult, TargetOpError> {
    target_identity::target_get(state.repo.pool(), &target_id).await
}

// ── target.note.update ────────────────────────────────────────────────────────

/// `target.note.update` — replace the per-target free-text note.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with codes: `"target.not_found"`, `"note.too_long"`.
#[tauri::command]
#[specta::specta(rename = "target.note.update")]
pub async fn target_note_update(
    state: State<'_, AppState>,
    req: TargetNoteUpdateRequest,
) -> Result<TargetNoteUpdateResult, TargetOpError> {
    target_identity::target_note_update(state.repo.pool(), req).await
}

// ── target.alias.add ──────────────────────────────────────────────────────────

/// `target.alias.add` — append an alias to a target.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with codes: `"target.not_found"`, `"alias.invalid"`,
/// `"alias.duplicate"`.
#[tauri::command]
#[specta::specta(rename = "target.alias.add")]
pub async fn target_alias_add(
    state: State<'_, AppState>,
    req: TargetAliasAddRequest,
) -> Result<TargetAliasAddResult, TargetOpError> {
    target_identity::target_alias_add(state.repo.pool(), req).await
}

// ── target.alias.remove ───────────────────────────────────────────────────────

/// `target.alias.remove` — remove an alias from a target.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with codes: `"target.not_found"`,
/// `"alias.is_primary"`, `"alias.not_found"`.
#[tauri::command]
#[specta::specta(rename = "target.alias.remove")]
pub async fn target_alias_remove(
    state: State<'_, AppState>,
    req: TargetAliasRemoveRequest,
) -> Result<TargetAliasRemoveResult, TargetOpError> {
    target_identity::target_alias_remove(state.repo.pool(), req).await
}

// ── target.primary.rename ─────────────────────────────────────────────────────

/// `target.primary.rename` — promote an existing alias to `primary_designation`.
///
/// # Errors
///
/// Returns `Err(TargetOpError)` with codes: `"target.not_found"`,
/// `"designation.not_in_aliases"`, `"designation.already_primary"`.
#[tauri::command]
#[specta::specta(rename = "target.primary.rename")]
pub async fn target_primary_rename(
    state: State<'_, AppState>,
    req: TargetPrimaryRenameRequest,
) -> Result<TargetPrimaryRenameResult, TargetOpError> {
    target_identity::target_primary_rename(state.repo.pool(), req).await
}
