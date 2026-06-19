#![allow(clippy::doc_markdown)]
//! Shared real-backend integration-test harness — feature 037 (T005).
//!
//! Real SQLite + real migrations + a wired `SqliteLifecycleRepository` and
//! `EventBus`, mirroring the established pattern in `transition_apply.rs`.
//! Layer-1 tests use this instead of re-declaring `setup()` per file.
#![allow(dead_code)]

use audit::bus::EventBus;
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use persistence_db::Database;

/// Provision an isolated in-memory SQLite DB with all migrations applied and a
/// repository/event-bus wired to it. Real backend, no mocks.
pub async fn setup() -> (Database, SqliteLifecycleRepository, EventBus) {
    let db = Database::in_memory().await.expect("in-memory db");
    db.migrate().await.expect("migrations");
    let bus = EventBus::with_pool(db.pool().clone());
    let repo = SqliteLifecycleRepository::new(db.pool().clone(), bus.clone());
    (db, repo, bus)
}

/// Seed a minimal `target` row.
pub async fn insert_target(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO target (id, primary_designation, created_at) \
         VALUES (?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("T-{id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Seed a minimal `project` row in a given lifecycle state.
pub async fn insert_project(pool: &sqlx::SqlitePool, id: &str, _target: &str, state: &str) {
    // Since migration 0036, the canonical lifecycle is `projects.lifecycle`.
    // The legacy `project.state` column no longer exists; seed into `projects`
    // so that `transition_use_case` (which reads/writes `projects.lifecycle`)
    // can find and transition this row.
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, 'P', 'PixInsight', ?, '/tmp/p', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
}
