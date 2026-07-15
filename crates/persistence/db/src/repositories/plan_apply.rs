// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Repository methods for plan apply runs and events (spec 025).
//!
//! Operates on the `plan_apply_runs` and `plan_apply_events` tables from
//! migration 0015. The `plan_apply_events` table is append-only; no UPDATE
//! or DELETE is permitted (FR-003, SC-001, data-model.md invariants).
//!
//! Apply-side plan-state transitions (`applying`, `paused`, `applied`,
//! `partially_applied`, `failed`, `cancelled`) are also written here; the
//! review-side state transitions live in `plans.rs`.

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{DbError, DbResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Row types ─────────────────────────────────────────────────────────────────

/// Row returned from the `plan_apply_runs` table.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlanApplyRunRow {
    pub id: String,
    pub plan_id: String,
    pub approval_token: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub terminal_state: Option<String>,
    pub items_total: i64,
    pub items_applied: i64,
    pub items_failed: i64,
    pub items_skipped: i64,
    pub items_cancelled: i64,
    pub items_pending: i64,
    pub pause_reason: Option<String>,
}

/// Row returned from the `plan_apply_events` table.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlanApplyEventRow {
    pub id: String,
    pub run_id: String,
    pub plan_id: String,
    pub item_id: Option<String>,
    pub prior_state: String,
    pub new_state: String,
    pub at: String,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub failure_recoverable: Option<i64>,
    pub rollback_attempted: Option<i64>,
    pub rollback_outcome: Option<String>,
    pub rollback_message: Option<String>,
}

/// Failure detail to store with an event.
#[derive(Clone, Debug)]
pub struct EventFailure<'a> {
    pub code: &'a str,
    pub message: &'a str,
    pub recoverable: bool,
}

/// Rollback detail to store with an event.
#[derive(Clone, Debug)]
pub struct EventRollback<'a> {
    pub attempted: bool,
    pub outcome: &'a str,
    pub message: Option<&'a str>,
}

// ── CAS transition: approved → applying ──────────────────────────────────────

/// Atomically transition a plan from `approved` to `applying` (CAS, R-CAS-1).
/// Creates the `plan_apply_runs` row in the same SQLite transaction.
///
/// Returns the run id on success.
///
/// # Errors
///
/// - `DbError::CasFailed` if the plan state was not `approved` at transition
///   time (concurrent apply race or invalid state).
/// - `DbError::NotFound` if the plan does not exist.
/// - `DbError::Database` on connection failure.
pub async fn cas_approved_to_applying(
    pool: &SqlitePool,
    plan_id: &str,
    run_id: &str,
    approval_token: &str,
    items_total: i64,
    items_pending: i64,
) -> DbResult<()> {
    let now = Timestamp::now_iso();

    // Use a transaction so the CAS + run row insertion are atomic.
    let mut tx = pool.begin().await?;

    // Attempt atomic CAS: only update if current state is 'approved'.
    let rows = sqlx::query(
        "UPDATE plans SET state = 'applying' \
         WHERE id = ? AND state = 'approved'",
    )
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    if rows.rows_affected() == 0 {
        // Either not found or not in approved state. Check which.
        let exists: Option<String> = sqlx::query_scalar("SELECT state FROM plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(&mut *tx)
            .await?;
        return match exists {
            None => Err(DbError::NotFound(format!("plan {plan_id}"))),
            Some(state) => Err(DbError::CasFailed(format!(
                "plan {plan_id} expected state 'approved', found '{state}'"
            ))),
        };
    }

    // Create the mandatory PlanApplyRun row (R-Run-1).
    sqlx::query(
        "INSERT INTO plan_apply_runs \
         (id, plan_id, approval_token, started_at, items_total, items_pending) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(run_id)
    .bind(plan_id)
    .bind(approval_token)
    .bind(&now)
    .bind(items_total)
    .bind(items_pending)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

// ── Run state updates ─────────────────────────────────────────────────────────

/// Transition plan to terminal state and finalise the run row.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn complete_run(
    pool: &SqlitePool,
    plan_id: &str,
    run_id: &str,
    terminal_state: &str,
    items_applied: i64,
    items_failed: i64,
    items_skipped: i64,
    items_cancelled: i64,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    let items_pending = 0i64;

    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE plans SET \
           state = ?, \
           items_applied = ?, items_failed = ?, items_skipped = ?, \
           items_cancelled = ?, items_pending = ? \
         WHERE id = ?",
    )
    .bind(terminal_state)
    .bind(items_applied)
    .bind(items_failed)
    .bind(items_skipped)
    .bind(items_cancelled)
    .bind(items_pending)
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE plan_apply_runs SET \
           ended_at = ?, terminal_state = ?, \
           items_applied = ?, items_failed = ?, items_skipped = ?, \
           items_cancelled = ?, items_pending = 0 \
         WHERE id = ?",
    )
    .bind(&now)
    .bind(terminal_state)
    .bind(items_applied)
    .bind(items_failed)
    .bind(items_skipped)
    .bind(items_cancelled)
    .bind(run_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Pause a run (R-Pause-1): transition plan → paused, update run row.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
#[allow(clippy::too_many_arguments)]
pub async fn pause_run(
    pool: &SqlitePool,
    plan_id: &str,
    run_id: &str,
    pause_reason: &str,
    items_applied: i64,
    items_failed: i64,
    items_skipped: i64,
    items_cancelled: i64,
    items_pending: i64,
) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE plans SET state = 'paused' WHERE id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE plan_apply_runs SET \
           terminal_state = 'paused', pause_reason = ?, \
           items_applied = ?, items_failed = ?, items_skipped = ?, \
           items_cancelled = ?, items_pending = ? \
         WHERE id = ?",
    )
    .bind(pause_reason)
    .bind(items_applied)
    .bind(items_failed)
    .bind(items_skipped)
    .bind(items_cancelled)
    .bind(items_pending)
    .bind(run_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Resume a paused run: transition plan → applying, clear pause state.
///
/// # Errors
///
/// Returns [`DbError::CasFailed`] if plan is not in `paused` state.
/// Returns [`DbError::Database`] on connection failure.
pub async fn resume_run(pool: &SqlitePool, plan_id: &str, run_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    let rows = sqlx::query("UPDATE plans SET state = 'applying' WHERE id = ? AND state = 'paused'")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    if rows.rows_affected() == 0 {
        let state: Option<String> = sqlx::query_scalar("SELECT state FROM plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(&mut *tx)
            .await?;
        return match state {
            None => Err(DbError::NotFound(format!("plan {plan_id}"))),
            Some(s) => Err(DbError::CasFailed(format!(
                "plan {plan_id} expected state 'paused', found '{s}'"
            ))),
        };
    }

    sqlx::query(
        "UPDATE plan_apply_runs SET terminal_state = NULL, pause_reason = NULL WHERE id = ?",
    )
    .bind(run_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

// ── Per-item state transitions ────────────────────────────────────────────────

/// Transition an item from `pending` → `applying`; decrement items_pending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_start_applying(pool: &SqlitePool, item_id: &str, plan_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE plan_items SET item_state = 'applying' WHERE id = ?")
        .bind(item_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE plans SET items_pending = items_pending - 1 WHERE id = ? AND items_pending > 0",
    )
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Transition an item from `applying` → `succeeded`; increment items_applied.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_succeeded(pool: &SqlitePool, item_id: &str, plan_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE plan_items SET item_state = 'succeeded', failure_reason = NULL WHERE id = ?",
    )
    .bind(item_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE plans SET items_applied = items_applied + 1 WHERE id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Transition an item from `applying` → `failed`; increment items_failed.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_failed(
    pool: &SqlitePool,
    item_id: &str,
    plan_id: &str,
    failure_reason: &str,
) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE plan_items SET item_state = 'failed', failure_reason = ? WHERE id = ?")
        .bind(failure_reason)
        .bind(item_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE plans SET items_failed = items_failed + 1 WHERE id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Transition an item to `stale` (R-FS-1); increments `items_failed` (the
/// item is terminally `failed` from the plan's perspective, matching
/// [`item_failed`]) and the run pauses.
///
/// Previously this left `plans.items_failed` unchanged, which `pause_run`
/// never read either — but `resume_plan`'s cumulative-counter reporting
/// (issue #575, spec 025 R-Pause-1) and `get_apply_status` both surface
/// `plans.items_failed` directly, so an under-count here would silently
/// misreport a stale-paused plan as fully applied once its remaining items
/// finish on resume.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_stale(pool: &SqlitePool, item_id: &str, plan_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE plan_items SET item_state = 'failed', item_stale = 1, \
         failure_reason = 'item.stale: source file changed since approval' WHERE id = ?",
    )
    .bind(item_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE plans SET items_failed = items_failed + 1 WHERE id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Transition an item from `pending` → `skipped` (user action during apply).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_skip(pool: &SqlitePool, item_id: &str, plan_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE plan_items SET item_state = 'skipped' WHERE id = ? AND item_state = 'pending'",
    )
    .bind(item_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE plans SET \
         items_pending = items_pending - 1, \
         items_skipped = items_skipped + 1 \
         WHERE id = ? AND items_pending > 0",
    )
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Transition a failed item back to `applying` (per-item retry within a run).
/// Decrements items_failed.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn item_retry_applying(pool: &SqlitePool, item_id: &str, plan_id: &str) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE plan_items SET item_state = 'applying', item_stale = 0, failure_reason = NULL \
         WHERE id = ? AND item_state = 'failed'",
    )
    .bind(item_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE plans SET items_failed = items_failed - 1 WHERE id = ? AND items_failed > 0",
    )
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// List the IDs of all `pending` items for a plan.
///
/// Used to emit per-item audit rows before batch-cancelling (FR-005, T021).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_pending_items(pool: &SqlitePool, plan_id: &str) -> DbResult<Vec<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM plan_items WHERE plan_id = ? AND item_state = 'pending' ORDER BY item_index ASC",
    )
    .bind(plan_id)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Batch-transition all `pending` items to `cancelled`; update plan counters.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn batch_cancel_pending_items(pool: &SqlitePool, plan_id: &str) -> DbResult<i64> {
    let mut tx = pool.begin().await?;

    let rows = sqlx::query(
        "UPDATE plan_items SET item_state = 'cancelled' \
         WHERE plan_id = ? AND item_state = 'pending'",
    )
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;

    let cancelled_count = i64::try_from(rows.rows_affected()).unwrap_or(i64::MAX);

    if cancelled_count > 0 {
        sqlx::query(
            "UPDATE plans SET \
             items_cancelled = items_cancelled + ?, \
             items_pending = 0 \
             WHERE id = ?",
        )
        .bind(cancelled_count)
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(cancelled_count)
}

/// Cancel any items left in `applying` when a run ends `Cancelled`.
///
/// Under normal forward-loop execution no item is ever `applying` when
/// `fs_executor::run::execute_plan` returns `Cancelled` — cancellation is
/// checked strictly *between* items, so an item picked up for real always
/// runs to a terminal state first. The one exception is a mid-run retry
/// (`retry_plan_item`): it flips the DB row `failed -> applying` and queues
/// the id *eagerly*, independent of whether the executor's retry-drain loop
/// ever actually re-executes it before observing cancellation. Such an item
/// is invisible to [`batch_cancel_pending_items`] (which only targets
/// `pending`) and would otherwise stay `applying` forever with no terminal
/// audit record (review fix for issues #742/#575 follow-up). Returns the
/// cancelled item ids so the caller can emit a per-item audit row for each.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn cancel_orphaned_applying_items(
    pool: &SqlitePool,
    plan_id: &str,
) -> DbResult<Vec<String>> {
    let mut tx = pool.begin().await?;

    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM plan_items WHERE plan_id = ? AND item_state = 'applying' \
         ORDER BY item_index ASC",
    )
    .bind(plan_id)
    .fetch_all(&mut *tx)
    .await?;

    if !ids.is_empty() {
        sqlx::query(
            "UPDATE plan_items SET item_state = 'cancelled' \
             WHERE plan_id = ? AND item_state = 'applying'",
        )
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

        let cancelled_count = i64::try_from(ids.len()).unwrap_or(i64::MAX);
        sqlx::query("UPDATE plans SET items_cancelled = items_cancelled + ? WHERE id = ?")
            .bind(cancelled_count)
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(ids)
}

// ── Audit event writes ────────────────────────────────────────────────────────

/// Append an audit event row (append-only; no UPDATE/DELETE allowed).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
#[allow(clippy::too_many_arguments)]
pub async fn append_event(
    pool: &SqlitePool,
    event_id: &str,
    run_id: &str,
    plan_id: &str,
    item_id: Option<&str>,
    prior_state: &str,
    new_state: &str,
    at: &str,
    failure: Option<&EventFailure<'_>>,
    rollback: Option<&EventRollback<'_>>,
) -> DbResult<()> {
    let (fc, fm, fr) = failure.map_or((None, None, None), |f| {
        (Some(f.code), Some(f.message), Some(i64::from(f.recoverable)))
    });

    let (ra, ro, rm) = rollback
        .map_or((None, None, None), |r| (Some(i64::from(r.attempted)), Some(r.outcome), r.message));

    sqlx::query(
        "INSERT INTO plan_apply_events \
         (id, run_id, plan_id, item_id, prior_state, new_state, at, \
          failure_code, failure_message, failure_recoverable, \
          rollback_attempted, rollback_outcome, rollback_message) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(event_id)
    .bind(run_id)
    .bind(plan_id)
    .bind(item_id)
    .bind(prior_state)
    .bind(new_state)
    .bind(at)
    .bind(fc)
    .bind(fm)
    .bind(fr)
    .bind(ra)
    .bind(ro)
    .bind(rm)
    .execute(pool)
    .await?;

    Ok(())
}

// ── Queries ───────────────────────────────────────────────────────────────────

/// Fetch a plan apply run by id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if no run matches.
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_run(pool: &SqlitePool, run_id: &str) -> DbResult<PlanApplyRunRow> {
    let row: Option<PlanApplyRunRow> = sqlx::query_as("SELECT * FROM plan_apply_runs WHERE id = ?")
        .bind(run_id)
        .fetch_optional(pool)
        .await?;

    row.ok_or_else(|| DbError::NotFound(format!("run {run_id}")))
}

/// Fetch the most recent active (paused or applying) run for a plan.
///
/// Returns `None` if no run is in-progress.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_active_run(pool: &SqlitePool, plan_id: &str) -> DbResult<Option<PlanApplyRunRow>> {
    Ok(sqlx::query_as(
        "SELECT * FROM plan_apply_runs \
         WHERE plan_id = ? AND (terminal_state IS NULL OR terminal_state = 'paused') \
         ORDER BY started_at DESC LIMIT 1",
    )
    .bind(plan_id)
    .fetch_optional(pool)
    .await?)
}

/// List all apply events for a plan in chronological order.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_events(pool: &SqlitePool, plan_id: &str) -> DbResult<Vec<PlanApplyEventRow>> {
    Ok(sqlx::query_as("SELECT * FROM plan_apply_events WHERE plan_id = ? ORDER BY at ASC")
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
}

/// Fetch the plan item whose CAS mismatch most recently triggered a pause
/// (`item_state = 'failed'`, `item_stale = 1`).
///
/// The executor halts immediately on the first item that trips a pause
/// condition (R-Pause-1), so the highest `item_index` among stale items is
/// the one that caused the *current* pause. `resume_plan` re-probes this
/// item's source path before allowing `paused -> applying` (spec 025
/// T048/T049/T050).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_last_stale_item(
    pool: &SqlitePool,
    plan_id: &str,
) -> DbResult<Option<crate::repositories::plans::PlanItemRow>> {
    Ok(sqlx::query_as(
        "SELECT * FROM plan_items WHERE plan_id = ? AND item_stale = 1 \
         ORDER BY item_index DESC LIMIT 1",
    )
    .bind(plan_id)
    .fetch_optional(pool)
    .await?)
}

/// Fetch the plan item whose failure reason most recently began with
/// `code_prefix` (e.g. `"volume.unavailable"`, `"disk.full"`).
///
/// Same "highest `item_index` among matching failures = the item that
/// caused the current pause" reasoning as [`get_last_stale_item`].
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_last_item_with_failure_prefix(
    pool: &SqlitePool,
    plan_id: &str,
    code_prefix: &str,
) -> DbResult<Option<crate::repositories::plans::PlanItemRow>> {
    let pattern = format!("{code_prefix}%");
    Ok(sqlx::query_as(
        "SELECT * FROM plan_items WHERE plan_id = ? AND item_state = 'failed' \
         AND failure_reason LIKE ? ORDER BY item_index DESC LIMIT 1",
    )
    .bind(plan_id)
    .bind(pattern)
    .fetch_optional(pool)
    .await?)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::plans as plans_repo;
    use crate::Database;

    async fn setup_with_approved_plan(db: &Database, plan_id: &str, item_count: usize) {
        plans_repo::insert_plan(
            db.pool(),
            &plans_repo::InsertPlan {
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
            plans_repo::insert_plan_item(
                db.pool(),
                &plans_repo::InsertPlanItem {
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

        plans_repo::update_plan_state(db.pool(), plan_id, "ready_for_review").await.unwrap();
        plans_repo::set_approved(db.pool(), plan_id, "2026-06-01T00:00:00Z", "test-token")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn cas_approved_to_applying_happy_path() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        setup_with_approved_plan(&db, "p1", 2).await;

        cas_approved_to_applying(db.pool(), "p1", "run-1", "test-token", 2, 2).await.unwrap();

        let plan = plans_repo::get_plan(db.pool(), "p1", false).await.unwrap();
        assert_eq!(plan.state, "applying");

        let run = get_run(db.pool(), "run-1").await.unwrap();
        assert_eq!(run.plan_id, "p1");
        assert_eq!(run.items_total, 2);
    }

    #[tokio::test]
    async fn cas_fails_if_not_approved() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        plans_repo::insert_plan(
            db.pool(),
            &plans_repo::InsertPlan {
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

        let err =
            cas_approved_to_applying(db.pool(), "p2", "run-x", "tok", 0, 0).await.unwrap_err();
        assert!(matches!(err, DbError::CasFailed(_)), "expected CasFailed, got {err:?}");
    }

    #[tokio::test]
    async fn item_state_transitions() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        setup_with_approved_plan(&db, "p3", 1).await;
        cas_approved_to_applying(db.pool(), "p3", "run-3", "tok", 1, 1).await.unwrap();

        item_start_applying(db.pool(), "p3-item-0", "p3").await.unwrap();
        let items = plans_repo::list_plan_items(db.pool(), "p3").await.unwrap();
        assert_eq!(items[0].item_state, "applying");

        item_succeeded(db.pool(), "p3-item-0", "p3").await.unwrap();
        let items = plans_repo::list_plan_items(db.pool(), "p3").await.unwrap();
        assert_eq!(items[0].item_state, "succeeded");

        let plan = plans_repo::get_plan(db.pool(), "p3", false).await.unwrap();
        assert_eq!(plan.items_applied, 1);
    }

    #[tokio::test]
    async fn batch_cancel_pending_items_test() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        setup_with_approved_plan(&db, "p4", 3).await;
        cas_approved_to_applying(db.pool(), "p4", "run-4", "tok", 3, 3).await.unwrap();

        // Apply first item.
        item_start_applying(db.pool(), "p4-item-0", "p4").await.unwrap();
        item_succeeded(db.pool(), "p4-item-0", "p4").await.unwrap();

        // Cancel remaining 2.
        let cancelled = batch_cancel_pending_items(db.pool(), "p4").await.unwrap();
        assert_eq!(cancelled, 2);

        let plan = plans_repo::get_plan(db.pool(), "p4", false).await.unwrap();
        assert_eq!(plan.items_cancelled, 2);
        assert_eq!(plan.items_pending, 0);
    }

    #[tokio::test]
    async fn append_and_list_events() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        setup_with_approved_plan(&db, "p5", 1).await;
        cas_approved_to_applying(db.pool(), "p5", "run-5", "tok", 1, 1).await.unwrap();

        append_event(
            db.pool(),
            "evt-1",
            "run-5",
            "p5",
            Some("p5-item-0"),
            "pending",
            "applying",
            "2026-06-01T00:00:00Z",
            None,
            None,
        )
        .await
        .unwrap();

        let events = list_events(db.pool(), "p5").await.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].prior_state, "pending");
        assert_eq!(events[0].new_state, "applying");
    }

    #[tokio::test]
    async fn complete_run_updates_plan_and_run() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        setup_with_approved_plan(&db, "p6", 2).await;
        cas_approved_to_applying(db.pool(), "p6", "run-6", "tok", 2, 2).await.unwrap();

        complete_run(db.pool(), "p6", "run-6", "applied", 2, 0, 0, 0).await.unwrap();

        let plan = plans_repo::get_plan(db.pool(), "p6", false).await.unwrap();
        assert_eq!(plan.state, "applied");
        assert_eq!(plan.items_applied, 2);

        let run = get_run(db.pool(), "run-6").await.unwrap();
        assert_eq!(run.terminal_state, Some("applied".to_owned()));
    }
}
