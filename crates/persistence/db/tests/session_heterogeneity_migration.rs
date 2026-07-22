// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0082 integration tests for the normalized Spec 062 schema.

use persistence_db::Database;
use sqlx::{Acquire, Executor, SqlitePool};

async fn fresh_database() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().expect("temporary database directory");
    let path = dir.path().join("session-heterogeneity.db");
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let db = Database::connect(&url).await.expect("connect fresh database");
    db.migrate_uncached().await.expect("run complete migration chain");
    let foreign_keys: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
        .fetch_one(db.pool())
        .await
        .expect("read foreign_keys pragma");
    assert_eq!(foreign_keys.0, 1, "migration connection must restore foreign key enforcement");
    (dir, db)
}

async fn seed_session(pool: &SqlitePool) {
    let mut connection = pool.acquire().await.expect("acquire seed connection");
    let mut tx = connection.begin().await.expect("begin seed transaction");
    tx.execute("INSERT INTO spec062_actor VALUES (1, '00000000-0000-7000-8000-000000000001', '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute("INSERT INTO spec062_config_revision VALUES (1, '00000000-0000-7000-8000-000000000002', 1, 'config-digest', '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute("INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute(
        "INSERT INTO command_execution (
            row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
            response_json, created_at, finished_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000003', 1, 'inbox.materialization.apply',
            'payload-digest', 'applied', '{}', '2026-07-22T00:00:00.000000Z',
            '2026-07-22T00:00:01.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO session_materialization_operation (
            row_id, public_id, kind, command_row_id, config_revision_row_id, state,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000004', 'inbox_ingestion', 1, 1,
            'ready', 1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO session (
            row_id, public_id, materialization_operation_row_id, kind,
            ordinal_in_operation, identity_digest, observing_night_date,
            night_derivation, created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000005', 1, 'dark', 0,
            'session-digest', '2026-07-21', 'reviewed_local_fallback', 1,
            '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute("INSERT INTO spec062_file_identity VALUES (1, '00000000-0000-7000-8000-000000000006', NULL, '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute(
        "INSERT INTO frame_record (
            row_id, public_id, file_row_id, byte_size, captured_metadata_digest,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000007', 1, 4096, 'frame-digest',
            1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.commit().await.expect("commit seed data");
}

#[tokio::test]
async fn full_chain_has_normalized_integer_relationships_and_no_relationship_json() {
    let (_dir, db) = fresh_database().await;

    let foreign_key_violations: Vec<(String, i64, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(db.pool())
            .await
            .expect("foreign key check");
    assert!(
        foreign_key_violations.is_empty(),
        "foreign key violations: {foreign_key_violations:?}"
    );

    let relationship_columns: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT m.name, p.name, p.type
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS p
         WHERE m.type = 'table'
           AND (m.name LIKE 'session_%' OR m.name LIKE 'panel_%'
                OR m.name LIKE 'mosaic_%' OR m.name LIKE 'project_%')
           AND (p.name LIKE '%_row_id' OR p.name IN ('row_id', 'sequence'))",
    )
    .fetch_all(db.pool())
    .await
    .expect("inspect relationship columns");
    assert!(!relationship_columns.is_empty());
    assert!(relationship_columns.iter().all(|(_, _, ty)| ty == "INTEGER"));

    let forbidden_json_columns: Vec<(String, String)> = sqlx::query_as(
        "SELECT m.name, p.name
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS p
         WHERE m.type = 'table'
           AND (m.name LIKE 'session_%' OR m.name LIKE 'panel_%'
                OR m.name LIKE 'mosaic_%' OR m.name LIKE 'project_%')
           AND p.name LIKE '%json%'",
    )
    .fetch_all(db.pool())
    .await
    .expect("inspect canonical relationship storage");
    assert!(
        forbidden_json_columns.is_empty(),
        "relationship JSON remains: {forbidden_json_columns:?}"
    );
}

#[tokio::test]
async fn accepted_session_membership_is_append_only_and_exact_cardinality_is_queryable() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    let violations: Vec<(String, i64)> = sqlx::query_as(
        "SELECT invariant, owner_row_id FROM spec062_invariant_violation
         WHERE invariant = 'session_membership_cardinality'",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(violations, vec![("session_membership_cardinality".to_owned(), 1)]);

    sqlx::query(
        "INSERT INTO session_frame (
            session_row_id, frame_row_id, materialization_operation_row_id,
            ordinal, is_representative, created_sequence
         ) VALUES (1, 1, 1, 0, 1, 1)",
    )
    .execute(db.pool())
    .await
    .expect("insert complete immutable membership");

    let remaining: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'session_membership_cardinality'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(remaining.0, 0);

    assert!(sqlx::query("UPDATE session_frame SET ordinal = 2 WHERE session_row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("DELETE FROM session_frame WHERE session_row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("UPDATE session SET identity_digest = 'changed' WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
async fn footprint_rtree_preserves_outward_i32_bounds() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    // Exact bounds straddle quantization cells. The writer's floor(min*1e9) and
    // ceil(max*1e9) produce these conservative integers.
    let min_x = (-0.100_000_000_1_f64 * 1_000_000_000.0).floor() as i64;
    let max_x = (0.100_000_000_1_f64 * 1_000_000_000.0).ceil() as i64;
    assert_eq!((min_x, max_x), (-100_000_001, 100_000_001));

    sqlx::query(
        "INSERT INTO frame_metadata_evidence (
            row_id, public_id, frame_row_id, revision_number, detected_kind,
            offset_state, binning_state, readout_state, footprint_wkb, footprint_digest,
            bbox_min_x_ppb, bbox_max_x_ppb, bbox_min_y_ppb, bbox_max_y_ppb,
            bbox_min_z_ppb, bbox_max_z_ppb, geometry_solver_version, actor_row_id,
            command_row_id, created_sequence, recorded_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000008', 1, 1, 'dark',
            'absent', 'absent', 'absent', X'01', 'footprint-digest', ?, ?,
            -1, 1, -1000000000, 1000000000, 'solver-v1', 1, 1, 1,
            '2026-07-22T00:00:00.000000Z'
         )",
    )
    .bind(min_x)
    .bind(max_x)
    .execute(db.pool())
    .await
    .expect("insert footprint evidence");

    let bounds: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT min_x_ppb, max_x_ppb, min_y_ppb, max_y_ppb, min_z_ppb, max_z_ppb
         FROM frame_footprint_rtree WHERE evidence_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .expect("rtree row inserted atomically with evidence");
    assert_eq!(bounds, (min_x, max_x, -1, 1, -1_000_000_000, 1_000_000_000));

    assert!(sqlx::query("UPDATE frame_metadata_evidence SET bbox_min_x_ppb = 0 WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
async fn normalized_result_counts_and_visibility_history_are_enforced() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    sqlx::query(
        "INSERT INTO session_materialization_result_snapshot (
            row_id, public_id, operation_row_id, session_count, membership_count,
            singleton_group_count, blocked_frame_count, canonical_digest,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000009', 1, 1, 0, 0, 0,
            'result-digest', 1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mismatch: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'operation_session_count' AND owner_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(mismatch.0, 1);

    sqlx::query(
        "INSERT INTO session_materialization_result_session
         (snapshot_row_id, session_row_id, ordinal) VALUES (1, 1, 0)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let mismatch: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'operation_session_count' AND owner_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(mismatch.0, 0);

    let history_tables: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
            'panel_group_head_history', 'mosaic_head_history',
            'project_membership_head_history', 'project_materialization_head_history'
         )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(history_tables.0, 4, "every mutable domain head needs watermark history");
}
