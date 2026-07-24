// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared in-process test fixtures for persistence repository unit tests.
//!
//! Public so sub-crates can use `setup_db` in their own tests.

use sqlx::SqlitePool;

use crate::Database;

/// An in-memory [`Database`] with all migrations applied, ready for a single
/// repository unit test.
pub async fn setup_db() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db
}

/// Insert a minimal `canonical_target` row sufficient to satisfy FK constraints.
pub async fn insert_target(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO canonical_target
         (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
         VALUES (?, NULL, 'Test Target', 'galaxy', 10.0, 20.0, 'seed', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("insert_target failed");
}

/// Insert a minimal `projects` row sufficient to satisfy FK constraints.
pub async fn insert_project(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(id)
    .bind(format!("Project {id}"))
    .bind("PixInsight")
    .bind("ready")
    .bind(format!("projects/{id}"))
    .bind::<Option<String>>(None)
    .bind(false)
    .bind("2026-01-01T00:00:00Z")
    .bind("2026-01-01T00:00:00Z")
    .execute(pool)
    .await
    .expect("insert_project failed");
}
