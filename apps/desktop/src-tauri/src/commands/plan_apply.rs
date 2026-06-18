//! Plan apply Tauri commands (spec 025).
//!
//! Implements the five JSON-Schema contracts under
//! `specs/025-filesystem-plan-application/contracts/`:
//! - `plans.apply`       — start applying an approved plan.
//! - `plans.cancel`      — cancel an in-flight apply.
//! - `plans.resume`      — resume a paused apply run.
//! - `plans.item.skip`   — skip a pending item.
//! - `plans.item.retry`  — retry a failed item.
//! - `plans.apply.status`— fetch current apply status.
//!
//! All state-machine enforcement lives in `crates/app/core/src/plan_apply.rs`.
//! These commands are thin adapters: validate inputs, delegate, return DTOs.

use app_core::plan_apply::{
    apply_plan, cancel_plan, get_apply_status, resume_plan, retry_plan_item, skip_plan_item,
};
use contracts_core::plan_apply::{
    PlanApplyResponse, PlanApplyStatus, PlanCancelResponse, PlanItemRetryResponse,
    PlanItemSkipResponse, PlanResumeResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── plans.apply ───────────────────────────────────────────────────────────────

/// `plans.apply` — start applying an approved plan (US1, T019).
///
/// Returns immediately with the run id and new state (`"applying"`).
/// Progress is streamed via audit bus events (`plan.item.progress`,
/// `plan.applying.completed`).
///
/// # Errors
///
/// Returns `Err(String)` with:
/// - `"plan.not_found"` — plan not found.
/// - `"plan.invalid_state"` — plan is not approved or CAS race.
/// - `"plan.approval.stale"` — approval token mismatch.
/// - `"plan.conflict.overlap"` — concurrent apply already running.
#[tauri::command]
#[specta::specta]
pub async fn plans_apply_real(
    state: State<'_, AppState>,
    plan_id: String,
    approval_token: String,
) -> Result<PlanApplyResponse, String> {
    apply_plan(state.repo.pool(), &state.bus, &plan_id, &approval_token).await.map_err(|e| e.code)
}

// ── plans.cancel ──────────────────────────────────────────────────────────────

/// `plans.cancel` — cancel an in-flight apply (US3, T033).
///
/// Signals the cancellation token; the executor finishes its current item
/// and stops. Remaining pending items are batch-transitioned to `cancelled`.
///
/// # Errors
///
/// Returns `Err(String)` with:
/// - `"plan.not_found"` — plan not found.
/// - `"plan.not_in_apply"` — plan is not in applying or paused state.
#[tauri::command]
#[specta::specta]
pub async fn plans_cancel(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<PlanCancelResponse, String> {
    cancel_plan(state.repo.pool(), &plan_id).await.map_err(|e| e.code)
}

// ── plans.resume ──────────────────────────────────────────────────────────────

/// `plans.resume` — resume a paused apply run (R-Pause-1, T053).
///
/// # Errors
///
/// Returns `Err(String)` with:
/// - `"plan.not_found"` — plan not found.
/// - `"run.not_paused"` — plan is not in paused state.
/// - `"run.not_found"` — run id does not match active run.
#[tauri::command]
#[specta::specta]
pub async fn plans_resume(
    state: State<'_, AppState>,
    plan_id: String,
    run_id: String,
) -> Result<PlanResumeResponse, String> {
    resume_plan(state.repo.pool(), &state.bus, &plan_id, &run_id).await.map_err(|e| e.code)
}

// ── plans.item.skip ───────────────────────────────────────────────────────────

/// `plans.item.skip` — skip a pending item during an active apply (US4, T041).
///
/// The item must be `pending` and the plan must be `applying`.
///
/// # Errors
///
/// Returns `Err(String)` with:
/// - `"plan.not_found"` — plan not found.
/// - `"plan.not_in_apply"` — plan is not applying.
/// - `"item.not_found"` — item not found.
/// - `"item.not_pending"` — item is not in pending state.
#[tauri::command]
#[specta::specta]
pub async fn plans_item_skip(
    state: State<'_, AppState>,
    plan_id: String,
    item_id: String,
) -> Result<PlanItemSkipResponse, String> {
    skip_plan_item(state.repo.pool(), &plan_id, &item_id).await.map_err(|e| e.code)
}

// ── plans.item.retry ──────────────────────────────────────────────────────────

/// `plans.item.retry` — retry a failed item within a running apply (US4, T041).
///
/// The item must be `failed` and the plan must be `applying`.
/// Use `plans.retry` for plan-level retry after a terminal plan.
///
/// # Errors
///
/// Returns `Err(String)` with:
/// - `"plan.not_found"` — plan not found.
/// - `"plan.not_in_apply"` — plan is not applying (use plans.retry for terminal).
/// - `"item.not_found"` — item not found.
/// - `"item.not_failed"` — item is not in failed state.
#[tauri::command]
#[specta::specta]
pub async fn plans_item_retry(
    state: State<'_, AppState>,
    plan_id: String,
    item_id: String,
) -> Result<PlanItemRetryResponse, String> {
    retry_plan_item(state.repo.pool(), &plan_id, &item_id).await.map_err(|e| e.code)
}

// ── plans.apply.status ────────────────────────────────────────────────────────

/// `plans.apply.status` — fetch current apply progress for a plan.
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"` if the plan does not exist.
#[tauri::command]
#[specta::specta]
pub async fn plans_apply_status(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<PlanApplyStatus, String> {
    get_apply_status(state.repo.pool(), &plan_id).await.map_err(|e| e.code)
}
