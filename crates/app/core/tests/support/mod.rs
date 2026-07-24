#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared real-backend integration-test harness — feature 037 (T005).
//!
//! Real SQLite + real migrations + a wired `SqliteLifecycleRepository` and
//! `EventBus`, mirroring the established pattern in `transition_apply.rs`.
//! Layer-1 tests use this instead of re-declaring `setup()` per file.
#![allow(dead_code)]

use std::future::Future;
use std::time::Duration;

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

/// Platform-absolute path of the project folder registered by
/// [`register_project_root`]. Tests submit project paths RELATIVE to this
/// root: a leading-slash path like `/library/...` is absolute on Unix but NOT
/// on Windows (no drive letter), so it would fall into the relative-anchoring
/// branch of `project_setup::create` and be rejected there. Registering a
/// project root and using relative request paths is portable.
#[cfg(windows)]
pub const TEST_PROJECT_ROOT: &str = "C:/library/projects-root";
#[cfg(not(windows))]
pub const TEST_PROJECT_ROOT: &str = "/library/projects-root";

/// Register a project-kind source so relative project request paths have an
/// anchor (mirrors the first-run wizard registering a project folder).
pub async fn register_project_root(pool: &sqlx::SqlitePool, path: &str) {
    sqlx::query(
        "INSERT INTO registered_sources \
         (id, kind, path, scan_depth, created_at, created_via, organization_state) \
         VALUES (?, 'project', ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run', 'organized')",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(path)
    .execute(pool)
    .await
    .unwrap();
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

// ── Observable-condition poll helpers ─────────────────────────────────────────
//
// These replace fixed `tokio::time::sleep` calls that were used to wait for
// background executor or EventBus listener tasks to finish. Fixed sleeps are
// fragile on loaded CI runners where Tokio scheduler latency can cause the
// background task to miss the window. Polling every 25 ms with a 2 s cap
// makes each test wait only as long as the work actually takes.

/// Poll `check` every 25 ms until it returns `Some(T)` or the 2-second
/// deadline expires (which panics with `deadline_msg`).
///
/// Use this for conditions other than plan-terminal state (e.g. a row count,
/// a file existing, an inbox-item state). For plan executor completion use
/// [`wait_plan_terminal`], which polls the same way but requires no closure.
pub async fn poll_until<F, Fut, T>(mut check: F, deadline_msg: &str) -> T
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(v) = check().await {
            return v;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "poll_until timed out after 2 s: {deadline_msg}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Wait for a plan's `state` column to leave `"applying"` (i.e. reach any
/// terminal state: `applied`, `partially_applied`, `failed`, `paused`,
/// `cancelled`). Polls every 25 ms, panics after 2 s.
///
/// Replaces fixed `sleep(300 ms)` / `sleep(200 ms)` waits that followed
/// `apply_plan()` or `resume_plan()` calls and were fragile under parallel
/// nextest runs on loaded CI runners.
pub async fn wait_plan_terminal(pool: &sqlx::SqlitePool, plan_id: &str) {
    poll_until(
        || async {
            let row: Option<(String,)> = sqlx::query_as("SELECT state FROM plans WHERE id = ?")
                .bind(plan_id)
                .fetch_optional(pool)
                .await
                .expect("poll plan state");
            match row {
                Some((s,)) if s != "applying" => Some(()),
                _ => None,
            }
        },
        &format!("plan {plan_id} never left 'applying' state"),
    )
    .await;
}
