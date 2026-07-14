#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration tests for the sessions coverage area — feature 037 (T???).
//!
//! Covers:
//! 1. `sessions::merge_sessions` / `sessions::split_session` — stub error
//!    contracts verified against the real in-memory pool.
//! 2. `list_sessions` / `get_session` — real DB round-trips.
//!
//! Spec 041 FR-051 (T076, Phase 13): the former `inventory::review_session`
//! scenarios (session-not-found, same-state noop, discovered → candidate)
//! were removed along with the review-session use case and the
//! `acquisition_session.state` column it mutated. Sessions are now derived,
//! already-confirmed inventory.
//!
//! Uses the shared harness in `tests/support/mod.rs`:
//!   `setup()` → `(Database, SqliteLifecycleRepository, EventBus)`
//! and raw-SQL seed helpers modelled after `transition_apply.rs`.

mod support;

// ── Seed helpers ─────────────────────────────────────────────────────────────

/// Insert a minimal `acquisition_session` row.
///
/// Schema (migration 0050_session_lifecycle_drop.sql):
///   id TEXT PK, session_key TEXT, frame_ids TEXT (JSON), created_at TEXT
async fn insert_acquisition_session(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at) \
         VALUES (?, 'KEY', '[]', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("insert acquisition_session");
}

// ── 1. sessions stub: merge and split return not-implemented errors ───────────

#[tokio::test]
async fn merge_and_split_stubs_return_not_implemented_errors() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    // split_session stub
    let split_result = app_core::sessions::split_session(pool, "ses-001", "filter").await;
    assert!(split_result.is_err(), "split_session must return Err");
    assert!(
        split_result.unwrap_err().contains("not yet implemented"),
        "error message must mention 'not yet implemented'"
    );

    // merge_sessions stub
    let ids = vec!["ses-001".to_owned(), "ses-002".to_owned()];
    let merge_result = app_core::sessions::merge_sessions(pool, &ids).await;
    assert!(merge_result.is_err(), "merge_sessions must return Err");
    assert!(
        merge_result.unwrap_err().contains("not yet implemented"),
        "error message must mention 'not yet implemented'"
    );
}

// ── 2. list_sessions: returns real rows, empty on fresh DB ───────────────────

#[tokio::test]
async fn list_sessions_returns_empty_on_fresh_db() {
    let (db, _repo, _bus) = support::setup().await;
    let res = app_core::sessions::list_sessions(db.pool()).await;
    assert!(res.is_ok(), "list_sessions failed: {res:?}");
    assert!(res.unwrap().is_empty(), "fresh DB must have no sessions -- not fixtures");
}

#[tokio::test]
async fn list_sessions_reads_back_seeded_rows() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    insert_acquisition_session(pool, "ses-t1").await;
    insert_acquisition_session(pool, "ses-t2").await;

    let res = app_core::sessions::list_sessions(pool).await;
    assert!(res.is_ok(), "list_sessions failed: {res:?}");
    let sessions = res.unwrap();
    assert_eq!(sessions.len(), 2, "must return exactly 2 seeded sessions");

    // Both IDs must be present (order is by created_at DESC; both same timestamp
    // so order may vary -- just check presence).
    let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains(&"ses-t1"), "ses-t1 must be in the list");
    assert!(ids.contains(&"ses-t2"), "ses-t2 must be in the list");
}

// ── 3. get_session: returns detail or not_found ───────────────────────────────

#[tokio::test]
async fn get_session_returns_not_found_for_missing_id() {
    let (db, _repo, _bus) = support::setup().await;
    let res = app_core::sessions::get_session(db.pool(), "nonexistent-id").await;
    assert!(res.is_err(), "get_session must return Err for unknown id");
    assert!(res.unwrap_err().contains("session.not_found"), "error must contain session.not_found");
}

#[tokio::test]
async fn get_session_returns_detail_for_seeded_row() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    insert_acquisition_session(pool, "ses-t4").await;

    let res = app_core::sessions::get_session(pool, "ses-t4").await;
    assert!(res.is_ok(), "get_session failed: {res:?}");
    let detail = res.unwrap();
    assert_eq!(detail.id, "ses-t4", "returned id must match seeded id");

    // calibration_matches and history are empty for a minimal seed row.
    assert!(detail.calibration_matches.is_empty(), "no calibration matches on fresh seed");
    assert!(detail.history.is_empty(), "no history on fresh seed");
}

// ── 7. spec 048 US1/T008: honest frame_count/total_size_bytes ───────────────

/// Insert a `library_root` + `file_record` row with a given size/state.
async fn insert_file_record(
    pool: &sqlx::SqlitePool,
    id: &str,
    root_id: &str,
    size_bytes: i64,
    state: &str,
) {
    sqlx::query(
        "INSERT OR IGNORE INTO library_root (id, label, current_path, kind, state, created_at)
         VALUES (?, ?, '/tmp', 'local', 'active', datetime('now'))",
    )
    .bind(root_id)
    .bind(root_id)
    .execute(pool)
    .await
    .expect("insert library_root");

    sqlx::query(
        "INSERT INTO file_record
            (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))",
    )
    .bind(id)
    .bind(root_id)
    .bind(format!("{id}.fits"))
    .bind(size_bytes)
    .bind(state)
    .execute(pool)
    .await
    .expect("insert file_record");
}

#[tokio::test]
async fn list_sessions_sums_real_frame_sizes() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    insert_file_record(pool, "frame-a", "root-a", 1000, "classified").await;
    insert_file_record(pool, "frame-b", "root-a", 2500, "classified").await;
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at)
         VALUES ('ses-sized', 'KEY', '[\"frame-a\",\"frame-b\"]', '2026-05-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .unwrap();

    let sessions = app_core::sessions::list_sessions(pool).await.unwrap();
    let ses = sessions.iter().find(|s| s.id == "ses-sized").expect("ses-sized must be in list");

    assert_eq!(ses.frame_count, 2, "both frames are present");
    assert_eq!(ses.total_size_bytes, 3500, "total must be the real sum, never 0");
}

#[tokio::test]
async fn get_session_excludes_missing_frames_from_active_totals() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    insert_file_record(pool, "frame-present", "root-b", 1000, "classified").await;
    insert_file_record(pool, "frame-gone", "root-b", 9000, "missing").await;
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at)
         VALUES ('ses-missing', 'KEY', '[\"frame-present\",\"frame-gone\"]', '2026-05-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .unwrap();

    let detail = app_core::sessions::get_session(pool, "ses-missing").await.unwrap();

    assert_eq!(detail.frame_count, 1, "a missing frame drops out of the active count (INV-5)");
    assert_eq!(detail.total_size_bytes, 1000, "a missing frame's bytes drop out of the total");
}
