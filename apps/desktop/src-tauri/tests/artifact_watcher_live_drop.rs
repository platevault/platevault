// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend integration test: a file dropped into a project's *live*
//! watched output folder (after `artifact_watcher_attach`, not the on-attach
//! reconciliation pass) emits `artifact.detected` AND `artifact.classified`
//! with contract-valid payloads (spec 033 T025, FR-009).
//!
//! This closes a genuine coverage gap found while auditing spec 037's
//! `crates/e2e-tests/tests/journeys.rs::cleanup_plan_review`: that Layer-2
//! journey writes its fixture file *before* calling `artifact_watcher_attach`,
//! so it only proves the attach-time reconciliation path
//! (`run_attach_reconciliation`'s `report.new_files` loop). The live
//! `notify`-driven `forward_task` loop in `watcher.rs::attach_project_watcher`
//! (fires on real fs Create/Modify events for an already-attached watcher)
//! had unit coverage of its two halves in isolation
//! (`fs_inventory::artifact_watcher::file_create_fires_event` for the raw fs
//! event, `app_lifecycle::artifact::detect_emits_artifact_detected_and_artifact_classified`
//! for the event-bus payloads) but no test exercising them wired together —
//! real `SQLite` + real `EventBus` + real OS watcher + a file created strictly
//! after attach.

use std::path::PathBuf;

use audit::bus::EventBus;
use audit::event_bus::{TOPIC_ARTIFACT_CLASSIFIED, TOPIC_ARTIFACT_DETECTED};
use persistence_db::Database;

use desktop_shell::watcher::{attach_project_watcher, new_artifact_watcher_registry};

/// Insert a minimal `projects` row whose `path` is a real directory the
/// artifact watcher can attach to.
async fn insert_projects_row(pool: &sqlx::SqlitePool, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Watcher Live-Drop Project', 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert projects row");
    id
}

#[tokio::test]
async fn live_file_drop_after_attach_emits_detected_and_classified() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    // Canonicalize so emitted event paths match `file_path` on macOS
    // (`/private/var/...` vs `/var/...`), mirroring
    // `fs_inventory::artifact_watcher::tests::file_create_fires_event`.
    let dir = tempfile::tempdir().expect("tempdir");
    let project_root: PathBuf = dir.path().canonicalize().expect("canonicalize tempdir");
    let project_id = insert_projects_row(&pool, &project_root.to_string_lossy()).await;

    // Subscribe before attach: the on-attach reconciliation pass runs over an
    // empty directory here (no files yet), so it emits nothing, but
    // subscribing early avoids any race with the live watcher's startup.
    let mut rx = bus.subscribe();

    let registry = new_artifact_watcher_registry();
    attach_project_watcher(&pool, &bus, &registry, &project_id)
        .await
        .expect("attach_project_watcher");

    // Drop a real file into the watched root strictly AFTER attach — this
    // exercises the live `notify` watcher's forward_task, not the
    // reconciliation pass.
    let file_path = project_root.join("live_drop_integration_M31_Ha.xisf");
    std::fs::write(&file_path, b"not-a-real-xisf-file").expect("write artifact file");

    let mut detected = false;
    let mut classified = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while !(detected && classified) {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(env)) if env.topic == TOPIC_ARTIFACT_DETECTED => {
                detected = true;
                assert!(
                    env.payload.get("artifactId").is_some(),
                    "artifact.detected payload missing artifactId: {:?}",
                    env.payload
                );
                assert_eq!(env.payload["projectId"].as_str(), Some(project_id.as_str()));
            }
            Ok(Ok(env)) if env.topic == TOPIC_ARTIFACT_CLASSIFIED => {
                classified = true;
                assert!(
                    env.payload.get("classification").is_some(),
                    "artifact.classified payload missing classification: {:?}",
                    env.payload
                );
                assert!(
                    env.payload.get("confidence").is_some(),
                    "artifact.classified payload missing confidence: {:?}",
                    env.payload
                );
                assert_eq!(env.payload["projectId"].as_str(), Some(project_id.as_str()));
            }
            Ok(Ok(_)) => {} // other topics on the shared bus, keep draining
            Ok(Err(_)) | Err(_) => break,
        }
    }

    assert!(detected, "artifact.detected must be emitted by the live watcher on file create");
    assert!(
        classified,
        "artifact.classified must be emitted by the live watcher on file create (FR-009)"
    );
}
