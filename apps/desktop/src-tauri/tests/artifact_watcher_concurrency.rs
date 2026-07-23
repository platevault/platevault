// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for `attach_project_watcher` concurrency fixes (audit kyo7.1):
//!
//! 1. `detach_during_attach`: `detach_project_watcher` called while attach is
//!    reconciling (simulated by sequencing a detach call between the idempotency
//!    check and the final insert) leaves no live entry in the registry.
//!
//! 2. `concurrent_racer_loses`: two `attach_project_watcher` calls for the same
//!    project interleave; exactly one live entry survives in the registry.
//!
//! Both tests use an in-memory `SQLite` database and a real `tempdir` project
//! root so the attach path's DB and filesystem work executes normally.

use audit::bus::EventBus;
use persistence_db::Database;

use desktop_shell::watcher::{
    attach_project_watcher, detach_project_watcher, new_artifact_watcher_registry,
};

async fn insert_projects_row(pool: &sqlx::SqlitePool, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Concurrency Test Project', 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert projects row");
    id
}

/// `detach_project_watcher` called between the attach idempotency check and the
/// final insert must leave no live entry in the registry.
///
/// Simulated sequence:
///   1. `attach()` — passes idempotency check, releases lock, begins reconcile
///   2. `detach()` — finds no entry, writes tombstone
///   3. `attach()` — final insert: sees tombstone, discards watcher
#[tokio::test]
async fn detach_during_attach_leaves_no_zombie() {
    let db = Database::in_memory().await.expect("in-memory db");
    db.migrate().await.expect("migrate");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let project_root = dir.path().canonicalize().expect("canonicalize");
    let project_id = insert_projects_row(&pool, &project_root.to_string_lossy()).await;

    let registry = new_artifact_watcher_registry();

    // Step 1: attach completes fully (no race here — establishes baseline).
    attach_project_watcher(&pool, &bus, &registry, &project_id).await.expect("first attach");

    // Verify it's live.
    {
        let reg = registry.lock().await;
        assert!(reg.entries.contains_key(&project_id), "entry must be present after attach");
    }

    // Step 2: detach removes the live entry.
    detach_project_watcher(&registry, &project_id).await;

    // Step 3: simulate the detach-during-attach race by calling detach once
    // more (no live entry) to plant a tombstone, then attaching.
    detach_project_watcher(&registry, &project_id).await;
    {
        let reg = registry.lock().await;
        assert!(
            reg.detach_requested.contains(&project_id),
            "tombstone must be present after detach with no live entry"
        );
    }

    // attach() sees the tombstone at final-insert time and discards the watcher.
    attach_project_watcher(&pool, &bus, &registry, &project_id)
        .await
        .expect("attach after tombstone must return Ok");

    let reg = registry.lock().await;
    assert!(
        !reg.entries.contains_key(&project_id),
        "attach must not insert a zombie entry when a detach tombstone was present"
    );
    assert!(
        !reg.detach_requested.contains(&project_id),
        "attach must consume (remove) the tombstone"
    );
}

/// Two concurrent `attach_project_watcher` calls for the same project must
/// leave exactly one live entry.
#[tokio::test]
async fn concurrent_attach_racer_loses() {
    let db = Database::in_memory().await.expect("in-memory db");
    db.migrate().await.expect("migrate");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let project_root = dir.path().canonicalize().expect("canonicalize");
    let project_id = insert_projects_row(&pool, &project_root.to_string_lossy()).await;

    let registry = new_artifact_watcher_registry();

    // Run two attach calls concurrently on the same project_id.
    let (r1, r2) = tokio::join!(
        attach_project_watcher(&pool, &bus, &registry, &project_id),
        attach_project_watcher(&pool, &bus, &registry, &project_id),
    );

    assert!(r1.is_ok(), "first attach must succeed: {r1:?}");
    assert!(r2.is_ok(), "second (losing racer) attach must also return Ok: {r2:?}");

    let reg = registry.lock().await;
    let entry_count = usize::from(reg.entries.contains_key(&project_id));
    assert_eq!(entry_count, 1, "exactly one live entry must survive concurrent attaches");
}
