#![allow(clippy::doc_markdown)]
//! Real-backend integration test: the REAL production trigger for a completed
//! workflow run (`artifact::complete_run`) drives the REAL production
//! consumer (`project_manifests::spawn_workflow_run_subscriber`) end to end,
//! persisting a `workflow_run` manifest (spec 033 T024, FR-008).
//!
//! Closes a gap between two individually-tested halves:
//! - `crates/app/lifecycle/src/artifact.rs::complete_run_emits_workflow_run_completed`
//!   asserts `complete_run` fires the `workflow.run_completed` event, but
//!   never checks a manifest gets written.
//! - `crates/app/projects/src/project_manifests.rs::workflow_run_subscriber_generates_and_persists_manifest`
//!   asserts the subscriber writes a manifest, but manually publishes the
//!   `workflow.run_completed` JSON payload instead of driving it from a real
//!   completed `tool_launches` row via `complete_run`.
//!
//! This test wires the real trigger to the real consumer over a shared
//! `EventBus`/`SqlitePool`, matching how `apps/desktop/src-tauri/src/lib.rs`
//! wires them in `run_app` (`spawn_workflow_run_subscriber` at startup,
//! `complete_run` called wherever a tool-launch outcome resolves).

use app_core::artifact::complete_run;
use app_core::project_manifests::spawn_workflow_run_subscriber;
use audit::bus::EventBus;
use persistence_db::repositories::manifests::list_manifests_for_project;
use persistence_db::Database;

async fn insert_project_row(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Workflow-Run Manifest E2E Project', 'PixInsight', 'ready', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert projects row");
}

async fn insert_tool_launch_row(pool: &sqlx::SqlitePool, id: &str, project_id: &str) {
    sqlx::query(
        "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id) \
         VALUES (?, ?, 'pixinsight', '2026-06-01T08:00:00Z', 'spawned', 'aud-e2e-1')",
    )
    .bind(id)
    .bind(project_id)
    .execute(pool)
    .await
    .expect("insert tool_launches row");
}

#[tokio::test]
async fn real_tool_launch_completion_persists_a_workflow_run_manifest() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let project_id = "proj-workflow-run-e2e";
    let tool_launch_id = "tl-workflow-run-e2e";
    insert_project_row(&pool, project_id, &dir.path().to_string_lossy()).await;
    insert_tool_launch_row(&pool, tool_launch_id, project_id).await;

    // Spawn the REAL production consumer, exactly as `run_app` does at startup.
    let _handle = spawn_workflow_run_subscriber(pool.clone(), bus.clone());

    // Drive the REAL production trigger: a tool-launch outcome resolving to
    // completion (not a hand-crafted event payload).
    let updated = complete_run(&pool, &bus, project_id, "pixinsight", tool_launch_id)
        .await
        .expect("complete_run");
    assert!(updated, "complete_run should have updated the tool_launches row");

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let (rows, _) =
            list_manifests_for_project(&pool, project_id, None, 10).await.expect("list manifests");
        if !rows.is_empty() {
            assert_eq!(rows[0].reason, "workflow_run", "unexpected manifest reason: {rows:?}");
            let abs_path = dir.path().join(&rows[0].path);
            assert!(
                abs_path.exists(),
                "manifest file should exist on disk at {}",
                abs_path.display()
            );
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no workflow_run manifest persisted within 2s of a real complete_run() call"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
