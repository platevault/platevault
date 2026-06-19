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
};
use tauri::State;

use crate::AppState;

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
) -> Result<Vec<CalibrationMaster>, String> {
    tracing::debug!("calibration.masters.list");
    cal_uc::masters_list(state.repo.pool()).await
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
) -> Result<MasterDetail, String> {
    tracing::debug!("calibration.masters.get id={id}");
    cal_uc::masters_get(state.repo.pool(), &id).await
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
pub async fn calibration_matches(session_id: String) -> Result<Vec<MatchCandidate>, String> {
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
) -> Result<CalibrationMatchSuggestResponse, String> {
    tracing::debug!("calibration.match.suggest session_id={}", req.session_id);
    cal_uc::suggest(state.repo.pool(), req).await
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
) -> Result<CalibrationMatchAssignResponse, String> {
    tracing::debug!(
        "calibration.match.assign session_id={} master_id={}",
        req.session_id,
        req.master_id
    );
    cal_uc::assign(state.repo.pool(), &state.bus, req).await
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
) -> Result<CalibrationMatchBatchResponse, String> {
    tracing::debug!("calibration.match.suggest.batch session_count={}", req.session_ids.len());
    cal_uc::batch_suggest(state.repo.pool(), req).await
}
