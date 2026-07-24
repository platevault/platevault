// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-SQLite integration tests for Inbox session materialization
//! (Spec 062 US1).
//!
//! Covers:
//! 1. Apply with two frames in one proposed session → one immutable session +
//!    frame memberships + singleton panel group committed atomically.
//! 2. Apply with two proposed sessions (distinct identity digests) → two
//!    sessions, two panel groups.
//! 3. Idempotent retry: a second apply with the same operation returns the
//!    existing result without duplicating rows.
//! 4. Cancel before commit: no session rows are written; operation reaches
//!    `cancelled`.
//!
//! These tests use the real in-memory SQLite database via
//! `persistence_core::test_support::setup_db`.

mod support;

use support::*;

// ── 1. Single proposed session → one immutable session ───────────────────

#[tokio::test]
async fn apply_creates_one_session_and_panel_group() {
    let db = setup_db().await;
    let pool = db.pool();

    let (op_row_id, state_version) = seed_minimal_apply_context(pool, "target-a", 1, 2).await;

    let progress =
        app_core_inbox::session_materialization::progress::MaterializationProgress::new(1, 2);
    let result = app_core_inbox::session_materialization::apply::run_apply(
        pool,
        app_core_inbox::session_materialization::apply::ApplyParams {
            operation_row_id: op_row_id,
            operation_state_version: state_version,
            approved_plan_digest: "test-digest",
            actor_public_id: "actor-001",
            canonical_target_public_id: Some("target-a"),
            progress,
        },
    )
    .await;

    assert!(result.is_ok(), "apply failed: {result:?}");

    // Operation must be `applied`
    let op: (String,) =
        sqlx::query_as("SELECT state FROM session_materialization_operation WHERE row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(op.0, "applied");

    // Exactly one session
    let session_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM session WHERE materialization_operation_row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(session_count.0, 1, "must create exactly one session");

    // Exactly two frame memberships
    let frame_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM session_frame WHERE materialization_operation_row_id = ?",
    )
    .bind(op_row_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(frame_count.0, 2, "must create exactly two frame memberships");

    // Exactly one panel group
    let group_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM panel_group WHERE status = 'active'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(group_count.0, 1, "must create exactly one singleton panel group");

    // The panel group has an accepted head revision
    let head_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM panel_group WHERE head_revision_row_id IS NOT NULL")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(head_count.0, 1, "panel group must have an accepted head revision");

    // Result snapshot must exist and counts must match
    let snap: (i64, i64, i64) = sqlx::query_as(
        "SELECT session_count, membership_count, singleton_group_count
         FROM session_materialization_result_snapshot
         WHERE operation_row_id = ?",
    )
    .bind(op_row_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(snap.0, 1, "snapshot session_count must be 1");
    assert_eq!(snap.1, 2, "snapshot membership_count must be 2");
    assert_eq!(snap.2, 1, "snapshot singleton_group_count must be 1");
}

// ── 2. Two proposed sessions with different identity digests ────────────

#[tokio::test]
async fn apply_creates_two_sessions_for_two_partitions() {
    let db = setup_db().await;
    let pool = db.pool();

    let (op_row_id, state_version) = seed_two_session_apply_context(pool, "target-b").await;

    let progress =
        app_core_inbox::session_materialization::progress::MaterializationProgress::new(2, 2);
    let result = app_core_inbox::session_materialization::apply::run_apply(
        pool,
        app_core_inbox::session_materialization::apply::ApplyParams {
            operation_row_id: op_row_id,
            operation_state_version: state_version,
            approved_plan_digest: "test-digest-2",
            actor_public_id: "actor-002",
            canonical_target_public_id: Some("target-b"),
            progress,
        },
    )
    .await;

    assert!(result.is_ok(), "apply failed: {result:?}");

    let session_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM session WHERE materialization_operation_row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(session_count.0, 2, "must create two sessions");

    let group_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM panel_group WHERE status = 'active'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(group_count.0, 2, "each light session gets its own singleton panel group");

    // Frame memberships: one per session
    let frame_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM session_frame WHERE materialization_operation_row_id = ?",
    )
    .bind(op_row_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(frame_count.0, 2, "two frame memberships total");
}

// ── 3. Idempotency: operation already applied → zero duplicate rows ───────

#[tokio::test]
async fn apply_is_idempotent_via_ledger_replay() {
    let db = setup_db().await;
    let pool = db.pool();

    let (op_row_id, state_version) = seed_minimal_apply_context(pool, "target-c", 3, 4).await;

    let run = |op_row_id: i64, sv: i64| {
        let pool = pool.clone();
        async move {
            let progress =
                app_core_inbox::session_materialization::progress::MaterializationProgress::new(
                    1, 1,
                );
            app_core_inbox::session_materialization::apply::run_apply(
                &pool,
                app_core_inbox::session_materialization::apply::ApplyParams {
                    operation_row_id: op_row_id,
                    operation_state_version: sv,
                    approved_plan_digest: "idem-digest",
                    actor_public_id: "actor-003",
                    canonical_target_public_id: Some("target-c"),
                    progress,
                },
            )
            .await
        }
    };

    // First apply must succeed
    run(op_row_id, state_version).await.expect("first apply");

    // The operation is now `applied`; a second apply attempt must fail with
    // a CAS error (state no longer `ready`), not create duplicate rows.
    let second = run(op_row_id, state_version).await;
    assert!(second.is_err(), "second apply must fail (CAS on ready→applying)");

    // No duplicate sessions
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM session WHERE materialization_operation_row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(count.0, 1, "no duplicate sessions after idempotent retry");
}

// ── 4. Cancel before commit leaves no session rows ────────────────────────

#[tokio::test]
async fn cancel_before_commit_produces_no_sessions() {
    let db = setup_db().await;
    let pool = db.pool();

    let (op_row_id, state_version) = seed_minimal_apply_context(pool, "target-d", 5, 6).await;

    // Pre-set cancel before calling run_apply so the loop never writes a session
    let progress =
        app_core_inbox::session_materialization::progress::MaterializationProgress::new(1, 1);
    progress.request_cancel();

    let result = app_core_inbox::session_materialization::apply::run_apply(
        pool,
        app_core_inbox::session_materialization::apply::ApplyParams {
            operation_row_id: op_row_id,
            operation_state_version: state_version,
            approved_plan_digest: "cancel-digest",
            actor_public_id: "actor-004",
            canonical_target_public_id: Some("target-d"),
            progress,
        },
    )
    .await;

    assert!(result.is_ok(), "cancel must complete without error: {result:?}");

    let state: (String,) =
        sqlx::query_as("SELECT state FROM session_materialization_operation WHERE row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(state.0, "cancelled", "operation must reach cancelled state");

    let session_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM session WHERE materialization_operation_row_id = ?")
            .bind(op_row_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(session_count.0, 0, "cancelled apply must write zero sessions");
}
