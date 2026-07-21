// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0078 integration test (drop the `session_snapshot` table).
//!
//! `db.migrate()` runs the full embedded migration set against a fresh
//! database, so this also proves 0078 applies in sequence after 0005 created
//! the table.

use persistence_db::Database;

#[tokio::test]
async fn session_snapshot_table_and_indices_are_gone_on_a_fresh_database() {
    let db = Database::in_memory().await.expect("in-memory db");
    db.migrate().await.expect("migrations should apply cleanly");

    let (leftovers,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master \
         WHERE name = 'session_snapshot' \
            OR name IN ('idx_session_snapshot_session', 'idx_session_snapshot_audit')",
    )
    .fetch_one(db.pool())
    .await
    .expect("sqlite_master query");

    assert_eq!(leftovers, 0, "0078 must leave no session_snapshot table or index behind");
}
