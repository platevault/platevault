// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Invariants for the pre-1.0 database reset.
//!
//! The schema is now a frozen 0001 baseline. These tests intentionally verify
//! the resulting database, rather than replaying the deleted historical chain.

use std::collections::HashSet;

use persistence_db::Database;

async fn migrated() -> Database {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("frozen baseline applies cleanly");
    db
}

async fn count(pool: &sqlx::SqlitePool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.expect("scalar query")
}

async fn table_count(pool: &sqlx::SqlitePool, table: &str) -> i64 {
    match table {
        "calibration_tolerances" => {
            count(pool, "SELECT COUNT(*) FROM calibration_tolerances").await
        }
        "cleanup_policy" => count(pool, "SELECT COUNT(*) FROM cleanup_policy").await,
        "filters" => count(pool, "SELECT COUNT(*) FROM filters").await,
        "ingestion_settings" => count(pool, "SELECT COUNT(*) FROM ingestion_settings").await,
        "protection_defaults" => count(pool, "SELECT COUNT(*) FROM protection_defaults").await,
        "resolver_settings" => count(pool, "SELECT COUNT(*) FROM resolver_settings").await,
        "source_view_config" => count(pool, "SELECT COUNT(*) FROM source_view_config").await,
        "onboarding_state" => count(pool, "SELECT COUNT(*) FROM onboarding_state").await,
        "onboarding_flags" => count(pool, "SELECT COUNT(*) FROM onboarding_flags").await,
        _ => unreachable!("unlisted baseline table"),
    }
}

#[tokio::test]
async fn baseline_schema_and_seed_match_oracle_counts() {
    let db = migrated().await;
    let pool = db.pool();

    // Oracle excludes SQLite internals and _sqlx_migrations: 305 application
    // tables, indexes, and views are present in the candidate baseline.
    assert_eq!(
        count(
            pool,
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','index','view') \
             AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations'",
        )
        .await,
        305
    );

    for (table, expected) in [
        ("calibration_tolerances", 1),
        ("cleanup_policy", 15),
        ("filters", 11),
        ("ingestion_settings", 1),
        ("protection_defaults", 3),
        ("resolver_settings", 1),
        ("source_view_config", 1),
        ("onboarding_state", 0),
        ("onboarding_flags", 0),
    ] {
        assert_eq!(table_count(pool, table).await, expected, "seed row count for {table}");
    }
}

#[tokio::test]
async fn baseline_foreign_keys_are_clean() {
    let db = migrated().await;
    let violations: Vec<(String, i64, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check").fetch_all(db.pool()).await.unwrap();
    assert!(violations.is_empty(), "foreign_key_check: {violations:?}");
}

#[tokio::test]
async fn representative_repository_queries_cover_seeded_and_empty_surfaces() {
    let db = migrated().await;
    let pool = db.pool();

    let filters: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT id, name, category, auto_detected FROM filters ORDER BY name ASC")
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(filters.len(), 11);
    assert_eq!(filters.first().map(|row| row.1.as_str()), Some("B"));

    let settings: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM settings ORDER BY key ASC")
            .fetch_all(pool)
            .await
            .unwrap();
    assert!(settings.is_empty());
    assert_eq!(count(pool, "SELECT COUNT(*) FROM library_root").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM calibration_master_view").await, 0);
    assert_eq!(count(pool, "SELECT COALESCE(MAX(number), 0) FROM plans").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM onboarding_state").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM onboarding_flags").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM projects").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM inbox_items").await, 0);
}

#[test]
fn migration_set_has_frozen_0001_and_unique_append_only_versions() {
    let mut migrations = Database::migrator().iter();
    let first = migrations.next().expect("0001 baseline migration is embedded");
    assert_eq!(first.version, 1);
    assert_eq!(first.description, "initial schema");
    assert_eq!(first.sql.as_str(), include_str!("../migrations/0001_initial_schema.sql"));
    assert_eq!(
        first.checksum.as_ref(),
        &[
            0x72, 0x90, 0x7e, 0xd7, 0x13, 0x54, 0x6f,
            0x3f, 0x6d, 0x84, 0x4b, 0x26, 0x0b, 0xea,
            0xa4, 0xb6, 0x47, 0xc9, 0x73, 0xfb, 0xc6,
            0x5b, 0xca, 0xc7, 0x16, 0xe2, 0xe7, 0xe5,
            0x75, 0x1a, 0xed, 0xad, 0xb9, 0x2d, 0x06,
            0x07, 0x10, 0xed, 0xe6, 0x08, 0x04, 0xec,
            0xa5, 0x05, 0x87, 0x8b, 0x53, 0x7c,
        ]
    );

    let mut versions = HashSet::new();
    for migration in migrations {
        assert!(migration.version >= 2, "future migrations append after frozen 0001");
        assert!(
            versions.insert(migration.version),
            "duplicate migration version {}",
            migration.version
        );
    }
}
