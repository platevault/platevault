// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared test fixtures for `persistence_sessions` repository unit tests.

use sqlx::SqlitePool;

/// Seed the minimal rows required by `session` and related FK chains.
///
/// Inserts:
/// - one `spec062_actor` row (row_id=1)
/// - one `spec062_config_revision` row (row_id=1)
/// - one `repository_change` row (sequence=1)
/// - one `command_execution` row (row_id=1)
/// - one `session_materialization_operation` row (row_id=1, kind=`inbox_ingestion`, state=`ready`)
///
/// # Panics
///
/// Panics on any SQL failure.
pub async fn seed_operation_fixtures(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO spec062_actor VALUES (1, '00000000-0000-7000-a000-000000000001', '2026-07-22T00:00:00.000000Z')"
    )
    .execute(pool)
    .await
    .expect("seed actor");

    sqlx::query(
        "INSERT INTO spec062_config_revision VALUES (1, '00000000-0000-7000-a000-000000000002', 1, 'config-digest', '2026-07-22T00:00:00.000000Z')"
    )
    .execute(pool)
    .await
    .expect("seed config revision");

    sqlx::query(
        "INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, '2026-07-22T00:00:00.000000Z')"
    )
    .execute(pool)
    .await
    .expect("seed repository change");

    sqlx::query(
        "INSERT INTO command_execution (
            row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
            response_json, created_at, finished_at
         ) VALUES (
            1, '00000000-0000-7000-a000-000000000003', 1, 'inbox.materialization.apply',
            'payload-digest', 'applied', '{}', '2026-07-22T00:00:00.000000Z',
            '2026-07-22T00:00:01.000000Z'
         )",
    )
    .execute(pool)
    .await
    .expect("seed command");

    sqlx::query(
        "INSERT INTO session_materialization_operation (
            row_id, public_id, kind, command_row_id, config_revision_row_id, state,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-a000-000000000004', 'inbox_ingestion', 1, 1,
            'ready', 1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .execute(pool)
    .await
    .expect("seed operation");
}

/// Insert one `spec062_file_identity` + `frame_record` pair.
///
/// Uses `row_id = offset` for both rows; `public_id` values are derived from
/// the offset.
///
/// # Panics
///
/// Panics on any SQL failure.
pub async fn seed_frame(pool: &SqlitePool, offset: i64) {
    sqlx::query(
        "INSERT INTO spec062_file_identity VALUES (?, ?, NULL, '2026-07-22T00:00:00.000000Z')",
    )
    .bind(offset)
    .bind(format!("00000000-0000-7000-a000-{offset:012}"))
    .execute(pool)
    .await
    .expect("seed file identity");

    sqlx::query(
        "INSERT INTO frame_record (
            row_id, public_id, file_row_id, byte_size, captured_metadata_digest,
            created_sequence, created_at
         ) VALUES (?, ?, ?, 4096, ?, 1, '2026-07-22T00:00:00.000000Z')",
    )
    .bind(offset)
    .bind(format!("frame-{offset:012}"))
    .bind(offset)
    .bind(format!("digest-{offset}"))
    .execute(pool)
    .await
    .expect("seed frame record");
}
