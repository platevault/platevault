// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend integration test: a file that disappears while a project is
//! detached is discovered `missing` by the on-attach reconciliation pass
//! (spec 012 T005/T010, FR-009).
//!
//! Companion to `artifact_watcher_live_drop.rs` (which covers the live
//! `notify` watcher's create path). This covers the *reconciliation* path:
//! `run_attach_reconciliation` (private to `watcher.rs`) compares the known
//! `present` rows against a real `read_dir` and calls
//! `app_core::artifact::mark_missing` for any that vanished — reached here by
//! detaching then re-attaching (the only public entry point), not by calling
//! the private function directly.

use std::path::PathBuf;

use audit::bus::EventBus;
use audit::event_bus::{EventEnvelope, TOPIC_ARTIFACT_DETECTED, TOPIC_ARTIFACT_MISSING};
use persistence_core::Database;

use desktop_shell::watcher::{
    attach_project_watcher, detach_project_watcher, new_artifact_watcher_registry,
};

async fn insert_projects_row(pool: &sqlx::SqlitePool, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Watcher Missing-Reconciliation Project', 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
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
async fn deleted_file_is_marked_missing_on_reattach_reconciliation() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let project_root: PathBuf = dir.path().canonicalize().expect("canonicalize tempdir");
    let project_id = insert_projects_row(&pool, &project_root.to_string_lossy()).await;

    // A file already on disk BEFORE the first attach — the T005 on-attach
    // reconciliation pass discovers it as a new file (report.new_files), not
    // the live watcher.
    let file_path = project_root.join("missing_reconciliation_M42_L.xisf");
    std::fs::write(&file_path, b"not-a-real-xisf-file").expect("write artifact file");

    let registry = new_artifact_watcher_registry();

    let mut rx_detect = bus.subscribe();
    attach_project_watcher(&pool, &bus, &registry, &project_id)
        .await
        .expect("first attach_project_watcher");
    let detect_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let detected_env = wait_for_topic(&mut rx_detect, TOPIC_ARTIFACT_DETECTED, detect_deadline)
        .await
        .expect("artifact.detected must fire from the on-attach reconciliation pass");
    let artifact_id =
        detected_env.payload["artifactId"].as_str().expect("artifactId is a string").to_owned();

    // Detach (stops the live watcher), delete the file, then re-attach — this
    // is the only public path that re-runs `run_attach_reconciliation` and
    // therefore the only way to reach the `Gone` branch from outside the crate.
    detach_project_watcher(&registry, &project_id).await;
    std::fs::remove_file(&file_path).expect("delete artifact file");

    let mut rx_missing = bus.subscribe();
    attach_project_watcher(&pool, &bus, &registry, &project_id).await.expect(
        "second attach_project_watcher (triggers reconciliation over the now-missing file)",
    );

    let missing_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let missing_env = wait_for_topic(&mut rx_missing, TOPIC_ARTIFACT_MISSING, missing_deadline)
        .await
        .expect("artifact.missing must fire once reconciliation observes the file is gone");
    assert_eq!(missing_env.payload["artifactId"].as_str(), Some(artifact_id.as_str()));
    assert_eq!(missing_env.payload["projectId"].as_str(), Some(project_id.as_str()));

    let row = sqlx::query_as::<_, (String,)>("SELECT state FROM processing_artifacts WHERE id = ?")
        .bind(&artifact_id)
        .fetch_one(&pool)
        .await
        .expect("query artifact state");
    assert_eq!(
        row.0, "missing",
        "artifact row must be in the 'missing' state after reconciliation"
    );
}
