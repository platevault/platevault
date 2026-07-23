// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

#![allow(clippy::doc_markdown)] // "SQLite" is a proper noun, not code -- matches src/lib.rs
//! Cross-process snapshot of the fully-migrated database (#1230).
//!
//! The test suite spent ~74% of its CPU re-running the same migration chain.
//! nextest runs one process per test, so an in-process memo is worthless --
//! measured slightly *worse* than no cache at all, because each of the ~1069
//! DB-touching tests is its own process with nothing to memoise. The snapshot
//! therefore has to outlive the process, so it lives on disk: the first
//! process to need it runs the real chain once and writes the result out as
//! SQL, and every later process replays that SQL instead.
//!
//! Migrations remain the sole source of truth for the schema. This only
//! memoises their output, keyed on their content.
//!
//! The snapshot is SQL text rather than a database file that could be
//! attached: sqlx opens `:memory:` databases with `SQLITE_OPEN_MEMORY`, and
//! that flag applies to ATTACH too -- an attached file is silently replaced by
//! an empty in-memory database, which would hand every in-memory test (i.e.
//! nearly all of them) a blank schema. Row values are rendered by SQLite's own
//! `quote()`, so NULLs, blobs and reals are formatted by SQLite rather than by
//! this module.
//!
//! Correctness invariants, in the order they matter:
//!
//! * **Keyed on the embedded migrator, never a filename.** The key is a
//!   SHA-256 over every embedded migration's version and checksum, so a stale
//!   `sqlx::migrate!` embed (which this repo has had before) yields a
//!   different key and misses the cache rather than silently serving a schema
//!   that does not match the migrations on disk.
//! * **Rows are dumped, not just schema.** Several migrations seed rows that
//!   tests read back; a schema-only snapshot silently breaks them. Dumping
//!   every table's contents covers seeded data by construction.
//! * **Only ever applied to an empty database.** A populated database (a real
//!   user's, or a test that pre-seeds) always takes the real chain, so the
//!   snapshot can never collide with existing objects or skip a forward
//!   migration that has data to transform.
//! * **Any failure falls back to the real chain.** The replay runs in one
//!   transaction, so a partial replay rolls back and leaves the database empty
//!   for the fallback. A broken snapshot costs speed, never correctness.
//!
//! Enabled only under `debug_assertions` (tests and dev builds); release
//! binaries always run the real chain. `ALM_SCHEMA_CACHE=0` disables it,
//! `ALM_SCHEMA_CACHE_DIR` relocates it.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool};
use sqlx::{AssertSqlSafe, ConnectOptions, Connection, SqliteConnection};

/// The embedded migration chain -- the single source of truth for the schema.
pub(crate) static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

type CacheResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Identity of a migration chain, as (version, checksum) pairs.
///
/// Split from [`cache_key`] so the keying rule can be tested against a
/// synthetic chain: the guarantee under test is that *any* change to a version
/// or checksum changes the key.
pub(crate) fn key_for<'a>(migrations: impl Iterator<Item = (i64, &'a [u8])>) -> String {
    let mut hasher = Sha256::new();
    for (version, checksum) in migrations {
        hasher.update(version.to_le_bytes());
        hasher.update(checksum);
    }
    format!("{:x}", hasher.finalize())
}

pub(crate) fn cache_key() -> String {
    key_for(MIGRATOR.iter().map(|m| (m.version, m.checksum.as_ref())))
}

fn enabled() -> bool {
    cfg!(debug_assertions) && std::env::var("ALM_SCHEMA_CACHE").as_deref() != Ok("0")
}

fn cache_dir() -> PathBuf {
    std::env::var_os("ALM_SCHEMA_CACHE_DIR")
        .map_or_else(|| std::env::temp_dir().join("platevault-schema-cache"), PathBuf::from)
}

pub(crate) fn snapshot_path() -> PathBuf {
    cache_dir().join(format!("schema-{}.sql", cache_key()))
}

/// Bring `pool`'s database up to the latest schema from the snapshot.
///
/// Returns `false` when the caller must run the real migration chain instead:
/// the cache is disabled, the database is not empty, or the snapshot could not
/// be built or replayed.
pub(crate) async fn try_apply(pool: &SqlitePool) -> bool {
    if !enabled() {
        return false;
    }
    // Errors are deliberately swallowed: every failure mode here is
    // recoverable by running the real chain, and surfacing them would turn a
    // performance optimisation into a source of test failures.
    apply(pool).await.unwrap_or(false)
}

async fn apply(pool: &SqlitePool) -> CacheResult<bool> {
    let mut conn = pool.acquire().await?;
    if !is_empty(&mut conn).await? {
        return Ok(false);
    }

    let snapshot = snapshot_path();
    if !snapshot.exists() {
        build_snapshot(&snapshot).await?;
    }

    replay(&mut conn, &std::fs::read_to_string(&snapshot)?).await?;
    Ok(true)
}

async fn is_empty(conn: &mut SqliteConnection) -> Result<bool, sqlx::Error> {
    let (objects,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM sqlite_master").fetch_one(&mut *conn).await?;
    Ok(objects == 0)
}

/// Run the real chain once into a private file, dump it, then publish the dump
/// atomically.
///
/// Concurrent builders are safe and merely wasteful: each stages under a unique
/// name and the rename that publishes it is atomic within the directory, so a
/// loser simply replaces (or is replaced by) an identical file.
async fn build_snapshot(destination: &Path) -> CacheResult<()> {
    let directory = destination.parent().ok_or("schema cache path has no parent directory")?;
    std::fs::create_dir_all(directory)?;

    let unique = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
    let scratch_db = directory.join(format!("staging-{unique}.db"));
    let staging_sql = directory.join(format!("staging-{unique}.sql"));

    let dumped = dump_migrated_database(&scratch_db).await;
    // The scratch database has served its purpose either way; only the SQL is
    // published.
    let _ = std::fs::remove_file(&scratch_db);
    let sql = dumped?;

    std::fs::write(&staging_sql, sql)?;
    if let Err(error) = std::fs::rename(&staging_sql, destination) {
        let _ = std::fs::remove_file(&staging_sql);
        // Losing the publish race to another builder is success, not failure.
        if !destination.exists() {
            return Err(error.into());
        }
    }
    Ok(())
}

async fn dump_migrated_database(scratch_db: &Path) -> CacheResult<String> {
    // DELETE journalling keeps the scratch database to a single file, so the
    // cleanup above does not strand -wal/-shm sidecars.
    let mut conn = SqliteConnectOptions::new()
        .filename(scratch_db)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Delete)
        .connect()
        .await?;
    MIGRATOR.run(&mut conn).await?;
    let sql = dump(&mut conn).await?;
    conn.close().await?;
    Ok(sql)
}

async fn dump(conn: &mut SqliteConnection) -> Result<String, sqlx::Error> {
    // rowid order is creation order, so tables precede the indexes, triggers
    // and views that depend on them.
    let objects: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut sql = String::new();
    for (_, name, statement) in &objects {
        if is_sqlite_internal(name) {
            continue;
        }
        sql.push_str(statement);
        sql.push_str(";\n");
    }
    for (object_type, name, _) in &objects {
        if object_type != "table" || is_sqlite_internal(name) {
            continue;
        }
        append_rows(&mut *conn, name, &mut sql).await?;
    }
    Ok(sql)
}

/// Append one ready-to-run INSERT per row of `table`.
///
/// The literals come from SQLite's `quote()`, which renders every storage class
/// -- including NULL and blobs -- as a valid SQL literal, so no value
/// formatting (and no round-tripping through Rust types) happens here.
async fn append_rows(
    conn: &mut SqliteConnection,
    table: &str,
    sql: &mut String,
) -> Result<(), sqlx::Error> {
    let quoted_table = quote_identifier(table);

    let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(AssertSqlSafe(format!("PRAGMA table_info(\"{quoted_table}\")")))
            .fetch_all(&mut *conn)
            .await?;
    if columns.is_empty() {
        return Ok(());
    }

    let literals = columns
        .iter()
        .map(|(_, name, ..)| format!("quote(\"{}\")", quote_identifier(name)))
        .collect::<Vec<_>>()
        .join(" || ',' || ");

    let statements: Vec<(String,)> = sqlx::query_as(AssertSqlSafe(format!(
        "SELECT 'INSERT INTO \"{quoted_table}\" VALUES(' || {literals} || ');' \
         FROM \"{quoted_table}\""
    )))
    .fetch_all(&mut *conn)
    .await?;

    for (statement,) in statements {
        sql.push_str(&statement);
        sql.push('\n');
    }
    Ok(())
}

async fn replay(conn: &mut SqliteConnection, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::raw_sql("BEGIN").execute(&mut *conn).await?;
    match write_snapshot(&mut *conn, sql).await {
        Ok(()) => {
            sqlx::raw_sql("COMMIT").execute(&mut *conn).await?;
            Ok(())
        }
        Err(error) => {
            let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
            Err(error)
        }
    }
}

async fn write_snapshot(conn: &mut SqliteConnection, sql: &str) -> Result<(), sqlx::Error> {
    // Rows are inserted table-by-table, which is not foreign-key order.
    // Deferring resets automatically at COMMIT.
    sqlx::raw_sql("PRAGMA defer_foreign_keys = ON").execute(&mut *conn).await?;
    sqlx::raw_sql(AssertSqlSafe(sql.to_owned())).execute(&mut *conn).await?;
    Ok(())
}

fn quote_identifier(name: &str) -> String {
    name.replace('"', "\"\"")
}

/// `sqlite_sequence` and friends are maintained by SQLite itself: creating one
/// explicitly is an error, and its contents follow from the rows inserted into
/// the AUTOINCREMENT tables that own it.
fn is_sqlite_internal(name: &str) -> bool {
    name.starts_with("sqlite_")
}

#[cfg(test)]
mod tests {
    use sqlx::AssertSqlSafe;

    use super::{key_for, snapshot_path, try_apply};
    use crate::Database;

    /// Every schema object, ignoring SQLite's own bookkeeping tables.
    async fn schema_of(db: &Database) -> Vec<(String, String, String)> {
        sqlx::query_as(
            "SELECT type, name, COALESCE(sql, '') FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .fetch_all(db.pool())
        .await
        .expect("read schema")
    }

    async fn tables_of(db: &Database) -> Vec<String> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type = 'table' \
             AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(db.pool())
        .await
        .expect("list tables");
        rows.into_iter().map(|(name,)| name).collect()
    }

    /// When the migration ran and how long it took are wall-clock facts about
    /// a particular run, not schema content: the snapshot legitimately records
    /// the moment it was built rather than the moment it was replayed. Every
    /// other `_sqlx_migrations` column -- crucially the checksum sqlx validates
    /// against -- is compared.
    fn is_run_timing(table: &str, column: &str) -> bool {
        table == "_sqlx_migrations" && matches!(column, "installed_on" | "execution_time")
    }

    /// Every seeded row of every table, rendered by SQLite's own `quote()`.
    ///
    /// Compares values rather than counts, so a snapshot that preserved row
    /// counts but corrupted a value (a mis-quoted blob, a truncated real) still
    /// fails.
    async fn all_rows(db: &Database) -> Vec<(String, Vec<String>)> {
        let mut dump = Vec::new();
        for table in tables_of(db).await {
            let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
                sqlx::query_as(AssertSqlSafe(format!("PRAGMA table_info(\"{table}\")")))
                    .fetch_all(db.pool())
                    .await
                    .expect("columns");
            let literals = columns
                .iter()
                .filter(|(_, name, ..)| !is_run_timing(&table, name))
                .map(|(_, name, ..)| format!("quote(\"{name}\")"))
                .collect::<Vec<_>>()
                .join(" || ',' || ");
            let rows: Vec<(String,)> = sqlx::query_as(AssertSqlSafe(format!(
                "SELECT {literals} FROM \"{table}\" ORDER BY 1"
            )))
            .fetch_all(db.pool())
            .await
            .expect("rows");
            dump.push((table, rows.into_iter().map(|(row,)| row).collect()));
        }
        dump
    }

    /// The core guarantee: a snapshot-built database is indistinguishable from
    /// one built by the real migration chain, in both schema and seeded rows.
    #[tokio::test]
    async fn snapshot_reproduces_the_real_chain() {
        let cached = Database::in_memory().await.expect("cached db");
        cached.migrate().await.expect("cached migrate");

        let real = Database::in_memory().await.expect("real db");
        real.migrate_uncached().await.expect("real migrate");

        assert!(
            snapshot_path().exists(),
            "no snapshot was published, so this test compared the real chain against itself"
        );
        assert_eq!(schema_of(&cached).await, schema_of(&real).await, "schema must be identical");

        let cached_rows = all_rows(&cached).await;
        assert_eq!(cached_rows, all_rows(&real).await, "seeded rows must be identical");
        assert!(
            cached_rows.iter().any(|(_, rows)| !rows.is_empty()),
            "no table held rows, so this could not have detected a schema-only snapshot"
        );
    }

    /// A database that already holds objects must take the real chain, so the
    /// snapshot can never collide with them or skip a data migration.
    #[tokio::test]
    async fn populated_database_bypasses_the_snapshot() {
        let db = Database::in_memory().await.expect("db");
        sqlx::query("CREATE TABLE pre_existing (id INTEGER)")
            .execute(db.pool())
            .await
            .expect("seed an object");

        assert!(!try_apply(db.pool()).await, "a non-empty database must not accept a snapshot");

        db.migrate().await.expect("real chain still applies");
        let (found,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE name = 'pre_existing'")
                .fetch_one(db.pool())
                .await
                .expect("look up pre-existing table");
        assert_eq!(found, 1, "the fallback must not have dropped existing objects");
    }

    /// The keying guarantee from #1230: the key must track migration content,
    /// so a stale embed cannot silently reuse another chain's snapshot.
    #[test]
    fn key_tracks_every_version_and_checksum() {
        let base = key_for([(1_i64, b"aaa".as_slice()), (2, b"bbb")].into_iter());

        assert_ne!(
            base,
            key_for([(1_i64, b"aaa".as_slice()), (2, b"bbZ")].into_iter()),
            "a changed checksum must change the key"
        );
        assert_ne!(
            base,
            key_for([(1_i64, b"aaa".as_slice()), (3, b"bbb")].into_iter()),
            "a changed version must change the key"
        );
        assert_ne!(
            base,
            key_for([(1_i64, b"aaa".as_slice())].into_iter()),
            "a dropped migration must change the key"
        );
        assert_ne!(
            base,
            key_for([(1_i64, b"aaa".as_slice()), (2, b"bbb"), (3, b"ccc")].into_iter()),
            "an added migration must change the key"
        );
        assert_eq!(
            base,
            key_for([(1_i64, b"aaa".as_slice()), (2, b"bbb")].into_iter()),
            "an unchanged chain must be stable across calls"
        );
    }
}
