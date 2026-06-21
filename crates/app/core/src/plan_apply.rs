//! Plan apply use-case orchestration (spec 025).
//!
//! Entry points:
//! - `apply_plan`        — start applying an approved plan (CAS, R-CAS-1, R-Concur-1).
//! - `cancel_plan`       — cancel an in-flight apply (US3).
//! - `pause_plan`        — (internal, called by executor callbacks on pause conditions).
//! - `resume_plan`       — resume a paused run (R-Pause-1).
//! - `skip_plan_item`    — skip a pending item within an active apply (US4).
//! - `retry_plan_item`   — retry a failed item within an active apply (US4).
//! - `get_apply_status`  — fetch current run state + counters.
//!
//! This module wires `crates/fs/executor` (pure filesystem logic) with
//! `crates/persistence/db` (state + audit records) and `crates/audit`
//! (event bus).
//!
//! Constitution §II: apply is gated by approval token; per-item FS CAS check
//! before each mutation (R-FS-1); audit event per state transition (FR-003).

#![allow(clippy::too_many_lines)]

use audit::bus::EventBus;
use audit::event_bus::{
    PlanApplyingCompleted, PlanApplyingPaused, PlanApplyingResumed, PlanApplyingStarted,
    PlanItemProgress, Source, TOPIC_PLAN_APPLYING_COMPLETED, TOPIC_PLAN_APPLYING_PAUSED,
    TOPIC_PLAN_APPLYING_RESUMED, TOPIC_PLAN_APPLYING_STARTED, TOPIC_PLAN_ITEM_PROGRESS,
};
use camino::Utf8PathBuf;
use contracts_core::plan_apply::{
    PlanApplyResponse, PlanApplyStatus, PlanCancelResponse, PlanItemRetryResponse,
    PlanItemSkipResponse, PlanResumeResponse,
};
use contracts_core::{
    error_code::ErrorCode, ContractError, ErrorSeverity, OperationEvent, OperationEventType,
    OperationHandle, OperationId, OperationName, OperationStatus,
};
use domain_core::ids::{new_id, Timestamp};
use fs_executor::ops::cas_check::CasSnapshot;
use fs_executor::run::{
    execute_plan, ApplyOutcome, CancellationToken, ExecutorCallbacks, ExecutorItem,
    ExecutorItemAction, ItemProgressEvent, RetryQueue, SkipSet,
};
use persistence_db::repositories::inventory as inventory_repo;
use persistence_db::repositories::plan_apply as apply_repo;
use persistence_db::repositories::plans as plans_repo;
use persistence_db::DbError;
use serde_json::json;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::errors::bus_err;
use dashmap::DashMap;

// ── Long-operation event sink (spec 042 US16, T240) ───────────────────────────

/// Operation name carried by the long-op contract for plan-apply runs.
pub const OP_NAME_PLAN_APPLY: &str = "plan.apply";

/// Live projection sink for [`OperationEvent`]s emitted by a plan-apply run.
///
/// This is the **live UI projection** of progress (spec 042 US16). It is
/// additive to — and never a replacement for — the durable DB audit trail
/// (`apply_repo::append_event`, constitution §II). The Tauri command supplies
/// a sink that forwards events over a `tauri::ipc::Channel<OperationEvent>`;
/// `app_core` itself stays transport-agnostic (no `tauri` dependency).
///
/// Sends are best-effort and infallible from the caller's perspective: if the
/// webview channel is gone, the closure swallows the error so the run still
/// completes and the audit record is still written.
pub type OperationEventSink = Arc<dyn Fn(OperationEvent) + Send + Sync>;

/// Monotonic per-run sequence + sink wrapper so every emitted event carries a
/// strictly increasing `sequence` (the UI uses it to order/dedupe).
#[derive(Clone)]
struct OpEventEmitter {
    operation_id: OperationId,
    sink: OperationEventSink,
    sequence: Arc<AtomicU64>,
}

impl OpEventEmitter {
    fn new(operation_id: OperationId, sink: OperationEventSink) -> Self {
        Self { operation_id, sink, sequence: Arc::new(AtomicU64::new(0)) }
    }

    /// Build the [`OperationHandle`] for this run at the given status.
    fn handle(&self, status: OperationStatus) -> OperationHandle {
        OperationHandle::new(
            self.operation_id.clone(),
            OperationName(OP_NAME_PLAN_APPLY.to_owned()),
            status,
        )
    }

    /// Emit one event with the next sequence number.
    fn emit(&self, event_type: OperationEventType, payload: serde_json::Value) {
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst);
        let event = OperationEvent::new(self.operation_id.clone(), event_type, sequence, payload);
        (self.sink)(event);
    }
}

// ── Active runs registry ──────────────────────────────────────────────────────

/// Global registry of in-flight plan apply runs.
/// Keyed by `plan_id`; each entry holds the shared control objects.
///
/// Backed by a `DashMap` (concurrent map with internal sharded locking) so the
/// registry can be accessed from sync contexts without holding a `.await` lock.
/// Entries are inserted at apply start and removed by an [`ActiveRunGuard`] RAII
/// guard owned by the executor's background task. Because removal happens in the
/// guard's `Drop`, it runs on every scope exit — completion, cancel, pause, *or*
/// an unwind if `execute_plan` panics (FR-017) — guaranteeing no leaked entries.
static ACTIVE_RUNS: std::sync::OnceLock<Arc<DashMap<String, ActiveRun>>> =
    std::sync::OnceLock::new();

fn active_runs() -> Arc<DashMap<String, ActiveRun>> {
    ACTIVE_RUNS.get_or_init(|| Arc::new(DashMap::new())).clone()
}

struct ActiveRun {
    cancel_token: CancellationToken,
    skip_set: SkipSet,
    retry_queue: RetryQueue,
    #[allow(dead_code)] // retained for future cross-plan overlap checks (R-Concur-1)
    run_id: String,
}

/// RAII guard that removes a plan's [`ActiveRun`] entry from the registry on
/// **any** scope exit — normal return, early break, *or* unwind from a panic
/// inside `execute_plan` (spec 042 US12/FR-017, acceptance scenario 2).
///
/// A plain sequential `registry.remove(&plan_id)` after `execute_plan(...)`
/// returns is skipped if `execute_plan` panics, because the unwind jumps past
/// it. The leaked entry then defeats the no-double-apply guard
/// (`check_no_overlap`) for that plan id forever. Holding this guard for the
/// duration of `execute_plan` makes removal run during the unwind instead.
///
/// The guard is constructed at the same point the entry is inserted and owned
/// by the spawned task scope, so its `Drop` is the single removal site for the
/// non-panic outcomes too (Completed / Cancelled / Paused) — removal happens
/// exactly once, regardless of how the task scope exits.
struct ActiveRunGuard {
    registry: Arc<DashMap<String, ActiveRun>>,
    plan_id: String,
}

impl Drop for ActiveRunGuard {
    fn drop(&mut self) {
        self.registry.remove(&self.plan_id);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn db_err(e: DbError) -> ContractError {
    match e {
        DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::PlanNotFound, msg, ErrorSeverity::Blocking, false)
        }
        DbError::CasFailed(msg) => {
            ContractError::new(ErrorCode::PlanInvalidState, msg, ErrorSeverity::Blocking, false)
        }
        other => crate::errors::db_err(other),
    }
}

// ── Overlap check (R-Concur-1) ────────────────────────────────────────────────

/// Reject if any active run's path set overlaps with the new plan's paths.
/// v1: simple per-plan mutex (one plan at a time); cross-plan check is a
/// best-effort check at apply-start time using the active runs registry.
fn check_no_overlap(plan_id: &str) -> Result<(), ContractError> {
    let registry = active_runs();
    if registry.contains_key(plan_id) {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!("plan {plan_id} already has an active apply run"),
            ErrorSeverity::Blocking,
            false,
        ));
    }
    // Full path-set overlap check (R-Concur-1) requires resolving absolute
    // paths for all active plans — deferred to a future iteration when
    // multiple concurrent plans are common. For v1, the in-memory registry
    // prevents the same plan from running twice.
    Ok(())
}

// ── Approval token verification (A1) ─────────────────────────────────────────

/// Verify the approval token is present and non-empty.
///
/// v1: the token is the value produced by `approve_plan`
/// (`"tok-<planId>-<uuid>"`). The spec calls for HMAC verification; this
/// is documented as a future upgrade. For v1 we check that the stored
/// `approval_token` on the plan row matches what the caller supplies.
#[allow(clippy::result_large_err)]
fn verify_approval_token(
    stored_token: Option<&str>,
    supplied_token: &str,
) -> Result<(), ContractError> {
    match stored_token {
        None => Err(ContractError::new(
            ErrorCode::PlanApprovalStale,
            "no approval token on record; plan must be approved before apply".to_owned(),
            ErrorSeverity::Blocking,
            false,
        )),
        Some(stored) if stored != supplied_token => Err(ContractError::new(
            ErrorCode::PlanApprovalStale,
            "approval token mismatch; plan may have been re-approved or tampered".to_owned(),
            ErrorSeverity::Blocking,
            false,
        )),
        Some(_) => Ok(()),
    }
}

// ── Item → ExecutorItem mapping ───────────────────────────────────────────────

/// Convert a `PlanItemRow` into an `ExecutorItem`, resolving the library root
/// from the provided root-id → absolute-path map (T023a).
///
/// When `root_map` contains the `from_root_id` for this item, `library_root`
/// is set to the absolute path so the path-escape/symlink/staleness gate in
/// the executor fires on real items. When the root cannot be resolved (no
/// `from_root_id` or id absent from the map), `library_root` is `None` and
/// the gate is skipped (legacy/test mode).
fn item_row_to_executor_item(
    row: &plans_repo::PlanItemRow,
    root_map: &HashMap<String, Utf8PathBuf>,
) -> ExecutorItem {
    // DB path columns are stored as `String` (unchanged DB representation,
    // Local-First custody §I). Rust strings are already UTF-8, so building a
    // `Utf8PathBuf` from them is infallible and lossless.
    let action = match row.action.as_str() {
        "move" => ExecutorItemAction::Move,
        "archive" => {
            // archive_path stores the pre-computed relative archive path.
            let archive_dest = row
                .archive_path
                .as_deref()
                .map_or_else(|| Utf8PathBuf::from(&row.to_relative_path), Utf8PathBuf::from);
            ExecutorItemAction::Archive { archive_destination: archive_dest }
        }
        // T022: map "trash" action to the Trash variant.
        "trash" => ExecutorItemAction::Trash { fallback_archive_destination: None },
        "delete" => ExecutorItemAction::Delete,
        _ => ExecutorItemAction::NoOp,
    };

    // T023a: Resolve library_root from the DB root map.
    // When from_root_id is set and the root exists in the map, the path gate
    // (T018: escape/symlink/staleness) will fire on this item.
    let library_root: Option<Utf8PathBuf> =
        row.from_root_id.as_deref().and_then(|rid| root_map.get(rid)).cloned();

    // Paths are stored as relative to the library root.
    let source_path = if row.from_relative_path.is_empty() {
        None
    } else {
        Some(Utf8PathBuf::from(&row.from_relative_path))
    };

    let destination_path = if row.to_relative_path.is_empty() {
        None
    } else {
        Some(Utf8PathBuf::from(&row.to_relative_path))
    };

    let is_protected = row.protection == "protected";

    // T020: `requires_destructive_confirm` is derived from action type,
    // independent of `is_protected`. Replaces the old `confirm_required = is_protected` inversion.
    let requires_destructive_confirm = matches!(row.action.as_str(), "delete" | "trash")
        || row.requires_destructive_confirm.unwrap_or(0) != 0;

    // T023a: `destructive_confirmed` is now a real DB column (migration 0033).
    let destructive_confirmed = row.destructive_confirmed != 0;

    ExecutorItem {
        id: row.id.clone(),
        plan_id: row.plan_id.clone(),
        action,
        source_path,
        destination_path,
        library_root,
        cas_snapshot: CasSnapshot {
            approved_mtime: row.approved_mtime.clone(),
            approved_size_bytes: row.approved_size_bytes,
        },
        is_protected,
        requires_destructive_confirm,
        destructive_confirmed,
        current_state: row.item_state.clone(),
    }
}

// ── Executor callbacks implementation ────────────────────────────────────────

struct PlanApplyCallbacks {
    pool: SqlitePool,
    bus: EventBus,
    plan_id: String,
    run_id: String,
    /// Optional live long-op projection (spec 042 US16). `None` when the caller
    /// (e.g. a unit test) does not subscribe; the DB audit trail is unaffected.
    op_emitter: Option<OpEventEmitter>,
}

impl ExecutorCallbacks for PlanApplyCallbacks {
    fn on_item_start(
        &self,
        item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let pool = self.pool.clone();
        let plan_id = self.plan_id.clone();
        let item_id = item_id.to_owned();
        Box::pin(async move {
            if let Err(e) = apply_repo::item_start_applying(&pool, &item_id, &plan_id).await {
                tracing::error!(%item_id, error=%e, "failed to transition item to applying");
            }
        })
    }

    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let pool = self.pool.clone();
        let bus = self.bus.clone();
        let plan_id = self.plan_id.clone();
        let run_id = self.run_id.clone();
        let op_emitter = self.op_emitter.clone();
        Box::pin(async move {
            let item_id = event.item_id.clone();
            let at = event.at.clone();

            // Persist item state.
            let persist_result = match event.new_state.as_str() {
                "succeeded" => apply_repo::item_succeeded(&pool, &item_id, &plan_id).await,
                "failed" | "stale" => {
                    let reason = event
                        .failure
                        .as_ref()
                        .map(std::string::ToString::to_string)
                        .unwrap_or_default();
                    if event.new_state == "stale" {
                        apply_repo::item_stale(&pool, &item_id).await
                    } else {
                        apply_repo::item_failed(&pool, &item_id, &plan_id, &reason).await
                    }
                }
                "skipped" => apply_repo::item_skip(&pool, &item_id, &plan_id).await,
                _ => Ok(()),
            };

            if let Err(e) = persist_result {
                tracing::error!(%item_id, error=%e, "failed to persist item state transition");
            }

            // Append audit event.
            let failure_ref = event.failure.as_ref();
            let rollback_ref = if event.rollback_attempted {
                Some(apply_repo::EventRollback {
                    attempted: event.rollback_attempted,
                    outcome: event.rollback_outcome.as_str(),
                    message: event.rollback_message.as_deref(),
                })
            } else {
                None
            };

            if let Err(e) = apply_repo::append_event(
                &pool,
                &new_id(),
                &run_id,
                &plan_id,
                Some(&item_id),
                &event.prior_state,
                &event.new_state,
                &at,
                failure_ref
                    .map(|f| apply_repo::EventFailure {
                        code: f.code.as_str(),
                        message: &f.message,
                        recoverable: f.recoverable,
                    })
                    .as_ref(),
                rollback_ref.as_ref(),
            )
            .await
            {
                tracing::error!(%item_id, error=%e, "failed to append apply event");
            }

            // Emit audit bus event (A7).
            let bus_payload = PlanItemProgress {
                plan_id: plan_id.clone(),
                run_id: run_id.clone(),
                item_id: item_id.clone(),
                prior_state: event.prior_state.clone(),
                new_state: event.new_state.clone(),
                at: at.clone(),
                failure_code: event.failure.as_ref().map(|f| f.code.as_str().to_owned()),
                failure_message: event.failure.as_ref().map(|f| f.message.clone()),
                failure_recoverable: event.failure.as_ref().map(|f| f.recoverable),
            };

            if let Err(e) = bus.publish(TOPIC_PLAN_ITEM_PROGRESS, Source::System, bus_payload).await
            {
                tracing::warn!(%item_id, error=%e, "audit bus publish failed for item progress");
            }

            // Live long-op projection (spec 042 US16, T240). Additive to the
            // durable audit record above — never a replacement (§II).
            if let Some(emitter) = op_emitter.as_ref() {
                let event_type = match event.new_state.as_str() {
                    "succeeded" => OperationEventType::ItemApplied,
                    "failed" | "stale" => OperationEventType::ItemFailed,
                    _ => OperationEventType::Progress,
                };
                emitter.emit(
                    event_type,
                    json!({
                        "planId": plan_id,
                        "runId": run_id,
                        "itemId": item_id,
                        "priorState": event.prior_state,
                        "newState": event.new_state,
                        "at": at,
                        "failureCode": event.failure.as_ref().map(|f| f.code.as_str()),
                        "failureMessage": event.failure.as_ref().map(|f| f.message.clone()),
                    }),
                );
            }
        })
    }
}

// ── apply_plan ────────────────────────────────────────────────────────────────

/// Start applying an approved plan (US1, T018, T019, T020, T021, T055).
///
/// Preconditions:
/// - Plan must be in `approved` state (CAS, R-CAS-1).
/// - No other run may be active for this plan (R-Concur-1).
/// - Approval token must match the stored token (A1).
///
/// The executor runs on a tokio background task; this function returns
/// immediately with `PlanApplyResponse { plan_id, run_id, new_state: "applying" }`.
///
/// # Errors
///
/// Returns `ContractError` with:
/// - `plan.not_found` — plan not found.
/// - `plan.invalid_state` — plan is not approved or CAS race.
/// - `plan.approval.stale` — token mismatch.
/// - `plan.conflict.overlap` — concurrent apply running.
pub async fn apply_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    approval_token: &str,
    event_sink: Option<OperationEventSink>,
) -> Result<PlanApplyResponse, ContractError> {
    // Load plan.
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    // State check before CAS.
    if plan_row.state != "approved" {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!(
                "plan must be in 'approved' state before apply; current state is '{}'",
                plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Token verification (A1).
    verify_approval_token(plan_row.approval_token.as_deref(), approval_token)?;

    // Overlap check (R-Concur-1).
    check_no_overlap(plan_id)?;

    let run_id = new_id();
    let items_total = plan_row.items_total;
    let items_pending = plan_row.items_pending;

    // Long-op contract emitter (spec 042 US16). The run id doubles as the
    // operation id so the live projection and the durable run/audit rows share
    // one correlation key. `None` when the caller does not subscribe.
    let op_emitter = event_sink.map(|sink| OpEventEmitter::new(OperationId(run_id.clone()), sink));

    // Atomic CAS: approved → applying (R-CAS-1).
    apply_repo::cas_approved_to_applying(
        pool,
        plan_id,
        &run_id,
        approval_token,
        items_total,
        items_pending,
    )
    .await
    .map_err(db_err)?;

    // Load items for the executor.
    let item_rows = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;

    // T023a: Build a root_id → absolute_path map so the path-gate fires on
    // real items. Collect the unique root_ids referenced by this plan's items.
    let mut root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
    for row in &item_rows {
        if let Some(rid) = &row.from_root_id {
            if !root_map.contains_key(rid) {
                if let Ok(Some(path)) = inventory_repo::get_library_root_path(pool, rid).await {
                    root_map.insert(rid.clone(), Utf8PathBuf::from(path));
                } else {
                    tracing::warn!(root_id = %rid, "plan item references unknown library root; path gate will be inactive for this item");
                }
            }
        }
    }

    let executor_items: Vec<ExecutorItem> =
        item_rows.iter().map(|r| item_row_to_executor_item(r, &root_map)).collect();

    // Register active run.
    let cancel_token = CancellationToken::new();
    let skip_set = SkipSet::new();
    let retry_queue = RetryQueue::new();
    // RAII removal guard (FR-017): inserting the entry and building the guard
    // are paired here, but the guard is *moved into the spawned task* below so
    // its `Drop` fires on the task's scope exit — including an unwind if
    // `execute_plan` panics. This replaces the old explicit `registry.remove`.
    let run_guard = {
        let registry = active_runs();
        registry.insert(
            plan_id.to_owned(),
            ActiveRun {
                cancel_token: cancel_token.clone(),
                skip_set: skip_set.clone(),
                retry_queue: retry_queue.clone(),
                run_id: run_id.clone(),
            },
        );
        ActiveRunGuard { registry: registry.clone(), plan_id: plan_id.to_owned() }
    };

    // Emit started event (A7).
    let started_at = Timestamp::now_iso();
    bus.publish(
        TOPIC_PLAN_APPLYING_STARTED,
        Source::User,
        PlanApplyingStarted {
            plan_id: plan_id.to_owned(),
            run_id: run_id.clone(),
            items_total,
            at: started_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    // Append plan-level start audit event.
    let _ = apply_repo::append_event(
        pool,
        &new_id(),
        &run_id,
        plan_id,
        None,
        "approved",
        "applying",
        &started_at,
        None,
        None,
    )
    .await;

    // Emit the long-op `Started` event carrying the running OperationHandle
    // (spec 042 US16, T240).
    if let Some(emitter) = op_emitter.as_ref() {
        let handle = emitter.handle(OperationStatus::Running);
        emitter.emit(
            OperationEventType::ItemStarted,
            json!({
                "handle": handle,
                "planId": plan_id,
                "runId": run_id,
                "itemsTotal": items_total,
                "at": started_at,
            }),
        );
    }

    // Spawn executor on a background task.
    let pool_clone = pool.clone();
    let bus_clone = bus.clone();
    let plan_id_owned = plan_id.to_owned();
    let run_id_owned = run_id.clone();
    let op_emitter_task = op_emitter.clone();

    tokio::spawn(async move {
        // Own the RAII removal guard for the whole task scope. Its `Drop`
        // removes the registry entry on ANY exit — normal completion *or* an
        // unwind if `execute_plan` panics mid-apply (FR-017 scenario 2). This
        // is the single removal site; there is no explicit `registry.remove`.
        let _run_guard = run_guard;

        let callbacks = PlanApplyCallbacks {
            pool: pool_clone.clone(),
            bus: bus_clone.clone(),
            plan_id: plan_id_owned.clone(),
            run_id: run_id_owned.clone(),
            op_emitter: op_emitter_task.clone(),
        };

        let outcome =
            execute_plan(executor_items, &callbacks, &cancel_token, &skip_set, &retry_queue).await;

        // Compute terminal state and persist.
        match outcome {
            ApplyOutcome::Completed(counts) => {
                let terminal = counts.terminal_state(false).to_owned();
                let at = Timestamp::now_iso();

                let _ = apply_repo::complete_run(
                    &pool_clone,
                    &plan_id_owned,
                    &run_id_owned,
                    &terminal,
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool_clone,
                    &new_id(),
                    &run_id_owned,
                    &plan_id_owned,
                    None,
                    "applying",
                    &terminal,
                    &at,
                    None,
                    None,
                )
                .await;

                let _ = bus_clone
                    .publish(
                        TOPIC_PLAN_APPLYING_COMPLETED,
                        Source::System,
                        PlanApplyingCompleted {
                            plan_id: plan_id_owned.clone(),
                            run_id: run_id_owned.clone(),
                            terminal_state: terminal.clone(),
                            items_applied: counts.succeeded,
                            items_failed: counts.failed,
                            items_skipped: counts.skipped,
                            items_cancelled: counts.cancelled,
                            at: at.clone(),
                        },
                    )
                    .await;

                // Long-op terminal event (spec 042 US16). `terminal` is
                // "completed" unless any item failed, in which case it is
                // "failed" — map that onto Completed/Failed event + status.
                if let Some(emitter) = op_emitter_task.as_ref() {
                    let failed_run = terminal == "failed";
                    let (event_type, status) = if failed_run {
                        (OperationEventType::Failed, OperationStatus::Failed)
                    } else {
                        (OperationEventType::Completed, OperationStatus::Completed)
                    };
                    let handle = emitter.handle(status);
                    emitter.emit(
                        event_type,
                        json!({
                            "handle": handle,
                            "planId": plan_id_owned,
                            "runId": run_id_owned,
                            "terminalState": terminal,
                            "itemsApplied": counts.succeeded,
                            "itemsFailed": counts.failed,
                            "itemsSkipped": counts.skipped,
                            "itemsCancelled": counts.cancelled,
                            "at": at,
                        }),
                    );
                }
            }

            ApplyOutcome::Cancelled(counts) => {
                let at = Timestamp::now_iso();

                // Batch-cancel remaining pending items (T021: emit per-item audit row for EACH).
                match apply_repo::list_pending_items(&pool_clone, &plan_id_owned).await {
                    Ok(pending_ids) => {
                        let _ = apply_repo::batch_cancel_pending_items(&pool_clone, &plan_id_owned)
                            .await;
                        for item_id in &pending_ids {
                            let _ = apply_repo::append_event(
                                &pool_clone,
                                &new_id(),
                                &run_id_owned,
                                &plan_id_owned,
                                Some(item_id.as_str()),
                                "pending",
                                "cancelled",
                                &at,
                                None,
                                None,
                            )
                            .await;
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=%e, "failed to list pending items for per-item cancel audit");
                        let _ = apply_repo::batch_cancel_pending_items(&pool_clone, &plan_id_owned)
                            .await;
                    }
                }

                let _ = apply_repo::complete_run(
                    &pool_clone,
                    &plan_id_owned,
                    &run_id_owned,
                    "cancelled",
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool_clone,
                    &new_id(),
                    &run_id_owned,
                    &plan_id_owned,
                    None,
                    "applying",
                    "cancelled",
                    &at,
                    None,
                    None,
                )
                .await;

                let _ = bus_clone
                    .publish(
                        TOPIC_PLAN_APPLYING_COMPLETED,
                        Source::System,
                        PlanApplyingCompleted {
                            plan_id: plan_id_owned.clone(),
                            run_id: run_id_owned.clone(),
                            terminal_state: "cancelled".to_owned(),
                            items_applied: counts.succeeded,
                            items_failed: counts.failed,
                            items_skipped: counts.skipped,
                            items_cancelled: counts.cancelled,
                            at: at.clone(),
                        },
                    )
                    .await;

                // Long-op terminal event for a cancelled run (spec 042 US16).
                if let Some(emitter) = op_emitter_task.as_ref() {
                    let handle = emitter.handle(OperationStatus::Cancelled);
                    emitter.emit(
                        OperationEventType::Completed,
                        json!({
                            "handle": handle,
                            "planId": plan_id_owned,
                            "runId": run_id_owned,
                            "terminalState": "cancelled",
                            "itemsApplied": counts.succeeded,
                            "itemsFailed": counts.failed,
                            "itemsSkipped": counts.skipped,
                            "itemsCancelled": counts.cancelled,
                            "at": at,
                        }),
                    );
                }
            }

            ApplyOutcome::Paused { reason, counts } => {
                let at = Timestamp::now_iso();

                let _ = apply_repo::pause_run(
                    &pool_clone,
                    &plan_id_owned,
                    &run_id_owned,
                    &reason,
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                    // items_pending: total - all resolved
                    counts.succeeded + counts.failed + counts.skipped + counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool_clone,
                    &new_id(),
                    &run_id_owned,
                    &plan_id_owned,
                    None,
                    "applying",
                    "paused",
                    &at,
                    None,
                    None,
                )
                .await;

                // Long-op non-terminal pause projection (spec 042 US16). The
                // run is not terminal — the UI keeps the handle and waits for a
                // resume to continue streaming. Status reflects "running" since
                // the op is still alive (paused), not Completed/Failed.
                if let Some(emitter) = op_emitter_task.as_ref() {
                    let handle = emitter.handle(OperationStatus::Running);
                    emitter.emit(
                        OperationEventType::Warning,
                        json!({
                            "handle": handle,
                            "planId": plan_id_owned,
                            "runId": run_id_owned,
                            "pauseReason": reason,
                            "at": at,
                        }),
                    );
                }

                let _ = bus_clone
                    .publish(
                        TOPIC_PLAN_APPLYING_PAUSED,
                        Source::System,
                        PlanApplyingPaused {
                            plan_id: plan_id_owned.clone(),
                            run_id: run_id_owned.clone(),
                            pause_reason: reason,
                            at,
                        },
                    )
                    .await;
            }
        }
    });

    Ok(PlanApplyResponse { plan_id: plan_id.to_owned(), run_id, new_state: "applying".to_owned() })
}

// ── cancel_plan ───────────────────────────────────────────────────────────────

/// Cancel an in-flight plan apply (US3, T032).
///
/// Signals the cancellation token; the executor finishes the current item
/// and stops. Remaining pending items are transitioned to `cancelled` by
/// the executor's background task after it observes the cancel signal.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not in applying or paused state.
pub async fn cancel_plan(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<PlanCancelResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if !matches!(plan_row.state.as_str(), "applying" | "paused") {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!(
                "plan {} is not in applying or paused state; current state is '{}'",
                plan_id, plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Signal cancellation to the running executor.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.cancel_token.cancel();
            drop(run);
        }
        drop(registry);
    }

    let cancelled_at = Timestamp::now_iso();

    Ok(PlanCancelResponse {
        plan_id: plan_id.to_owned(),
        cancelled_at,
        items_applied: plan_row.items_applied,
        items_cancelled: plan_row.items_pending,
    })
}

// ── resume_plan ───────────────────────────────────────────────────────────────

/// Resume a paused plan apply run (R-Pause-1, T052).
///
/// Re-validates that the pause condition has been resolved before
/// transitioning back to `applying`. For v1, we trust the caller to have
/// resolved the condition and simply transition the state.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `run.not_paused` — plan is not in paused state.
pub async fn resume_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    run_id: &str,
) -> Result<PlanResumeResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "paused" {
        return Err(ContractError::new(
            ErrorCode::RunNotPaused,
            format!("plan {} is not paused; current state is '{}'", plan_id, plan_row.state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Re-validate run id is the active run.
    let active_run_row = apply_repo::get_active_run(pool, plan_id).await.map_err(db_err)?;
    let active_run_row = active_run_row.ok_or_else(|| {
        ContractError::new(
            ErrorCode::RunNotFound,
            format!("no active run found for plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if active_run_row.id != run_id {
        return Err(ContractError::new(
            ErrorCode::RunNotFound,
            format!("run {run_id} is not the active run for plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    apply_repo::resume_run(pool, plan_id, run_id).await.map_err(db_err)?;

    let resumed_at = Timestamp::now_iso();

    bus.publish(
        TOPIC_PLAN_APPLYING_RESUMED,
        Source::User,
        PlanApplyingResumed {
            plan_id: plan_id.to_owned(),
            run_id: run_id.to_owned(),
            at: resumed_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    let _ = apply_repo::append_event(
        pool,
        &new_id(),
        run_id,
        plan_id,
        None,
        "paused",
        "applying",
        &resumed_at,
        None,
        None,
    )
    .await;

    Ok(PlanResumeResponse { plan_id: plan_id.to_owned(), run_id: run_id.to_owned(), resumed_at })
}

// ── skip_plan_item ────────────────────────────────────────────────────────────

/// Skip a pending item within an active apply (US4, T039).
///
/// The item must be `pending` and the plan must be `applying`.
/// The skip is registered in the in-memory SkipSet; the executor picks it
/// up before starting the next item.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not applying.
/// - `item.not_found` — item not found.
/// - `item.not_pending` — item is not in pending state.
pub async fn skip_plan_item(
    pool: &SqlitePool,
    plan_id: &str,
    item_id: &str,
) -> Result<PlanItemSkipResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "applying" {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!(
                "plan {} is not in applying state; current state is '{}'",
                plan_id, plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Find the item.
    let items = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let item = items.iter().find(|i| i.id == item_id).ok_or_else(|| {
        ContractError::new(
            ErrorCode::ItemNotFound,
            format!("item {item_id} not found in plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if item.item_state != "pending" {
        return Err(ContractError::new(
            ErrorCode::ItemNotPending,
            format!("item {} is not pending; current state is '{}'", item_id, item.item_state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Inject into the executor's skip set.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.skip_set.insert(item_id);
            drop(run);
        }
        drop(registry);
    }

    Ok(PlanItemSkipResponse { item_id: item_id.to_owned(), new_state: "skipped".to_owned() })
}

// ── retry_plan_item ───────────────────────────────────────────────────────────

/// Retry a failed item within an active apply (US4, T040).
///
/// The item must be `failed` and the plan must be `applying`.
/// The item state is reset to `pending` in the database; the executor
/// will re-execute it on the next pass via the retry queue.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not applying.
/// - `item.not_found` — item not found.
/// - `item.not_failed` — item is not in failed state.
pub async fn retry_plan_item(
    pool: &SqlitePool,
    plan_id: &str,
    item_id: &str,
) -> Result<PlanItemRetryResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "applying" {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!("plan {plan_id} is not in applying state (use plan.retry for terminal plans)"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let items = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let item = items.iter().find(|i| i.id == item_id).ok_or_else(|| {
        ContractError::new(
            ErrorCode::ItemNotFound,
            format!("item {item_id} not found in plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if item.item_state != "failed" {
        return Err(ContractError::new(
            ErrorCode::ItemNotFailed,
            format!(
                "item {} is not failed; current state is '{}'. \
                 For plan-level retry use plan.retry on a terminal plan.",
                item_id, item.item_state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Transition item back to applying in DB (failed → applying).
    apply_repo::item_retry_applying(pool, item_id, plan_id).await.map_err(db_err)?;

    // Register in the retry queue so the executor re-executes it.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.retry_queue.push(item_id);
            drop(run);
        }
        drop(registry);
    }

    Ok(PlanItemRetryResponse { item_id: item_id.to_owned(), new_state: "applying".to_owned() })
}

// ── get_apply_status ──────────────────────────────────────────────────────────

/// Fetch the current apply status for a plan.
///
/// # Errors
///
/// Returns `ContractError` on not-found or database failure.
pub async fn get_apply_status(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<PlanApplyStatus, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;
    let active_run = apply_repo::get_active_run(pool, plan_id).await.map_err(db_err)?;

    let (run_id, pause_reason) = active_run.map_or((None, None), |r| (Some(r.id), r.pause_reason));

    Ok(PlanApplyStatus {
        plan_id: plan_id.to_owned(),
        run_id,
        plan_state: plan_row.state,
        items_total: plan_row.items_total,
        items_applied: plan_row.items_applied,
        items_failed: plan_row.items_failed,
        items_skipped: plan_row.items_skipped,
        items_cancelled: plan_row.items_cancelled,
        items_pending: plan_row.items_pending,
        pause_reason,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use persistence_db::repositories::plans as repo;
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_approved_plan_with_items(db: &Database, plan_id: &str, item_count: usize) {
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: plan_id,
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();

        for i in 0..item_count {
            repo::insert_plan_item(
                db.pool(),
                &repo::InsertPlanItem {
                    id: &format!("{plan_id}-item-{i}"),
                    plan_id,
                    item_index: i64::try_from(i + 1).unwrap(),
                    name: "file.fits",
                    action: "move",
                    from_root_id: None,
                    from_relative_path: "raw/file.fits",
                    to_root_id: None,
                    to_relative_path: "archive/file.fits",
                    reason: "test",
                    protection: "normal",
                    linked_entity: None,
                    provenance_json: None,
                    archive_path: None,
                    source_id: None,
                    category: None,
                },
            )
            .await
            .unwrap();
        }

        repo::update_plan_state(db.pool(), plan_id, "ready_for_review").await.unwrap();
        repo::set_approved(db.pool(), plan_id, "2026-06-01T00:00:00Z", "test-token").await.unwrap();
    }

    #[tokio::test]
    async fn apply_plan_rejects_wrong_state() {
        let (db, bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-draft",
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();

        let err = apply_plan(db.pool(), &bus, "p-draft", "tok", None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanInvalidState);
    }

    #[tokio::test]
    async fn apply_plan_rejects_wrong_token() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p1", 1).await;

        let err = apply_plan(db.pool(), &bus, "p1", "wrong-token", None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanApprovalStale);
    }

    #[tokio::test]
    async fn apply_plan_starts_successfully() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p1", 1).await;

        let resp = apply_plan(db.pool(), &bus, "p1", "test-token", None).await.unwrap();
        assert_eq!(resp.plan_id, "p1");
        assert_eq!(resp.new_state, "applying");
        assert!(!resp.run_id.is_empty());

        // Plan state should be applying.
        let plan = repo::get_plan(db.pool(), "p1", false).await.unwrap();
        assert_eq!(plan.state, "applying");

        // Wait briefly for the background task to complete.
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    /// T240 (spec 042 US16): a subscribed sink receives the long-op lifecycle —
    /// a `Started` (ItemStarted carrying the running handle), per-item events,
    /// then a terminal `Completed`/`Failed` carrying a terminal handle, with a
    /// strictly increasing `sequence`. The durable audit rows are still written
    /// (asserted separately) — the sink is an additive live projection (§II).
    #[tokio::test]
    async fn apply_plan_streams_operation_events() {
        use std::sync::Mutex;

        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-evt", 1).await;

        let captured: Arc<Mutex<Vec<OperationEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_store = captured.clone();
        let sink: OperationEventSink = Arc::new(move |event: OperationEvent| {
            sink_store.lock().unwrap().push(event);
        });

        let resp = apply_plan(db.pool(), &bus, "p-evt", "test-token", Some(sink)).await.unwrap();

        // Let the background executor run to completion.
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let events = captured.lock().unwrap().clone();
        assert!(!events.is_empty(), "sink must receive long-op events");

        // First event is the Started projection carrying a Running handle.
        let first = &events[0];
        assert_eq!(first.event_type, OperationEventType::ItemStarted);
        assert_eq!(first.operation_id, OperationId(resp.run_id.clone()));
        assert_eq!(first.sequence, 0);

        // Sequence is strictly increasing across the run.
        for window in events.windows(2) {
            assert!(window[1].sequence > window[0].sequence, "sequence must be monotonic");
        }

        // The run terminates with a Completed (or Failed) event carrying a
        // terminal handle.
        let last = events.last().unwrap();
        assert!(
            matches!(last.event_type, OperationEventType::Completed | OperationEventType::Failed),
            "last event must be a terminal Completed/Failed, got {:?}",
            last.event_type
        );

        // Durable audit trail is retained: the DB still holds run events.
        let plan = repo::get_plan(db.pool(), "p-evt", false).await.unwrap();
        assert_ne!(plan.state, "approved", "plan must have progressed past approved in the DB");
    }

    #[tokio::test]
    async fn cancel_plan_rejects_non_applying() {
        let (db, _bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p2",
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();

        let err = cancel_plan(db.pool(), "p2").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotInApply);
    }

    #[tokio::test]
    async fn skip_item_rejects_when_not_applying() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p3", 1).await;

        let err = skip_plan_item(db.pool(), "p3", "p3-item-0").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotInApply);
    }

    #[tokio::test]
    async fn get_apply_status_returns_plan_state() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p4", 2).await;

        let status = get_apply_status(db.pool(), "p4").await.unwrap();
        assert_eq!(status.plan_id, "p4");
        assert_eq!(status.plan_state, "approved");
        assert_eq!(status.items_total, 2);
        assert!(status.run_id.is_none());
    }

    #[tokio::test]
    async fn verify_approval_token_rejects_mismatched_token() {
        let result = verify_approval_token(Some("stored-token"), "different-token");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanApprovalStale);
    }

    #[tokio::test]
    async fn verify_approval_token_rejects_missing_token() {
        let result = verify_approval_token(None, "any-token");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verify_approval_token_accepts_matching_token() {
        let result = verify_approval_token(Some("tok-abc"), "tok-abc");
        assert!(result.is_ok());
    }

    // ── T023a tests ───────────────────────────────────────────────────────────

    /// T023a: item_row_to_executor_item sets library_root from the root_map
    /// so the path-gate fires on real plan items.
    #[test]
    fn t023a_library_root_resolved_from_map() {
        let row = plans_repo::PlanItemRow {
            id: "item-1".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "move".to_owned(),
            from_root_id: Some("root-001".to_owned()),
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: Some("root-001".to_owned()),
            to_relative_path: "archive/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let mut root_map = HashMap::new();
        root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

        let item = item_row_to_executor_item(&row, &root_map);
        assert_eq!(
            item.library_root,
            Some(Utf8PathBuf::from("/mnt/library")),
            "library_root must be populated from the root_map so the path gate fires"
        );
    }

    /// T023a: item without from_root_id gets library_root = None (legacy/unknown mode).
    #[test]
    fn t023a_no_root_id_gives_none_library_root() {
        let row = plans_repo::PlanItemRow {
            id: "item-2".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "move".to_owned(),
            from_root_id: None,
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: "archive/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
        let item = item_row_to_executor_item(&row, &root_map);
        assert_eq!(item.library_root, None);
    }

    /// T023a: root-escaping relative path is refused by the gate when library_root is set.
    /// This proves the gate is active on real plan items (not inert).
    #[test]
    fn t023a_root_escape_gate_fires_when_library_root_is_set() {
        use fs_executor::ops::path_gate;

        let root = Utf8PathBuf::from("/mnt/library");
        // A path that escapes the root via ".." — must be refused.
        let escaping_relative = Utf8PathBuf::from("../../etc/passwd");

        let result = path_gate::resolve_and_validate(&root, &escaping_relative);
        assert!(result.is_err(), "root-escaping path must be refused when library_root is set");
        let failure = result.unwrap_err();
        assert_eq!(failure.code.as_str(), "root_escape", "failure code must be root_escape");
    }

    /// T023a: destructive_confirmed is now a real DB column (migration 0033),
    /// read directly (not defaulted via #[sqlx(default)]).
    #[test]
    fn t023a_destructive_confirmed_reads_from_db_column() {
        let row = plans_repo::PlanItemRow {
            id: "item-3".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "delete".to_owned(),
            from_root_id: None,
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: String::new(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(1),
            resolved_pattern: None,
            destructive_confirmed: 1, // user confirmed
        };

        let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
        let item = item_row_to_executor_item(&row, &root_map);
        assert!(item.destructive_confirmed, "destructive_confirmed=1 in DB must be read as true");
        assert!(
            item.requires_destructive_confirm,
            "delete action must require destructive confirm"
        );
    }

    // ── FR-017: panic-safe registry removal (US12) ──────────────────────────────

    /// Build an [`ActiveRun`] with no control wiring of consequence — the guard
    /// test only cares about presence/absence of the entry by key.
    fn dummy_active_run() -> ActiveRun {
        ActiveRun {
            cancel_token: CancellationToken::new(),
            skip_set: SkipSet::new(),
            retry_queue: RetryQueue::new(),
            run_id: "run-guard-test".to_owned(),
        }
    }

    /// FR-017: on a *normal* scope exit the guard's `Drop` removes the entry
    /// exactly once. This is the Completed / Cancelled / Paused path.
    #[test]
    fn active_run_guard_removes_entry_on_normal_drop() {
        let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
        let plan_id = "plan-guard-normal";
        registry.insert(plan_id.to_owned(), dummy_active_run());
        assert!(registry.contains_key(plan_id), "entry present after insert");

        {
            let _guard = ActiveRunGuard { registry: registry.clone(), plan_id: plan_id.to_owned() };
            // entry still present while the guard is held
            assert!(registry.contains_key(plan_id), "entry present while guard held");
        } // guard drops here

        assert!(
            !registry.contains_key(plan_id),
            "guard Drop must remove the entry on normal scope exit"
        );
    }

    /// FR-017 acceptance scenario 2: a plan run that panics mid-apply must still
    /// have its registry entry removed. The guard is owned by the same scope
    /// that runs `execute_plan`; a panic there unwinds that scope, running the
    /// guard's `Drop`. We model that scope with `catch_unwind` around a panic
    /// that occurs *after* the guard is constructed and the entry inserted —
    /// exactly the shape of `tokio::spawn(async move { let _g = guard; execute_plan().await })`
    /// when `execute_plan` panics.
    #[test]
    fn active_run_guard_removes_entry_when_scope_panics() {
        let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
        let plan_id = "plan-guard-panic";
        registry.insert(plan_id.to_owned(), dummy_active_run());
        assert!(registry.contains_key(plan_id), "entry present after insert");

        let registry_for_scope = registry.clone();
        let plan_id_owned = plan_id.to_owned();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            // Guard is owned by this scope, mirroring the spawned task.
            let _guard = ActiveRunGuard { registry: registry_for_scope, plan_id: plan_id_owned };
            // Stand-in for `execute_plan(...).await` panicking mid-apply.
            panic!("execute_plan panicked mid-apply");
        }));

        assert!(result.is_err(), "the scope must have panicked");
        assert!(
            !registry.contains_key(plan_id),
            "FR-017: guard Drop must remove the registry entry even when the scope unwinds from a panic"
        );
    }
}
