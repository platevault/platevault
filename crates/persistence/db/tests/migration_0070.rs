// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0070 integration test (source protection 2-level collapse, issue
//! #506).
//!
//! `sqlx::migrate!` applies every migration in one shot, so by the time
//! `Database::migrate()` returns, `source_protection_state.level` is already
//! CHECK-constrained to `('protected', 'unprotected')` — a legacy `'normal'`
//! row can no longer even be seeded to prove the remap. Instead, this test
//! builds the minimal PRE-0070 schema directly (the exact `CREATE TABLE`
//! statements from the migrations that own each table: 0013 `settings`/
//! `source_overrides`, 0026 `source_protection_state`, 0035
//! `protection_defaults`), seeds legacy `'normal'` rows across all four, then
//! runs 0070's SQL and asserts every row survives with its value remapped
//! (Constitution §V: non-destructive).

use persistence_db::Database;

const MIGRATION_0070: &str = include_str!("../migrations/0070_protection_two_level.sql");

async fn setup_pre_0070_schema() -> Database {
    let db = Database::in_memory().await.expect("in-memory db");
    let pool = db.pool();

    // Migration 0013.
    sqlx::query(
        "CREATE TABLE settings (
            key        TEXT PRIMARY KEY NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .expect("create settings");
    sqlx::query(
        "CREATE TABLE source_overrides (
            source_id  TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (source_id, key)
        )",
    )
    .execute(pool)
    .await
    .expect("create source_overrides");

    // Migration 0026 (pre-0070 3-level CHECK).
    sqlx::query(
        "CREATE TABLE source_protection_state (
            source_id             TEXT PRIMARY KEY NOT NULL,
            level                 TEXT NOT NULL CHECK (level IN ('protected', 'normal', 'unprotected')),
            block_permanent_delete INTEGER,
            categories            TEXT,
            updated_at            TEXT NOT NULL,
            updated_by            TEXT NOT NULL DEFAULT 'system'
        )",
    )
    .execute(pool)
    .await
    .expect("create source_protection_state");

    // Migration 0035.
    sqlx::query(
        "CREATE TABLE protection_defaults (
            scope      TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (scope, key)
        )",
    )
    .execute(pool)
    .await
    .expect("create protection_defaults");

    db
}

#[tokio::test]
async fn normal_rows_remap_to_unprotected_non_destructively() {
    let db = setup_pre_0070_schema().await;
    let pool = db.pool();

    // Seed one row per level in source_protection_state, plus a legacy
    // 'normal' defaultProtection value in every k/v store it can live in.
    sqlx::query(
        "INSERT INTO source_protection_state \
         (source_id, level, block_permanent_delete, categories, updated_at, updated_by) \
         VALUES \
         ('src-normal', 'normal', 1, '[\"lights\"]', '2026-01-01T00:00:00Z', 'user'), \
         ('src-protected', 'protected', NULL, NULL, '2026-01-01T00:00:00Z', 'user'), \
         ('src-unprotected', 'unprotected', 0, NULL, '2026-01-01T00:00:00Z', 'user')",
    )
    .execute(pool)
    .await
    .expect("seed source_protection_state");

    sqlx::query(
        "INSERT INTO protection_defaults (scope, key, value, updated_at) \
         VALUES ('global', 'defaultProtection', '\"normal\"', '2026-01-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed protection_defaults");

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) \
         VALUES ('defaultProtection', '\"normal\"', '2026-01-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed settings");

    sqlx::query(
        "INSERT INTO source_overrides (source_id, key, value, updated_at) \
         VALUES ('src-normal', 'defaultProtection', '\"normal\"', '2026-01-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed source_overrides");

    // Apply the migration under test (as a multi-statement script — sqlx's
    // `query`/`execute` only runs the first statement, so use the raw
    // sqlite connection's `execute_batch`-equivalent via `sqlx::raw_sql`).
    sqlx::raw_sql(MIGRATION_0070).execute(pool).await.expect("0070 migration must apply");

    // Every row survives (non-destructive) — count unchanged.
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM source_protection_state")
        .fetch_one(pool)
        .await
        .expect("count");
    assert_eq!(count, 3, "no row may be dropped by the 2-level collapse");

    let levels: Vec<(String, String)> =
        sqlx::query_as("SELECT source_id, level FROM source_protection_state ORDER BY source_id")
            .fetch_all(pool)
            .await
            .expect("levels");
    assert_eq!(
        levels,
        vec![
            ("src-normal".to_owned(), "unprotected".to_owned()),
            ("src-protected".to_owned(), "protected".to_owned()),
            ("src-unprotected".to_owned(), "unprotected".to_owned()),
        ],
        "'normal' must remap to 'unprotected'; 'protected'/'unprotected' rows are untouched"
    );

    // block_permanent_delete/categories/updated_at/updated_by survive untouched
    // for the remapped row.
    let (bpd, cats): (Option<i64>, Option<String>) = sqlx::query_as(
        "SELECT block_permanent_delete, categories FROM source_protection_state WHERE source_id = 'src-normal'",
    )
    .fetch_one(pool)
    .await
    .expect("remapped row detail");
    assert_eq!(bpd, Some(1));
    assert_eq!(cats.as_deref(), Some("[\"lights\"]"));

    // The new CHECK actually rejects 'normal' going forward.
    let rejected = sqlx::query(
        "INSERT INTO source_protection_state \
         (source_id, level, updated_at, updated_by) \
         VALUES ('src-new', 'normal', '2026-01-01T00:00:00Z', 'user')",
    )
    .execute(pool)
    .await;
    assert!(rejected.is_err(), "the rebuilt table's CHECK must reject 'normal' post-migration");

    // protection_defaults / settings / source_overrides: no CHECK, but the
    // stored 'normal' JSON value is remapped in place too.
    let (pd_value,): (String,) = sqlx::query_as(
        "SELECT value FROM protection_defaults WHERE scope = 'global' AND key = 'defaultProtection'",
    )
    .fetch_one(pool)
    .await
    .expect("protection_defaults value");
    assert_eq!(pd_value, "\"unprotected\"");

    let (settings_value,): (String,) =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'defaultProtection'")
            .fetch_one(pool)
            .await
            .expect("settings value");
    assert_eq!(settings_value, "\"unprotected\"");

    let (override_value,): (String,) = sqlx::query_as(
        "SELECT value FROM source_overrides WHERE source_id = 'src-normal' AND key = 'defaultProtection'",
    )
    .fetch_one(pool)
    .await
    .expect("source_overrides value");
    assert_eq!(override_value, "\"unprotected\"");
}

#[tokio::test]
async fn already_2_level_rows_are_left_alone() {
    let db = setup_pre_0070_schema().await;
    let pool = db.pool();

    sqlx::query(
        "INSERT INTO source_protection_state \
         (source_id, level, updated_at, updated_by) \
         VALUES ('src-1', 'protected', '2026-01-01T00:00:00Z', 'user')",
    )
    .execute(pool)
    .await
    .expect("seed");
    sqlx::query(
        "INSERT INTO protection_defaults (scope, key, value, updated_at) \
         VALUES ('global', 'defaultProtection', '\"protected\"', '2026-01-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed");

    sqlx::raw_sql(MIGRATION_0070).execute(pool).await.expect("0070 migration must apply");

    let (level,): (String,) =
        sqlx::query_as("SELECT level FROM source_protection_state WHERE source_id = 'src-1'")
            .fetch_one(pool)
            .await
            .expect("level");
    assert_eq!(level, "protected");

    let (value,): (String,) = sqlx::query_as(
        "SELECT value FROM protection_defaults WHERE scope = 'global' AND key = 'defaultProtection'",
    )
    .fetch_one(pool)
    .await
    .expect("value");
    assert_eq!(value, "\"protected\"");
}
