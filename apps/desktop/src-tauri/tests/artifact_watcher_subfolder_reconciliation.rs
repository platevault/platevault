// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend integration test for #780 (release-blocker): the on-attach
//! reconciliation pass (`run_attach_reconciliation`, private to `watcher.rs`)
//! was non-recursive while the live `notify` watcher is recursive
//! (`fs_inventory::artifact_watcher`, `RecursiveMode::Recursive`) — so a real
//! project's `output/` subfolder was invisible on every reopen: existing
//! subfolder artifacts got wrongly marked `missing`, and new files written to
//! a subfolder while detached were never picked up.
//!
//! Companion to `artifact_watcher_missing_reconciliation.rs` (same public
//! entry point, top-level-only repro). This test nests both files one level
//! deep under `output/` to cover the exact spec-012 Touch & validate repro.

use std::path::PathBuf;

use audit::bus::EventBus;
use audit::event_bus::{EventEnvelope, TOPIC_ARTIFACT_DETECTED, TOPIC_ARTIFACT_MISSING};
use persistence_db::Database;

use desktop_shell::watcher::{
    attach_project_watcher, detach_project_watcher, new_artifact_watcher_registry,
};

async fn insert_projects_row(pool: &sqlx::SqlitePool, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Watcher Subfolder-Reconciliation Project', 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert projects row");
    id
}

/// Wait for a specific topic on the bus (draining others), up to `deadline`.
async fn wait_for_topic(
    rx: &mut tokio::sync::broadcast::Receiver<EventEnvelope<serde_json::Value>>,
    topic: &str,
    deadline: tokio::time::Instant,
) -> Option<EventEnvelope<serde_json::Value>> {
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(env)) if env.topic == topic => return Some(env),
            Ok(Ok(_)) => {}
            Ok(Err(_)) | Err(_) => return None,
        }
    }
}

#[tokio::test]
async fn subfolder_artifact_survives_reopen_and_new_subfolder_file_is_detected() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let project_root: PathBuf = dir.path().canonicalize().expect("canonicalize tempdir");
    let output_dir = project_root.join("output");
    std::fs::create_dir_all(&output_dir).expect("create output subfolder");
    let project_id = insert_projects_row(&pool, &project_root.to_string_lossy()).await;

    // A subfolder file already on disk before the first attach — the
    // on-attach reconciliation pass must find it despite it being nested
    // under output/, not just the project root's top level.
    let existing_file = output_dir.join("J5_integration_master.xisf");
    std::fs::write(&existing_file, b"not-a-real-xisf-file").expect("write existing artifact");

    let registry = new_artifact_watcher_registry();

    let mut rx_first = bus.subscribe();
    attach_project_watcher(&pool, &bus, &registry, &project_id)
        .await
        .expect("first attach_project_watcher");
    let first_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let detected_env = wait_for_topic(&mut rx_first, TOPIC_ARTIFACT_DETECTED, first_deadline)
        .await
        .expect("artifact.detected must fire for the existing subfolder file");
    let artifact_id =
        detected_env.payload["artifactId"].as_str().expect("artifactId is a string").to_owned();

    // Detach (project closed), drop a SECOND file into the same subfolder
    // while detached, then re-attach (project reopened).
    detach_project_watcher(&registry, &project_id).await;
    let new_file = output_dir.join("J5_final_closed.fits");
    std::fs::write(&new_file, b"not-a-real-fits-file").expect("write new artifact while detached");

    let mut rx_second = bus.subscribe();
    attach_project_watcher(&pool, &bus, &registry, &project_id)
        .await
        .expect("second attach_project_watcher (reopen)");

    // The new subfolder file must be detected on reopen.
    let second_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let redetected_env = wait_for_topic(&mut rx_second, TOPIC_ARTIFACT_DETECTED, second_deadline)
        .await
        .expect("artifact.detected must fire for the new subfolder file on reopen");
    assert_ne!(
        redetected_env.payload["artifactId"].as_str(),
        Some(artifact_id.as_str()),
        "the newly-detected artifact must be the new file, not a re-detection of the first"
    );

    // The FIRST (still-present) subfolder artifact must NOT have been marked
    // missing by the reconcile pass — assert no artifact.missing fired for it
    // and its DB row is still `present`.
    let missed_deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(500);
    let spurious_missing =
        wait_for_topic(&mut rx_second, TOPIC_ARTIFACT_MISSING, missed_deadline).await;
    assert!(
        spurious_missing.is_none(),
        "a still-present subfolder artifact must not be marked missing on reopen"
    );
    let row = sqlx::query_as::<_, (String,)>("SELECT state FROM processing_artifacts WHERE id = ?")
        .bind(&artifact_id)
        .fetch_one(&pool)
        .await
        .expect("query artifact state");
    assert_eq!(row.0, "present", "existing subfolder artifact must stay 'present' across reopen");
}
