//! Plan review Tauri commands (spec 017).
//!
//! Implements the five JSON-Schema contracts under
//! `specs/017-cleanup-archive-review-plans/contracts/` plus the two
//! archive-management contracts (`archive.send_to_trash`,
//! `archive.permanently_delete`).
//!
//! All state-machine enforcement lives in `crates/app/core/src/plans.rs`.
//! These commands are thin adapters: validate inputs, delegate to use cases,
//! return contract DTOs.
//!
//! The `plans.apply` stub is retained for spec 025 compatibility — it returns
//! `unimplemented` and will be replaced when spec 025 lands.

use app_core::plans::{
    approve_plan, discard_plan, get_plan, list_plans, permanently_delete_archive, retry_plan,
    send_archive_to_trash,
};
use contracts_core::plans::{
    ArchivePermanentlyDeleteResponse, ArchiveSendToTrashResponse, PlanApproveResponse, PlanDetail,
    PlanDiscardResponse, PlanListRequest, PlanListResponse, PlanRetryResponse, RetryItemsFilter,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

// ── plans.list ────────────────────────────────────────────────────────────────

/// `plans.list` — list reviewable plans, failed-first ordering (US1, T014).
///
/// # Errors
///
/// Returns `Err(String)` with the contract error code on failure.
#[tauri::command]
#[specta::specta]
pub async fn plans_list(
    state: State<'_, AppState>,
    state_filter: Option<Vec<String>>,
    origin_filter: Option<Vec<String>>,
    created_after: Option<String>,
    limit: Option<i64>,
) -> Result<PlanListResponse, ContractError> {
    let req = PlanListRequest { state_filter, origin_filter, created_after, limit };
    list_plans(state.repo.pool(), &req).await
}

// ── plans.get ─────────────────────────────────────────────────────────────────

/// `plans.get` — fetch a plan with all its items (US1, T014).
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"` if the plan does not exist.
#[tauri::command]
#[specta::specta]
pub async fn plans_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<PlanDetail, ContractError> {
    get_plan(state.repo.pool(), &id).await
}

// ── plans.approve ─────────────────────────────────────────────────────────────

/// `plans.approve` — move a plan to `approved`; snapshot item FS metadata (US3, T025).
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"`, `"plan.invalid_state"`, or
/// `"plan.items.empty"` on failure.
#[tauri::command]
#[specta::specta]
pub async fn plans_approve(
    state: State<'_, AppState>,
    id: String,
) -> Result<PlanApproveResponse, ContractError> {
    approve_plan(state.repo.pool(), &state.bus, &id, "user").await
}

// ── plans.apply (superseded by spec 025) ─────────────────────────────────────
// The real `plans.apply` command lives in `commands/plan_apply.rs` (spec 025).
// This stub is retained for source compatibility only and is NOT registered
// in the collect_commands! macro.

// ── plans.discard ─────────────────────────────────────────────────────────────

/// `plans.discard` — soft-delete a plan (US4, T030).
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"` or `"plan.in_progress"` on failure.
#[tauri::command]
#[specta::specta]
pub async fn plans_discard(
    state: State<'_, AppState>,
    id: String,
) -> Result<PlanDiscardResponse, ContractError> {
    discard_plan(state.repo.pool(), &state.bus, &id).await
}

// ── plans.retry ───────────────────────────────────────────────────────────────

/// `plans.retry` — create a new plan from failed/cancelled/all items of a
/// terminal parent (US5, T035).
///
/// `items_filter` must be one of `"failed"`, `"cancelled"`, or `"all"` (R-Retry-1).
///
/// # Errors
///
/// Returns `Err(String)` with `"parent.not_found"`, `"parent.not_terminal"`,
/// `"no.items.to.retry"`, or `"value.invalid"` on failure.
#[tauri::command]
#[specta::specta]
pub async fn plans_retry(
    state: State<'_, AppState>,
    parent_plan_id: String,
    items_filter: String,
) -> Result<PlanRetryResponse, ContractError> {
    let filter = match items_filter.as_str() {
        "failed" => RetryItemsFilter::Failed,
        "cancelled" => RetryItemsFilter::Cancelled,
        "all" => RetryItemsFilter::All,
        other => {
            return Err(ContractError::new(
                contracts_core::error_code::ErrorCode::ValueInvalid,
                format!("unknown items_filter: '{other}'"),
                contracts_core::ErrorSeverity::Blocking,
                false,
            ))
        }
    };

    retry_plan(state.repo.pool(), &state.bus, &parent_plan_id, filter).await
}

// ── archive.send_to_trash ─────────────────────────────────────────────────────

/// `archive.send_to_trash` — send the archive subtree to OS trash (US6, T045).
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"` or `"archive.empty"` on failure.
#[tauri::command]
#[specta::specta]
pub async fn archive_send_to_trash(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<ArchiveSendToTrashResponse, ContractError> {
    send_archive_to_trash(state.repo.pool(), &state.bus, &plan_id).await
}

// ── archive.permanently_delete ────────────────────────────────────────────────

/// `archive.permanently_delete` — permanently remove archive subtree (US6, T046).
///
/// Requires `confirm_text == "DELETE"`. Blocked if spec-016 `blockPermanentDelete` is true.
///
/// # Errors
///
/// Returns `Err(String)` with `"confirm.text.mismatch"`, `"plan.blocked_by_protection"`,
/// `"plan.not_found"`, or `"archive.empty"` on failure.
#[tauri::command]
#[specta::specta]
pub async fn archive_permanently_delete(
    state: State<'_, AppState>,
    plan_id: String,
    confirm_text: String,
) -> Result<ArchivePermanentlyDeleteResponse, ContractError> {
    // Read blockPermanentDelete from settings (spec 016 protection gate).
    // We load the setting directly from the settings store rather than caching
    // in AppState. Resolved via `app_core::settings::resolve_setting` (not the
    // raw `persistence_db::repositories::settings` table) because
    // `blockPermanentDelete` is a global-protection-default key backed by the
    // dedicated `protection_defaults` table (spec 016 T-003/T-005) — reading
    // the legacy generic settings table directly would silently ignore every
    // value the user actually saved via the Cleanup settings pane.
    let pool = state.repo.pool();
    let block: bool = app_core::settings::resolve_setting(pool, "blockPermanentDelete", None)
        .await
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    permanently_delete_archive(pool, &state.bus, &plan_id, &confirm_text, block).await
}
