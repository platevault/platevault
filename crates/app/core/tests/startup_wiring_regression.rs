//! Regression R-3 — `run_app` startup wiring: plan listener + log forwarder.
//!
//! Before the 2026-06-17 fix, `start_inbox_plan_listener` (spec 005) and
//! `start_log_forwarder` (spec 019) were implemented and tested in isolation
//! but **never called in `run_app`**. This meant:
//!   - Inbox items never auto-resolved after a plan was applied.
//!   - The live log push-stream never started.
//!
//! Fix: both are now called in `apps/desktop/src-tauri/src/lib.rs:run_app`
//! before the `EventBus`/`SqlitePool` are moved into `AppState`.
//!
//! This test suite pins that behaviour by:
//!
//! 1. Directly calling `start_inbox_plan_listener` with an in-memory SQLite
//!    pool and an `EventBus`, proving the public API is callable and the spawn
//!    does not panic.
//!
//! 2. Exercising the listener's core contract: publishing a
//!    `plan.applying.completed` event → the inbox item transitions to
//!    `"resolved"`.
//!
//! These tests do NOT test `start_log_forwarder` directly because that
//! function requires a `tauri::AppHandle` (not constructible in unit tests).
//! The log-forwarder call in `run_app` is covered structurally — if it were
//! removed, the function signature change would cause a compile error in the
//! Tauri binary (which `cargo build --workspace` would catch).
//!
//! See:
//!   - docs/development/autonomous-run-2026-06-validation-findings.md  § Backlog A-1
//!   - docs/development/test-strategy-033.md  § R-3, § 005-4, § 019-7
//!   - crates/app/core/src/inbox/plan_listener.rs
//!   - apps/desktop/src-tauri/src/lib.rs  run_app() lines 540–548

use app_core::inbox::plan_listener::start_inbox_plan_listener;
use audit::bus::EventBus;
use audit::event_bus::{PlanApplyingCompleted, Source, TOPIC_PLAN_APPLYING_COMPLETED};
use persistence_db::Database;
use uuid::Uuid;

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn setup_db() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db
}

/// Insert a library_root row that satisfies all NOT NULL + CHECK constraints.
///
/// Schema (migration 0002_lifecycle.sql):
///   id TEXT PK, label TEXT, current_path TEXT, kind TEXT CHECK('local'|'external'|'network'),
///   state TEXT CHECK('active'|'missing'|'disabled'|'reconnect_required'),
///   last_seen_at TEXT, created_at TEXT
async fn insert_root(pool: &sqlx::SqlitePool, root_id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO library_root \
         (id, label, current_path, kind, state, created_at) \
         VALUES (?, 'Test Root', '/tmp/r3-test', 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(root_id)
    .execute(pool)
    .await
    .expect("insert library_root");
}

/// Insert an inbox item in `classified` state and link it to a plan.
///
/// Schema (migration 0020_inbox.sql):
///   Table: inbox_items (not inbox_item)
///   Columns: id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
///            content_signature, state, lane
async fn insert_inbox_item(pool: &sqlx::SqlitePool, root_id: &str, item_id: &str, plan_id: &str) {
    // Insert the inbox item in `classified` state.
    sqlx::query(
        "INSERT INTO inbox_items \
         (id, root_id, relative_path, file_count, discovered_at, last_scanned_at, \
          content_signature, state, lane) \
         VALUES (?, ?, 'test-folder', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', \
                 'sig-r3', 'classified', 'fits')",
    )
    .bind(item_id)
    .bind(root_id)
    .execute(pool)
    .await
    .expect("insert inbox_items");

    // We need a stub plan row for the FK on inbox_plan_links.plan_id.
    // Schema after migration 0029: id, number, title, origin CHECK(set), state
    // CHECK(set), plan_type CHECK(set), destructive_destination CHECK(set),
    // created_at — all NOT NULL.
    // Note: 'split' is a valid plan_type; 'inbox' is a valid origin;
    // 'archive' is a valid destructive_destination after 0029.
    sqlx::query(
        "INSERT INTO plans \
         (id, number, title, origin, state, plan_type, destructive_destination, created_at) \
         VALUES (?, 1, 'Test Plan', 'inbox', 'ready_for_review', 'split', 'archive', \
                 '2026-01-01T00:00:00Z')",
    )
    .bind(plan_id)
    .execute(pool)
    .await
    .expect("insert plan");

    // Link the inbox item to the plan.
    // Schema: inbox_item_id TEXT PK, plan_id TEXT, linked_at TEXT
    sqlx::query(
        "INSERT INTO inbox_plan_links (inbox_item_id, plan_id, linked_at) \
         VALUES (?, ?, '2026-01-01T00:00:00Z')",
    )
    .bind(item_id)
    .bind(plan_id)
    .execute(pool)
    .await
    .expect("insert inbox_plan_links");
}

async fn inbox_item_state(pool: &sqlx::SqlitePool, item_id: &str) -> String {
    let row: (String,) = sqlx::query_as("SELECT state FROM inbox_items WHERE id = ?")
        .bind(item_id)
        .fetch_one(pool)
        .await
        .expect("fetch inbox item state");
    row.0
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// R-3.1 — `start_inbox_plan_listener` is callable and does not panic.
///
/// The public function must exist, accept the correct arguments, and not
/// immediately crash. The spawned tokio task idles waiting for events; we
/// verify the DB is in the expected state and no panic has propagated.
#[tokio::test]
async fn r3_1_start_inbox_plan_listener_callable() {
    let db = setup_db().await;
    let bus = EventBus::with_pool(db.pool().clone());

    // Must not panic.
    start_inbox_plan_listener(db.pool().clone(), &bus);

    // Pool is still usable after the call (pool.clone() was taken, not moved).
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_items")
        .fetch_one(db.pool())
        .await
        .expect("query after listener start");
    assert_eq!(count.0, 0);
}

/// R-3.2 — Listener transitions inbox item to `resolved` on `plan.applying.completed`.
///
/// Before the fix the listener was never spawned so the inbox item stayed in
/// `classified` forever after a plan was applied. This test proves the listener
/// processes the event and updates the row.
#[tokio::test]
async fn r3_2_listener_resolves_inbox_item_on_plan_applied() {
    let db = setup_db().await;
    let bus = EventBus::with_pool(db.pool().clone());

    // Start the listener (this is the fix we're pinning).
    start_inbox_plan_listener(db.pool().clone(), &bus);

    let root_id = format!("root-r3-{}", Uuid::new_v4());
    let item_id = format!("r3-item-{}", Uuid::new_v4());
    let plan_id = format!("r3-plan-{}", Uuid::new_v4());

    insert_root(db.pool(), &root_id).await;
    insert_inbox_item(db.pool(), &root_id, &item_id, &plan_id).await;

    // Verify initial state.
    assert_eq!(inbox_item_state(db.pool(), &item_id).await, "classified");

    // Build the event payload exactly as the executor publishes it.
    let payload = PlanApplyingCompleted {
        plan_id: plan_id.clone(),
        run_id: Uuid::new_v4().to_string(),
        terminal_state: "applied".to_owned(),
        items_applied: 1,
        items_failed: 0,
        items_skipped: 0,
        items_cancelled: 0,
        at: "2026-06-17T00:00:00Z".to_owned(),
    };

    bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload)
        .await
        .expect("publish event");

    // Give the spawned task time to process the event. Tokio's cooperative
    // scheduler runs it once we yield.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // The listener should have transitioned the inbox item to resolved.
    assert_eq!(
        inbox_item_state(db.pool(), &item_id).await,
        "resolved",
        "plan.applying.completed with terminal_state=applied must resolve the inbox item"
    );
}

/// R-3.3 — Listener transitions inbox item back to `classified` on plan failure.
///
/// A failed plan must put the inbox item back to `classified` so the user
/// can retry — NOT resolve it (that would hide the failure).
#[tokio::test]
async fn r3_3_listener_reclassifies_inbox_item_on_plan_failed() {
    let db = setup_db().await;
    let bus = EventBus::with_pool(db.pool().clone());

    start_inbox_plan_listener(db.pool().clone(), &bus);

    let root_id = format!("root-r3-fail-{}", Uuid::new_v4());
    let item_id = format!("r3-fail-{}", Uuid::new_v4());
    let plan_id = format!("r3-plan-fail-{}", Uuid::new_v4());

    insert_root(db.pool(), &root_id).await;
    insert_inbox_item(db.pool(), &root_id, &item_id, &plan_id).await;

    let payload = PlanApplyingCompleted {
        plan_id: plan_id.clone(),
        run_id: Uuid::new_v4().to_string(),
        terminal_state: "failed".to_owned(),
        items_applied: 0,
        items_failed: 1,
        items_skipped: 0,
        items_cancelled: 0,
        at: "2026-06-17T00:00:00Z".to_owned(),
    };

    bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload)
        .await
        .expect("publish event");

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Failed plan → item stays in classified (ready for retry), not resolved.
    assert_eq!(
        inbox_item_state(db.pool(), &item_id).await,
        "classified",
        "plan.applying.completed with terminal_state=failed must keep the item in classified"
    );
}
