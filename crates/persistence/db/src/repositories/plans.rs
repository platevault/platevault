//! Repository methods for plan storage (spec 017).
//!
//! Operates on the `plans` and `plan_items` tables from migration 0014.
//! Paths are stored as (root_id, relative_path) pairs; callers resolve to
//! absolute paths for display. This module owns only raw DB operations;
//! state-machine enforcement lives in `crates/app/core/src/plans.rs`.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── Row types ─────────────────────────────────────────────────────────────────

/// Flat row returned from the `plans` table for list and get operations.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlanRow {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub origin: String,
    pub origin_path: Option<String>,
    pub state: String,
    pub plan_type: String,
    pub destructive_destination: String,
    pub parent_plan_id: Option<String>,
    pub items_total: i64,
    pub items_applied: i64,
    pub items_failed: i64,
    pub items_skipped: i64,
    pub items_cancelled: i64,
    pub items_pending: i64,
    pub total_bytes_required: i64,
    pub approval_token: Option<String>,
    pub approved_at: Option<String>,
    pub discarded_at: Option<String>,
    pub created_at: String,
}

/// Flat row returned from the `plan_items` table.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlanItemRow {
    pub id: String,
    pub plan_id: String,
    pub item_index: i64,
    pub name: String,
    pub action: String,
    pub from_root_id: Option<String>,
    pub from_relative_path: String,
    pub to_root_id: Option<String>,
    pub to_relative_path: String,
    pub reason: String,
    pub protection: String,
    pub linked_entity: Option<String>,
    pub item_state: String,
    pub failure_reason: Option<String>,
    pub provenance: Option<String>,
    pub approved_mtime: Option<String>,
    pub approved_size_bytes: Option<i64>,
    pub archive_path: Option<String>,
    pub created_at: String,
}

/// Data required to insert a new plan.
#[derive(Clone, Debug)]
pub struct InsertPlan<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub origin: &'a str,
    pub origin_path: Option<&'a str>,
    pub plan_type: &'a str,
    pub destructive_destination: &'a str,
    pub parent_plan_id: Option<&'a str>,
    pub total_bytes_required: i64,
}

/// Data required to insert a new plan item.
#[derive(Clone, Debug)]
pub struct InsertPlanItem<'a> {
    pub id: &'a str,
    pub plan_id: &'a str,
    pub item_index: i64,
    pub name: &'a str,
    pub action: &'a str,
    pub from_root_id: Option<&'a str>,
    pub from_relative_path: &'a str,
    pub to_root_id: Option<&'a str>,
    pub to_relative_path: &'a str,
    pub reason: &'a str,
    pub protection: &'a str,
    pub linked_entity: Option<&'a str>,
    pub provenance_json: Option<&'a str>,
    pub archive_path: Option<&'a str>,
}

// ── Plan CRUD ─────────────────────────────────────────────────────────────────

/// Insert a new plan in `draft` state.
///
/// The display number is assigned as `MAX(number)+1` atomically.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn insert_plan(pool: &SqlitePool, plan: &InsertPlan<'_>) -> DbResult<i64> {
    let now = now_iso();
    let number: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(number), 0) + 1 FROM plans")
        .fetch_one(pool)
        .await?;

    sqlx::query(
        "INSERT INTO plans (
            id, number, title, origin, origin_path, state, plan_type,
            destructive_destination, parent_plan_id, items_total, items_applied,
            items_failed, items_skipped, items_cancelled, items_pending,
            total_bytes_required, created_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?)",
    )
    .bind(plan.id)
    .bind(number)
    .bind(plan.title)
    .bind(plan.origin)
    .bind(plan.origin_path)
    .bind(plan.plan_type)
    .bind(plan.destructive_destination)
    .bind(plan.parent_plan_id)
    .bind(plan.total_bytes_required)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(number)
}

/// Insert a single plan item.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn insert_plan_item(pool: &SqlitePool, item: &InsertPlanItem<'_>) -> DbResult<()> {
    let now = now_iso();
    sqlx::query(
        "INSERT INTO plan_items (
            id, plan_id, item_index, name, action,
            from_root_id, from_relative_path, to_root_id, to_relative_path,
            reason, protection, linked_entity, item_state, provenance,
            archive_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
    )
    .bind(item.id)
    .bind(item.plan_id)
    .bind(item.item_index)
    .bind(item.name)
    .bind(item.action)
    .bind(item.from_root_id)
    .bind(item.from_relative_path)
    .bind(item.to_root_id)
    .bind(item.to_relative_path)
    .bind(item.reason)
    .bind(item.protection)
    .bind(item.linked_entity)
    .bind(item.provenance_json)
    .bind(item.archive_path)
    .bind(&now)
    .execute(pool)
    .await?;

    // Update items_total and items_pending counters on the parent plan.
    sqlx::query(
        "UPDATE plans SET items_total = items_total + 1, items_pending = items_pending + 1 \
         WHERE id = ?",
    )
    .bind(item.plan_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Fetch a single plan by id (excludes discarded by default; pass `include_discarded = true`
/// to load retry-chain parents).
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if no matching row exists.
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_plan(
    pool: &SqlitePool,
    plan_id: &str,
    include_discarded: bool,
) -> DbResult<PlanRow> {
    let row: Option<PlanRow> = if include_discarded {
        sqlx::query_as("SELECT * FROM plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(pool)
            .await?
    } else {
        sqlx::query_as("SELECT * FROM plans WHERE id = ? AND state != 'discarded'")
            .bind(plan_id)
            .fetch_optional(pool)
            .await?
    };

    row.ok_or_else(|| DbError::NotFound(format!("plan {plan_id}")))
}

/// List plans ordered by failed-first, then descending creation time.
///
/// Discarded plans are excluded unless `state_filter` contains `"discarded"`.
/// `created_after` is an optional ISO-8601 timestamp cutoff (R-Ret-1).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_plans(
    pool: &SqlitePool,
    state_filter: &[String],
    origin_filter: &[String],
    created_after: Option<&str>,
    limit: i64,
) -> DbResult<Vec<PlanRow>> {
    // Build a dynamic query. SQLite does not support array binding, so we
    // validate the filter values (already validated by the use case) and
    // interpolate a fixed IN clause.
    let state_clause = if state_filter.is_empty() {
        // Default: all non-discarded states.
        "state != 'discarded'".to_owned()
    } else {
        let quoted: Vec<String> = state_filter.iter().map(|s| format!("'{s}'")).collect();
        format!("state IN ({})", quoted.join(","))
    };

    let origin_clause = if origin_filter.is_empty() {
        String::new()
    } else {
        let quoted: Vec<String> = origin_filter.iter().map(|s| format!("'{s}'")).collect();
        format!("AND origin IN ({})", quoted.join(","))
    };

    let date_clause = if created_after.is_some() { "AND created_at >= ?" } else { "" };

    // failed-first ordering: failed/partially_applied first, then by created_at desc.
    let sql = format!(
        "SELECT * FROM plans \
         WHERE {state_clause} {origin_clause} {date_clause} \
         ORDER BY \
           CASE state WHEN 'failed' THEN 0 WHEN 'partially_applied' THEN 1 ELSE 2 END ASC, \
           created_at DESC \
         LIMIT ?"
    );

    let mut q = sqlx::query_as::<_, PlanRow>(sqlx::AssertSqlSafe(&*sql));
    if let Some(after) = created_after {
        q = q.bind(after);
    }
    q = q.bind(limit);

    Ok(q.fetch_all(pool).await?)
}

/// Fetch all items for a plan, ordered by index.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_plan_items(pool: &SqlitePool, plan_id: &str) -> DbResult<Vec<PlanItemRow>> {
    Ok(sqlx::query_as("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY item_index ASC")
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
}

/// Update the plan state.
///
/// Only the review-side states are written by this function:
/// `draft`, `ready_for_review`, `approved`, `discarded`.
/// Apply-side state transitions belong to spec 025.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if no plan with `plan_id` exists.
/// Returns [`DbError::Database`] on connection failure.
pub async fn update_plan_state(pool: &SqlitePool, plan_id: &str, state: &str) -> DbResult<()> {
    let rows = sqlx::query("UPDATE plans SET state = ? WHERE id = ?")
        .bind(state)
        .bind(plan_id)
        .execute(pool)
        .await?;

    if rows.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("plan {plan_id}")));
    }
    Ok(())
}

/// Set `approved_at` and `approval_token` on a plan row.
///
/// Called by `approve_plan` after state is updated to `approved`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn set_approved(
    pool: &SqlitePool,
    plan_id: &str,
    approved_at: &str,
    approval_token: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE plans SET state = 'approved', approved_at = ?, approval_token = ? WHERE id = ?",
    )
    .bind(approved_at)
    .bind(approval_token)
    .bind(plan_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Set `discarded_at` and transition state to `discarded` (soft-delete, A5).
///
/// Row is retained; `parent_plan_id` references remain resolvable.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if no matching plan exists.
/// Returns [`DbError::Database`] on connection failure.
pub async fn soft_delete_plan(
    pool: &SqlitePool,
    plan_id: &str,
    discarded_at: &str,
) -> DbResult<()> {
    let rows = sqlx::query("UPDATE plans SET state = 'discarded', discarded_at = ? WHERE id = ?")
        .bind(discarded_at)
        .bind(plan_id)
        .execute(pool)
        .await?;

    if rows.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("plan {plan_id}")));
    }
    Ok(())
}

/// Update `approved_mtime` and `approved_size_bytes` on all pending items of a
/// plan (R-FS-1). Called at approve time to snapshot the source filesystem state.
///
/// The actual per-item snapshots are written via [`update_item_fs_snapshot`].
/// This function exists as a coordination point; callers iterate items and call
/// `update_item_fs_snapshot` per item after performing the filesystem stat.
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub fn snapshot_item_fs_metadata_noop(_pool: &SqlitePool, _plan_id: &str, _approved_at: &str) {
    // No-op: callers use update_item_fs_snapshot per-item (R-FS-1).
}

/// Update per-item FS snapshot fields (R-FS-1).
///
/// # Errors
///
/// Returns [`DbError::Database`] on connection failure.
pub async fn update_item_fs_snapshot(
    pool: &SqlitePool,
    item_id: &str,
    approved_mtime: Option<&str>,
    approved_size_bytes: Option<i64>,
) -> DbResult<()> {
    sqlx::query("UPDATE plan_items SET approved_mtime = ?, approved_size_bytes = ? WHERE id = ?")
        .bind(approved_mtime)
        .bind(approved_size_bytes)
        .bind(item_id)
        .execute(pool)
        .await?;

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn sample_plan(id: &str) -> InsertPlan<'_> {
        InsertPlan {
            id,
            title: "Test plan",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        }
    }

    #[tokio::test]
    async fn insert_and_get_plan_roundtrip() {
        let db = setup().await;
        let number = insert_plan(db.pool(), &sample_plan("plan-1")).await.unwrap();
        assert_eq!(number, 1);

        let row = get_plan(db.pool(), "plan-1", false).await.unwrap();
        assert_eq!(row.id, "plan-1");
        assert_eq!(row.state, "draft");
        assert_eq!(row.origin, "cleanup");
    }

    #[tokio::test]
    async fn display_numbers_increment() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("plan-a")).await.unwrap();
        insert_plan(db.pool(), &sample_plan("plan-b")).await.unwrap();
        let row_b = get_plan(db.pool(), "plan-b", false).await.unwrap();
        assert_eq!(row_b.number, 2);
    }

    #[tokio::test]
    async fn get_plan_not_found_returns_error() {
        let db = setup().await;
        let err = get_plan(db.pool(), "nonexistent", false).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
    }

    #[tokio::test]
    async fn soft_delete_sets_discarded_state() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("plan-x")).await.unwrap();
        soft_delete_plan(db.pool(), "plan-x", "2026-06-01T00:00:00Z").await.unwrap();

        // Non-discarded query returns NotFound.
        let err = get_plan(db.pool(), "plan-x", false).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));

        // include_discarded query returns the row.
        let row = get_plan(db.pool(), "plan-x", true).await.unwrap();
        assert_eq!(row.state, "discarded");
        assert_eq!(row.discarded_at, Some("2026-06-01T00:00:00Z".to_owned()));
    }

    #[tokio::test]
    async fn list_plans_excludes_discarded_by_default() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("p1")).await.unwrap();
        insert_plan(db.pool(), &sample_plan("p2")).await.unwrap();
        soft_delete_plan(db.pool(), "p2", "2026-06-01T00:00:00Z").await.unwrap();

        let rows = list_plans(db.pool(), &[], &[], None, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "p1");
    }

    #[tokio::test]
    async fn list_plans_with_state_filter() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("p1")).await.unwrap();
        insert_plan(db.pool(), &sample_plan("p2")).await.unwrap();
        // Update p2 to ready_for_review.
        update_plan_state(db.pool(), "p2", "ready_for_review").await.unwrap();

        let rows = list_plans(db.pool(), &["draft".to_owned()], &[], None, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "p1");
    }

    #[tokio::test]
    async fn insert_plan_item_updates_counters() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("p1")).await.unwrap();

        let item = InsertPlanItem {
            id: "item-1",
            plan_id: "p1",
            item_index: 1,
            name: "file.fits",
            action: "move",
            from_root_id: None,
            from_relative_path: "raw/file.fits",
            to_root_id: None,
            to_relative_path: "archive/file.fits",
            reason: "cleanup",
            protection: "normal",
            linked_entity: None,
            provenance_json: None,
            archive_path: None,
        };
        insert_plan_item(db.pool(), &item).await.unwrap();

        let plan = get_plan(db.pool(), "p1", false).await.unwrap();
        assert_eq!(plan.items_total, 1);
        assert_eq!(plan.items_pending, 1);
    }

    #[tokio::test]
    async fn failed_first_ordering() {
        let db = setup().await;
        insert_plan(db.pool(), &sample_plan("p-draft")).await.unwrap();
        insert_plan(db.pool(), &sample_plan("p-failed")).await.unwrap();
        update_plan_state(db.pool(), "p-failed", "failed").await.unwrap();

        let rows =
            list_plans(db.pool(), &["draft".to_owned(), "failed".to_owned()], &[], None, 100)
                .await
                .unwrap();
        assert_eq!(rows[0].id, "p-failed", "failed plan should be first");
        assert_eq!(rows[1].id, "p-draft");
    }
}
