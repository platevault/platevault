// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

#![allow(clippy::doc_markdown)] // "SQLite" is a proper noun, not code -- matches src/lib.rs
//! Writer/writer contention coverage for `Database::connect` (#1231).
//!
//! `wal_journal_mode.rs` covers reader/writer contention, which WAL removes.
//! WAL does NOT remove writer/writer contention: SQLite still has exactly one
//! write lock, so a second writer blocks and then fails with `SQLITE_BUSY`
//! once `busy_timeout` expires. Two concurrent writers are reachable in
//! production (the single-instance guard is itself untested and E2E-disabled),
//! so the tolerance for that wait is load-bearing.
//!
//! Scope note: at the time of writing, sqlx's own default for `busy_timeout`
//! is also 5s, so `Database::connect` behaved this way before the value was
//! stated explicitly in `src/lib.rs`. These tests therefore pin an *effective*
//! behaviour rather than repair a live defect: they fail if the app's
//! write-contention tolerance is removed, lowered, or silently moved by an
//! upstream default change.
//!
//! `zero_busy_timeout_writer_gets_sqlite_busy` is the control arm. It runs the
//! identical race with the timeout set to zero and asserts the failure does
//! occur, which is what stops the passing test above it from being vacuous —
//! without it, a race that never actually contends would also pass.

use std::str::FromStr;
use std::time::{Duration, Instant};

use persistence_db::{Database, BUSY_TIMEOUT};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, SqliteConnection};

/// How long the first writer holds the write lock.
const HOLD: Duration = Duration::from_millis(600);
/// The second writer must be provably blocked, not merely slow. Well under
/// `HOLD` to absorb CI/WSL scheduling jitter, well over normal write latency.
const BLOCKED_FLOOR: Duration = Duration::from_millis(300);
/// Delay before the second writer starts, so the first provably holds the lock.
const LOCK_SETTLE: Duration = Duration::from_millis(50);

fn db_url(dir: &tempfile::TempDir, name: &str) -> String {
    format!("sqlite://{}?mode=rwc", dir.path().join(name).display())
}

/// Opens a production-configured database and gives it a table to fight over.
async fn connect_with_scratch(url: &str) -> Database {
    let db = Database::connect(url).await.expect("connect");
    sqlx::query("CREATE TABLE IF NOT EXISTS scratch (id INTEGER PRIMARY KEY, note TEXT)")
        .execute(db.pool())
        .await
        .expect("create scratch");
    db
}

/// The production connect options must state a non-zero write-lock tolerance.
///
/// Reads it back through `PRAGMA busy_timeout` rather than trusting the
/// builder, so it reflects what SQLite actually applied to the connection.
#[tokio::test]
async fn production_connect_applies_the_busy_timeout() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = Database::connect(&db_url(&dir, "pragma.db")).await.expect("connect");

    let (timeout_ms,): (i64,) =
        sqlx::query_as("PRAGMA busy_timeout").fetch_one(db.pool()).await.expect("read pragma");

    assert_eq!(
        timeout_ms,
        i64::try_from(BUSY_TIMEOUT.as_millis()).expect("timeout fits i64"),
        "Database::connect must apply the crate's declared busy_timeout"
    );
    assert!(timeout_ms > 0, "a zero busy_timeout makes every write contention a hard failure");
}

/// A second writer arriving mid-transaction waits for the lock and commits.
#[tokio::test]
async fn second_writer_waits_out_the_first_and_commits() {
    let dir = tempfile::tempdir().expect("tempdir");
    let url = db_url(&dir, "contention.db");

    let holder = connect_with_scratch(&url).await;
    let contender = Database::connect(&url).await.expect("contender connect");

    // BEGIN IMMEDIATE takes the write lock up front, rather than at first
    // write, so the race is deterministic.
    let mut held = holder.pool().acquire().await.expect("acquire");
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *held).await.expect("begin immediate");
    sqlx::query("INSERT INTO scratch (note) VALUES ('holder')")
        .execute(&mut *held)
        .await
        .expect("holder write");

    let holder_task = tokio::spawn(async move {
        tokio::time::sleep(HOLD).await;
        sqlx::query("COMMIT").execute(&mut *held).await.expect("commit");
    });

    tokio::time::sleep(LOCK_SETTLE).await;

    let start = Instant::now();
    let result = sqlx::query("INSERT INTO scratch (note) VALUES ('contender')")
        .execute(contender.pool())
        .await;
    let elapsed = start.elapsed();

    holder_task.await.expect("holder task");

    result.expect("second writer must wait out the lock, not fail with SQLITE_BUSY");
    assert!(
        elapsed >= BLOCKED_FLOOR,
        "second writer returned in {elapsed:?}, so it never actually contended for the write \
         lock -- the test would pass even with no busy_timeout at all"
    );
}

/// Control arm: the same race with a zero timeout does fail with `SQLITE_BUSY`.
///
/// Proves the race above genuinely contends, so its pass is attributable to
/// the timeout absorbing the wait.
#[tokio::test]
async fn zero_busy_timeout_writer_gets_sqlite_busy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let url = db_url(&dir, "busy.db");

    let holder = connect_with_scratch(&url).await;

    let impatient_opts = SqliteConnectOptions::from_str(&url)
        .expect("parse opts")
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::ZERO);
    let mut impatient =
        SqliteConnection::connect_with(&impatient_opts).await.expect("impatient connect");

    let mut held = holder.pool().acquire().await.expect("acquire");
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *held).await.expect("begin immediate");
    sqlx::query("INSERT INTO scratch (note) VALUES ('holder')")
        .execute(&mut *held)
        .await
        .expect("holder write");

    let holder_task = tokio::spawn(async move {
        tokio::time::sleep(HOLD).await;
        sqlx::query("COMMIT").execute(&mut *held).await.expect("commit");
    });

    tokio::time::sleep(LOCK_SETTLE).await;

    let err = sqlx::query("INSERT INTO scratch (note) VALUES ('impatient')")
        .execute(&mut impatient)
        .await
        .expect_err("a zero-timeout writer must not be able to take the held write lock");

    holder_task.await.expect("holder task");

    let code = err.as_database_error().and_then(sqlx::error::DatabaseError::code);
    assert_eq!(
        code.as_deref(),
        Some("5"),
        "expected SQLITE_BUSY (5), got {err:?} -- if this is no longer a busy error the race \
         above has stopped exercising write contention"
    );
}
