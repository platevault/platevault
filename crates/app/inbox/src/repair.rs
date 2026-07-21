// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Periodic repair sweep for inbox items stuck in `plan_open` (spec 005
//! T-PlanRepair, Ref: R-PlanOpen).
//!
//! [`crate::plan_listener`] is the primary path: it reacts to
//! `plan.applying.completed` / `plan.discarded` on the event bus. This module
//! is the safety net for the cases the bus cannot cover — the app was not
//! running when the plan closed, or the broadcast receiver lagged and dropped
//! the event. It re-derives the same transition from committed database state
//! instead of from an event.
#![allow(clippy::doc_markdown)]

use persistence_db::repositories::inbox as inbox_repo;
use sqlx::SqlitePool;

/// Transition every inbox item whose linked plan has reached a terminal state,
/// deleting the now-stale `inbox_plan_links` row.
///
/// Idempotent: the link row is the work queue, and each successful transition
/// removes its own row, so a second run over unchanged data is a no-op.
///
/// A failing orphan is logged and skipped rather than aborting the sweep — one
/// unrepairable row must not strand the rest.
///
/// # Errors
/// Returns the error string if the orphan query itself fails.
pub async fn run_repair(pool: &SqlitePool) -> Result<usize, String> {
    let orphans = inbox_repo::find_orphaned_plan_links(pool)
        .await
        .map_err(|e| format!("find_orphaned_plan_links: {e}"))?;

    let mut repaired = 0;
    for (inbox_item_id, plan_id, plan_state) in orphans {
        // Same mapping as the listener: only `applied` resolves; every other
        // terminal state goes back to unconfirmed (derived from the row's own
        // frame_type, spec 058 SC-003).
        let new_state = if plan_state == "applied" { Some("resolved") } else { None };

        match crate::plan_listener::transition_via_plan_id(pool, &plan_id, new_state).await {
            Ok(()) => repaired += 1,
            Err(e) => tracing::warn!(
                %inbox_item_id,
                %plan_id,
                %plan_state,
                "inbox repair: transition failed: {e}"
            ),
        }
    }

    if repaired > 0 {
        tracing::info!(repaired, "inbox repair: swept orphaned plan links");
    }
    Ok(repaired)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::InsertInboxItem;
    use persistence_db::repositories::plans;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// Seed a `plan_open` inbox item linked to a plan left in `plan_state`.
    /// `frame_type = None` models the spec-058 SC-003 row that must fall back
    /// to `pending_classification` instead of `classified`.
    async fn seed(
        db: &Database,
        item_id: &str,
        plan_id: &str,
        plan_state: Option<&str>,
        frame_type: Option<&str>,
    ) {
        let pool = db.pool();
        inbox_repo::insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: item_id,
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        if let Some(ft) = frame_type {
            sqlx::query("UPDATE inbox_items SET frame_type = ? WHERE id = ?")
                .bind(ft)
                .bind(item_id)
                .execute(pool)
                .await
                .unwrap();
        }

        inbox_repo::update_inbox_item_state(pool, item_id, "plan_open").await.unwrap();

        plans::insert_plan(
            pool,
            &plans::InsertPlan {
                id: plan_id,
                title: "Test plan",
                origin: "inbox",
                origin_path: None,
                plan_type: "split",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();

        if let Some(state) = plan_state {
            plans::update_plan_state(pool, plan_id, state).await.unwrap();
        }

        inbox_repo::insert_plan_link(pool, item_id, plan_id).await.unwrap();
    }

    async fn state_of(db: &Database, item_id: &str) -> String {
        inbox_repo::get_inbox_item(db.pool(), item_id).await.unwrap().state
    }

    async fn link_exists(db: &Database, item_id: &str) -> bool {
        inbox_repo::get_plan_link(db.pool(), item_id).await.unwrap().is_some()
    }

    #[tokio::test]
    async fn applied_plan_repairs_item_to_resolved() {
        let db = test_db().await;
        seed(&db, "item-applied", "plan-applied", Some("applied"), Some("light")).await;

        assert_eq!(run_repair(db.pool()).await.unwrap(), 1);

        assert_eq!(state_of(&db, "item-applied").await, "resolved");
        assert!(!link_exists(&db, "item-applied").await);
    }

    #[tokio::test]
    async fn non_applied_terminals_return_to_unconfirmed_and_drop_the_link() {
        let db = test_db().await;
        for terminal in ["partially_applied", "failed", "cancelled", "discarded"] {
            seed(
                &db,
                &format!("item-{terminal}"),
                &format!("plan-{terminal}"),
                Some(terminal),
                Some("light"),
            )
            .await;
        }

        assert_eq!(run_repair(db.pool()).await.unwrap(), 4);

        for terminal in ["partially_applied", "failed", "cancelled", "discarded"] {
            let item_id = format!("item-{terminal}");
            assert_eq!(state_of(&db, &item_id).await, "classified", "{terminal}");
            assert!(!link_exists(&db, &item_id).await, "{terminal}");
        }
    }

    #[tokio::test]
    async fn item_without_frame_type_returns_to_pending_classification() {
        let db = test_db().await;
        seed(&db, "item-noft", "plan-noft", Some("failed"), None).await;

        run_repair(db.pool()).await.unwrap();

        assert_eq!(state_of(&db, "item-noft").await, "pending_classification");
        assert!(!link_exists(&db, "item-noft").await);
    }

    #[tokio::test]
    async fn second_run_is_a_no_op() {
        let db = test_db().await;
        seed(&db, "item-idem", "plan-idem", Some("applied"), Some("light")).await;

        assert_eq!(run_repair(db.pool()).await.unwrap(), 1);
        assert_eq!(run_repair(db.pool()).await.unwrap(), 0);
        assert_eq!(state_of(&db, "item-idem").await, "resolved");
    }

    #[tokio::test]
    async fn open_plan_is_left_untouched() {
        let db = test_db().await;
        // No state update: `plans.state` keeps its `draft` default.
        seed(&db, "item-open", "plan-open", None, Some("light")).await;

        assert_eq!(run_repair(db.pool()).await.unwrap(), 0);

        assert_eq!(state_of(&db, "item-open").await, "plan_open");
        assert!(link_exists(&db, "item-open").await);
    }
}
