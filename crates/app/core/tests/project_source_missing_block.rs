// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration test for the `source_missing` project auto-block
//! (spec 009 US4, FR-020/FR-021).
//!
//! Real tempdir root, real `file_record` rows, real `project.source.add`, real
//! `app_core::frame_inventory::run_reconcile`. This file deliberately contains
//! no reference to the `project_health` block emitter: every pre-existing test
//! of the `source_missing` condition invoked that emitter directly, which is
//! how the condition shipped with zero production callers. Driving the
//! reconcile entry point is the only assertion that proves the trigger is
//! wired.

mod support;

use contracts_core::inventory_frame::{InventoryReconcileRunRequest, ReconcileReason};
use contracts_core::projects_v2::ProjectSourceAddRequest;

// ── Seed helpers ──────────────────────────────────────────────────────────────

async fn insert_root(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, ?, ?, 'local', 'active', datetime('now'))",
    )
    .bind(id)
    .bind(id)
    .bind(path)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert library_root failed: {e}"));
}

async fn insert_frame_record(pool: &sqlx::SqlitePool, id: &str, root_id: &str, rel: &str) {
    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES (?, ?, ?, 2048, 't0', 'classified', 't0', 't0')",
    )
    .bind(id)
    .bind(root_id)
    .bind(rel)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert file_record failed: {e}"));
}

async fn insert_acquisition_session(pool: &sqlx::SqlitePool, id: &str, frame_ids: &[&str]) {
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at) \
         VALUES (?, ?, ?, '2026-07-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("M31|Ha|2026-07-01|{id}"))
    .bind(serde_json::to_string(frame_ids).unwrap())
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert acquisition_session failed: {e}"));
}

async fn project_lifecycle(pool: &sqlx::SqlitePool, id: &str) -> (String, Option<String>) {
    sqlx::query_as("SELECT lifecycle, blocked_reason_kind FROM projects WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Count of `actor='system'` audit rows recording a `* → blocked` transition
/// for this project (FR-021).
async fn auto_block_audit_count(pool: &sqlx::SqlitePool, project_id: &str) -> i64 {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_type = 'project' AND entity_id = ? \
           AND to_state = 'blocked' AND actor = 'system'",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap();
    count
}

// ── Test ──────────────────────────────────────────────────────────────────────

/// A `ready` project whose linked session references a frame that disappears
/// from disk is transitioned to `blocked` with `blocked_reason_kind =
/// 'source_missing'` by the reconcile pass, with an audit row recording it.
/// A second reconcile writes no duplicate audit row.
#[tokio::test]
async fn missing_source_frame_blocks_project_via_reconcile() {
    let dir = tempfile::tempdir().unwrap();
    let kept = dir.path().join("light_001.fits");
    let doomed = dir.path().join("light_002.fits");
    std::fs::write(&kept, vec![0u8; 2048]).unwrap();
    std::fs::write(&doomed, vec![0u8; 2048]).unwrap();

    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    let root_id = "root-sm";
    let session_id = "sess-sm";
    let project_id = "proj-sm";

    insert_root(pool, root_id, dir.path().to_str().unwrap()).await;
    insert_frame_record(pool, "frame-kept", root_id, "light_001.fits").await;
    insert_frame_record(pool, "frame-doomed", root_id, "light_002.fits").await;
    insert_acquisition_session(pool, session_id, &["frame-kept", "frame-doomed"]).await;
    support::insert_project(pool, project_id, "target-sm", "setup_incomplete").await;

    app_core::projects::project_setup::add_source(
        pool,
        &bus,
        &ProjectSourceAddRequest {
            request_id: "req-1".to_owned(),
            project_id: project_id.to_owned(),
            inventory_session_id: session_id.to_owned(),
        },
    )
    .await
    .expect("add_source");

    let (lifecycle, _) = project_lifecycle(pool, project_id).await;
    assert_eq!(lifecycle, "ready", "add_source must auto-ready the project first");

    // Simulate an external delete, then run the production reconcile entry point.
    std::fs::remove_file(&doomed).unwrap();
    let req = InventoryReconcileRunRequest {
        root_id: root_id.to_owned(),
        reason: ReconcileReason::OnDemand,
    };
    let resp = app_core::frame_inventory::run_reconcile(pool, &bus, &req).await.unwrap();
    assert_eq!(resp.newly_missing, 1);

    let (lifecycle, reason_kind) = project_lifecycle(pool, project_id).await;
    assert_eq!(lifecycle, "blocked", "FR-020: a project with a missing source must auto-block");
    assert_eq!(reason_kind.as_deref(), Some("source_missing"));
    assert_eq!(
        auto_block_audit_count(pool, project_id).await,
        1,
        "FR-021: the auto-block transition must be recorded in the audit trail"
    );

    // A repeat reconcile inside the debounce window writes no second audit row.
    app_core::frame_inventory::run_reconcile(pool, &bus, &req).await.unwrap();
    assert_eq!(
        auto_block_audit_count(pool, project_id).await,
        1,
        "a repeat reconcile must not append a duplicate auto-transition audit row"
    );
}
