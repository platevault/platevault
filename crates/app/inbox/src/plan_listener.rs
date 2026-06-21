//! Inbox plan-state listener (spec 005, T030).
//!
//! Subscribes to the audit event bus and transitions `InboxItem.state` when a
//! linked plan reaches a terminal state:
//!
//! - `plan.applying.completed` with `terminal_state = "applied"` →
//!   `InboxItem.state = "resolved"` + delete `inbox_plan_links` row.
//! - `plan.applying.completed` with any other terminal
//!   (`partially_applied`, `failed`, `cancelled`) →
//!   `InboxItem.state = "classified"` + delete `inbox_plan_links` row.
//! - `plan.discarded` →
//!   `InboxItem.state = "classified"` + delete `inbox_plan_links` row.
//!
//! The listener is started once at application startup via
//! [`start_inbox_plan_listener`] which spawns a detached `tokio::task`. It is
//! NOT the only safety mechanism — [`crate::inbox::repair::run_repair`]
//! provides a periodic background sweep for items whose plan closed while the
//! listener was not running (crash, restart, missed event).
//!
//! # Event bus limitations
//!
//! The tokio broadcast channel drops lagged receivers; if the app is under
//! heavy load and a `plan.applying.completed` event is dropped, the repair
//! sweep will catch it within 5 minutes. This is documented in the spec
//! (Ref: R-PlanOpen) as the expected degraded-mode behaviour.
#![allow(clippy::doc_markdown)]

use audit::bus::EventBus;
use audit::event_bus::{
    PlanApplyingCompleted, PlanDiscarded, TOPIC_PLAN_APPLYING_COMPLETED, TOPIC_PLAN_DISCARDED,
};
use persistence_db::repositories::inbox as inbox_repo;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

// ── Public entry point ────────────────────────────────────────────────────────

/// Spawn a detached background task that listens for plan terminal events and
/// updates the corresponding `InboxItem` state.
///
/// Call this once at application startup, after the `SqlitePool` is available.
pub fn start_inbox_plan_listener(pool: SqlitePool, bus: &EventBus) {
    let mut rx = bus.subscribe();
    tokio::spawn(async move {
        run_listener_loop(pool, &mut rx).await;
    });
}

// ── Listener loop ─────────────────────────────────────────────────────────────

async fn run_listener_loop(
    pool: SqlitePool,
    rx: &mut broadcast::Receiver<audit::event_bus::EventEnvelope<serde_json::Value>>,
) {
    loop {
        match rx.recv().await {
            Ok(envelope) => {
                if let Err(e) = handle_event(&pool, &envelope).await {
                    tracing::warn!("inbox plan_listener: error handling event: {e}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                // Missed n events. The repair sweep will pick up any orphaned
                // inbox items within the next 5-minute window.
                tracing::warn!(
                    "inbox plan_listener: lagged {n} events — repair sweep will reconcile"
                );
            }
            Err(broadcast::error::RecvError::Closed) => {
                // Event bus shut down — task can exit.
                tracing::info!("inbox plan_listener: event bus closed, stopping");
                break;
            }
        }
    }
}

// ── Event handler ─────────────────────────────────────────────────────────────

async fn handle_event(
    pool: &SqlitePool,
    envelope: &audit::event_bus::EventEnvelope<serde_json::Value>,
) -> Result<(), String> {
    match envelope.topic.as_str() {
        TOPIC_PLAN_APPLYING_COMPLETED => {
            if let Ok(payload) =
                serde_json::from_value::<PlanApplyingCompleted>(envelope.payload.clone())
            {
                handle_plan_completed(pool, &payload).await?;
            }
        }
        TOPIC_PLAN_DISCARDED => {
            if let Ok(payload) = serde_json::from_value::<PlanDiscarded>(envelope.payload.clone()) {
                handle_plan_discarded(pool, &payload.plan_id).await?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Called when a plan reaches a terminal apply state.
async fn handle_plan_completed(
    pool: &SqlitePool,
    payload: &PlanApplyingCompleted,
) -> Result<(), String> {
    let new_state = if payload.terminal_state == "applied" {
        "resolved"
    } else {
        // partially_applied, failed, cancelled → allow re-split
        "classified"
    };

    transition_via_plan_id(pool, &payload.plan_id, new_state).await
}

/// Called when a plan is discarded (any state → discarded).
async fn handle_plan_discarded(pool: &SqlitePool, plan_id: &str) -> Result<(), String> {
    transition_via_plan_id(pool, plan_id, "classified").await
}

/// Find the InboxItem linked to `plan_id`, transition it to `new_state`,
/// and delete the plan link row.
async fn transition_via_plan_id(
    pool: &SqlitePool,
    plan_id: &str,
    new_state: &str,
) -> Result<(), String> {
    // Find the inbox item linked to this plan.
    let link = inbox_repo::get_plan_link_by_plan_id(pool, plan_id)
        .await
        .map_err(|e| format!("get_plan_link_by_plan_id({plan_id}): {e}"))?;

    let Some(link) = link else {
        // No inbox item is linked to this plan — normal (non-inbox plans).
        return Ok(());
    };

    // Update inbox item state.
    inbox_repo::update_inbox_item_state(pool, &link.inbox_item_id, new_state)
        .await
        .map_err(|e| format!("update_inbox_item_state({}): {e}", link.inbox_item_id))?;

    // Delete the plan link so the item can accept a new plan in the future.
    inbox_repo::delete_plan_link(pool, &link.inbox_item_id)
        .await
        .map_err(|e| format!("delete_plan_link({}): {e}", link.inbox_item_id))?;

    tracing::info!(
        inbox_item_id = %link.inbox_item_id,
        plan_id,
        new_state,
        "inbox plan_listener: inbox item transitioned"
    );

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::bus::EventBus;
    use audit::event_bus::{PlanApplyingCompleted, Source};
    use persistence_db::repositories::inbox::InsertInboxItem;
    use persistence_db::repositories::plans;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn make_bus(db: &Database) -> EventBus {
        EventBus::with_pool(db.pool().clone())
    }

    async fn setup_item_with_plan(db: &Database, item_id: &str, plan_id: &str) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "test",
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &inbox_repo::UpsertClassification {
                inbox_item_id: item_id,
                result: "single_type",
                frame_type: Some("light"),
                content_signature: "sig",
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        inbox_repo::update_inbox_item_state(db.pool(), item_id, "plan_open").await.unwrap();

        let plan = plans::InsertPlan {
            id: plan_id,
            title: "Test plan",
            origin: "inbox",
            origin_path: None,
            plan_type: "split",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        };
        plans::insert_plan(db.pool(), &plan).await.unwrap();

        inbox_repo::insert_plan_link(db.pool(), item_id, plan_id).await.unwrap();
    }

    #[tokio::test]
    async fn applied_plan_transitions_to_resolved() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t1", "plan-t1").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = PlanApplyingCompleted {
            plan_id: "plan-t1".to_owned(),
            run_id: "run-1".to_owned(),
            terminal_state: "applied".to_owned(),
            items_applied: 1,
            items_failed: 0,
            items_skipped: 0,
            items_cancelled: 0,
            at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload).await.unwrap();

        // Give the background task time to process.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t1").await.unwrap();
        assert_eq!(item.state, "resolved");

        let link = inbox_repo::get_plan_link(db.pool(), "item-t1").await.unwrap();
        assert!(link.is_none(), "plan link should be deleted after resolution");
    }

    #[tokio::test]
    async fn failed_plan_transitions_back_to_classified() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t2", "plan-t2").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = PlanApplyingCompleted {
            plan_id: "plan-t2".to_owned(),
            run_id: "run-2".to_owned(),
            terminal_state: "failed".to_owned(),
            items_applied: 0,
            items_failed: 1,
            items_skipped: 0,
            items_cancelled: 0,
            at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t2").await.unwrap();
        assert_eq!(item.state, "classified");
    }

    #[tokio::test]
    async fn discarded_plan_transitions_to_classified() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t3", "plan-t3").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = audit::event_bus::PlanDiscarded {
            plan_id: "plan-t3".to_owned(),
            prior_state: "ready_for_review".to_owned(),
            discarded_at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_DISCARDED, Source::User, payload).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t3").await.unwrap();
        assert_eq!(item.state, "classified");
    }
}
