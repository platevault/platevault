// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration commands (spec 033, T037 + spec 007 matching).
//!
//! Real implementations (T037):
//!   `calibration.masters.list` — backed by `calibration_master_view` (real DB rows).
//!   `calibration.masters.get`  — backed by `calibration_master_view` (real DB rows).
//!   `calibration.matches`      — still a stub (requires per-session scoring via spec 007).
//!
//! Spec 007 commands: `calibration.match.suggest`, `calibration.match.assign`,
//!   `calibration.match.suggest.batch` — wired to the real matching engine.

use app_core::calibration as cal_uc;
use contracts_core::calibration::{CalibrationMaster, MasterDetail, MatchCandidate};
use contracts_core::calibration_match::{
    CalibrationMatchAssignRequest, CalibrationMatchAssignResponse, CalibrationMatchBatchRequest,
    CalibrationMatchBatchResponse, CalibrationMatchSuggestRequest, CalibrationMatchSuggestResponse,
    CalibrationMatchUnassignRequest, CalibrationMatchUnassignResponse,
};
use tauri::State;

use crate::AppState;
use contracts_core::ContractError;

/// `calibration.masters.list` — returns all calibration masters from real DB rows.
///
/// Backed by `calibration_master_view` (migration 0033) which joins
/// `calibration_session` with `calibration_fingerprint`. Returns an empty list
/// when no calibration sessions with fingerprints exist (not fixtures).
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn calibration_masters_list(
    state: State<'_, AppState>,
) -> Result<Vec<CalibrationMaster>, ContractError> {
    tracing::debug!("calibration.masters.list");
    cal_uc::masters_list(state.repo.pool()).await.map_err(ContractError::internal)
}

/// `calibration.masters.get` — returns a single calibration master detail.
///
/// # Errors
/// Returns `Err(String)` with `"master.not_found: <id>"` when not found.
#[tauri::command]
#[specta::specta]
pub async fn calibration_masters_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<MasterDetail, ContractError> {
    tracing::debug!("calibration.masters.get id={id}");
    cal_uc::masters_get(state.repo.pool(), &id).await.map_err(ContractError::internal)
}

/// `calibration.matches` — returns calibration match candidates for a session.
///
/// Still returns fixture data for the scored candidate list (requires per-session
/// scoring pass via spec 007 `calibration.match.suggest`). Use
/// `calibration.match.suggest` for real scored results.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn calibration_matches(session_id: String) -> Result<Vec<MatchCandidate>, ContractError> {
    tracing::debug!("calibration.matches session_id={session_id}");
    // This command remains a simple list until the spec-007 scoring pass is
    // integrated here. Use calibration.match.suggest for real ranked candidates.
    Ok(vec![])
}

// ── Spec 007 — calibration matching commands ──────────────────────────────────

/// `calibration.match.suggest` — suggest ranked calibration masters for a session.
///
/// Read-only; never persists state. Returns ranked candidates with confidence
/// and dimension breakdown per spec 007 contract.
///
/// # Errors
/// Returns `Err(String)` on database error.
#[tauri::command]
#[specta::specta]
pub async fn calibration_match_suggest(
    state: State<'_, AppState>,
    req: CalibrationMatchSuggestRequest,
) -> Result<CalibrationMatchSuggestResponse, ContractError> {
    tracing::debug!("calibration.match.suggest session_id={}", req.session_id);
    cal_uc::suggest(state.repo.pool(), req).await.map_err(ContractError::internal)
}

/// `calibration.match.assign` — persist a calibration master assignment.
///
/// Hard-rule mismatches require `override: true`. Emits audit event on success.
///
/// # Errors
/// Returns `Err(String)` on database error.
#[tauri::command]
#[specta::specta]
pub async fn calibration_match_assign(
    state: State<'_, AppState>,
    req: CalibrationMatchAssignRequest,
) -> Result<CalibrationMatchAssignResponse, ContractError> {
    tracing::debug!(
        "calibration.match.assign session_id={} master_id={}",
        req.session_id,
        req.master_id
    );
    cal_uc::assign(state.repo.pool(), &state.bus, req).await.map_err(ContractError::internal)
}

/// `calibration.match.suggest.batch` — suggest calibration masters for multiple sessions.
///
/// Supports partial success: sessions with `observer_location_missing` or
/// `session.mixed_state` return per-item status, not a top-level error.
///
/// # Errors
/// Returns `Err(String)` on database error.
#[tauri::command]
#[specta::specta]
pub async fn calibration_match_suggest_batch(
    state: State<'_, AppState>,
    req: CalibrationMatchBatchRequest,
) -> Result<CalibrationMatchBatchResponse, ContractError> {
    tracing::debug!("calibration.match.suggest.batch session_count={}", req.session_ids.len());
    cal_uc::batch_suggest(state.repo.pool(), req).await.map_err(ContractError::internal)
}

/// `calibration.match.unassign` — remove a session's assignment for one
/// calibration type (#875: previously there was no way back to "no master
/// assigned"). Emits `calibration.assignment.removed` on success.
///
/// # Errors
/// Returns `Err(String)` on database error.
#[tauri::command]
#[specta::specta]
pub async fn calibration_match_unassign(
    state: State<'_, AppState>,
    req: CalibrationMatchUnassignRequest,
) -> Result<CalibrationMatchUnassignResponse, ContractError> {
    tracing::debug!(
        "calibration.match.unassign session_id={} calibration_type={:?}",
        req.session_id,
        req.calibration_type
    );
    cal_uc::unassign(state.repo.pool(), &state.bus, req).await.map_err(ContractError::internal)
}

// ── #886 — calibration master archive ─────────────────────────────────────────

/// `calibration.masters.archive_plan_generate` — build a reviewable
/// single-master archive plan (#886). Creates a `ready_for_review` plan;
/// performs NO filesystem mutation and never auto-applies (constitution
/// §II / FR-002). A master currently assigned to one or more sessions
/// requires `confirm_in_use: true` — a first call without it returns
/// `"calibration.master_in_use"` so the UI can show a confirm dialog before
/// retrying.
///
/// # Errors
/// Returns `Err` with `"master.not_found"`, `"plan.invalid_state"` (already
/// archived), `"calibration.master_untracked"` (no tracked file), or
/// `"calibration.master_in_use"` (needs confirm).
#[tauri::command]
#[specta::specta]
pub async fn calibration_masters_archive_plan_generate(
    state: State<'_, AppState>,
    master_id: String,
    title: Option<String>,
    confirm_in_use: Option<bool>,
) -> Result<contracts_core::archive::GenerateArchivePlanResult, ContractError> {
    tracing::debug!("calibration.masters.archive_plan_generate master_id={master_id}");
    app_core::calibration_archive_generator::generate(
        state.repo.pool(),
        &master_id,
        title.as_deref(),
        confirm_in_use.unwrap_or(false),
    )
    .await
}

/// `calibration.masters.archive_plan_generate_restore` — build a reviewable
/// restore (un-archive) plan from a previously applied master-archive plan
/// (#886). Creates a `ready_for_review` plan; performs NO filesystem
/// mutation and never auto-applies (constitution §II / FR-002).
///
/// # Errors
/// Returns `Err` with `"plan.not_found"`, `"plan.invalid_state"` (not an
/// applied master-archive plan), or `"archive.empty"` (nothing to restore).
#[tauri::command]
#[specta::specta]
pub async fn calibration_masters_archive_plan_generate_restore(
    state: State<'_, AppState>,
    archived_plan_id: String,
    title: Option<String>,
) -> Result<contracts_core::archive::GenerateRestorePlanResult, ContractError> {
    tracing::debug!(
        "calibration.masters.archive_plan_generate_restore archived_plan_id={archived_plan_id}"
    );
    app_core::calibration_archive_generator::generate_restore(
        state.repo.pool(),
        &archived_plan_id,
        title.as_deref(),
    )
    .await
}
