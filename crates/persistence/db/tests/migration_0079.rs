// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0079 integration test (camera sensor geometry).
//!
//! Proves 0079 applies on a FRESH file-backed database, not merely an already
//! migrated one: a stale `sqlx::migrate!` embed has previously let a new
//! migration go unapplied while the in-memory suite still passed. This test
//! connects to a brand-new file, runs the full chain from zero, and asserts
//! the three columns and their CHECK constraints are live.

use persistence_db::Database;

async fn fresh_file_db(dir: &tempfile::TempDir) -> Database {
    let path = dir.path().join("fresh.db");
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let db = Database::connect(&url).await.expect("connect to a fresh file database");
    db.migrate().await.expect("full migration chain on a fresh database");
    db
}

#[tokio::test]
async fn adds_sensor_geometry_columns_on_a_fresh_database() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_file_db(&dir).await;

    let cols: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info('cameras')")
        .fetch_all(db.pool())
        .await
        .unwrap();
    let names: Vec<String> = cols.into_iter().map(|(n,)| n).collect();

    for expected in ["pixel_size_um", "sensor_width_px", "sensor_height_px"] {
        assert!(
            names.iter().any(|n| n == expected),
            "fresh database is missing `{expected}`; cameras columns = {names:?}"
        );
    }
}

/// Existing rows have no geometry to backfill, so the columns must be
/// nullable: a camera inserted without geometry has to remain insertable and
/// read back as NULL, never as a fabricated 0.
#[tokio::test]
async fn geometry_is_nullable_and_defaults_to_null() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_file_db(&dir).await;

    sqlx::query(
        "INSERT INTO cameras (id, name, aliases, auto_detected, created_at) \
         VALUES ('cam-1', 'Legacy', '[]', 0, '2026-01-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .expect("a camera without geometry must still insert");

    let row: (Option<f64>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT pixel_size_um, sensor_width_px, sensor_height_px FROM cameras WHERE id = 'cam-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();

    assert_eq!(row, (None, None, None), "absent geometry must read back as NULL, not 0");
}

/// The CHECK constraints reject degenerate values at the storage boundary, so
/// a zero-sized sensor cannot reach the FOV computation even if a caller
/// bypasses form validation.
#[tokio::test]
async fn check_constraints_reject_non_positive_geometry() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_file_db(&dir).await;

    // One literal statement per column (sqlx's `SqlSafeStr` bound rejects
    // composed SQL), each parameterised over the offending value.
    for (label, value) in [("zero pixel size", 0.0), ("negative pixel size", -3.76)] {
        let result = sqlx::query(
            "INSERT INTO cameras (id, name, aliases, auto_detected, created_at, pixel_size_um) \
             VALUES ('bad-px', 'Bad', '[]', 0, '2026-01-01T00:00:00Z', ?)",
        )
        .bind(value)
        .execute(db.pool())
        .await;
        assert!(result.is_err(), "{label}: CHECK must reject pixel_size_um = {value}");
    }

    for (label, value) in [("zero width", 0_i64), ("negative width", -1)] {
        let result = sqlx::query(
            "INSERT INTO cameras (id, name, aliases, auto_detected, created_at, sensor_width_px) \
             VALUES ('bad-w', 'Bad', '[]', 0, '2026-01-01T00:00:00Z', ?)",
        )
        .bind(value)
        .execute(db.pool())
        .await;
        assert!(result.is_err(), "{label}: CHECK must reject sensor_width_px = {value}");
    }

    for (label, value) in [("zero height", 0_i64), ("negative height", -1)] {
        let result = sqlx::query(
            "INSERT INTO cameras (id, name, aliases, auto_detected, created_at, sensor_height_px) \
             VALUES ('bad-h', 'Bad', '[]', 0, '2026-01-01T00:00:00Z', ?)",
        )
        .bind(value)
        .execute(db.pool())
        .await;
        assert!(result.is_err(), "{label}: CHECK must reject sensor_height_px = {value}");
    }
}
