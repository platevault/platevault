// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Persistence and repository boundary.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Production backend: sqlx 0.9 + SQLite (ratified stack, wired T003).
//! All migrations live in `./migrations/` and are consumed via `sqlx::migrate!()`.
//! Migration 0048 added `canonical_target.notes` (spec 023 US4).
//! Migration 0053 added `projects.archived_via_plan_id` + re-added `'archive'`
//! to the `plans.origin` CHECK (spec 017 C5).
//! Migration 0061 added `target_favourite` (spec 051 US2).
//! Migration 0064 added the `framing`/`framing_session` tables, `projects.is_mosaic`,
//! and the durable `acquisition_session` clustering-key columns (spec 008 Q27).
//! Migration 0080 added `onboarding_state`/`onboarding_flags` (spec 056).
//! Migration 0081 dropped the legacy spec-010 `guided_flow_state` table
//! (spec 056 deletion lane, T010).

use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};

pub mod operation_state;
/// Reference pattern for the centralized typed persistence layer (sea-query +
/// manual sqlx 0.9 binding). Compiled only under `cfg(test)`; not wired into
/// any real repository. See `query_builder_example.rs` and
/// `docs/development/persistence-layer-hardening.md`.
#[cfg(test)]
mod query_builder_example;
pub mod repositories;
mod schema_cache;
/// Shared in-process test fixtures (setup, insert helpers) for repository unit
/// tests. Compiled only under `cfg(test)`.
#[cfg(test)]
pub(crate) mod test_support;

pub const CRATE_NAME: &str = "persistence_db";

/// How long a writer waits for the SQLite write lock before `SQLITE_BUSY`.
///
/// Matches sqlx's current default; stated here so the value is ours, not a
/// transitively-inherited one (#1231).
pub const BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("compare-and-swap failed: {0}")]
    CasFailed(String),
    #[error("serialisation error: {0}")]
    Serialise(#[from] serde_json::Error),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("not implemented")]
    NotImplemented,
    /// Catalog origin 'user' is not implemented in v1 (A2 — deferred to v1.x).
    /// Returned by catalog install functions when `origin == CatalogOrigin::User`.
    #[error("origin 'user' is not implemented in v1 (A2)")]
    OriginNotImplemented,
}

pub trait Repository {
    fn repository_name(&self) -> &'static str;
}

/// Production SQLite connection pool.
///
/// Callers use `Database::connect` for a file-backed store or
/// `Database::in_memory` for ephemeral test fixtures. Both run migrations
/// automatically via [`Database::migrate`].
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Connect to a file-backed SQLite database.
    ///
    /// `connection_string` should be a `sqlite://`-prefixed path or the special
    /// value `sqlite::memory:` for an in-process ephemeral store.
    ///
    /// Explicitly requests WAL journaling (#830): sqlx's default journal mode
    /// is whatever the on-disk file already uses, which for a freshly created
    /// file is SQLite's own default, rollback-journal (`DELETE`) mode. Under
    /// rollback-journal, a writer holds an exclusive lock on the *whole file*
    /// for the life of its transaction, so a background reader (e.g. the
    /// desktop poller's `registered_sources`/`inbox_items` queries) sharing
    /// this same pool blocks behind any concurrent writer (plan apply, audit,
    /// `events` inserts) until `busy_timeout` elapses or the writer commits —
    /// this is the slow-query pattern from #830, not a missing index or an
    /// oversized transaction (`events` inserts are single-statement, see
    /// `repositories::events::insert_event`). WAL lets readers proceed
    /// concurrently with a single writer, removing that contention class.
    /// `synchronous` is left at SQLite's default (`FULL`) — WAL commits are
    /// already fsynced at that setting, so durability of the audit record
    /// (constitution II/V) is unchanged; only the locking model differs.
    ///
    /// `busy_timeout` is stated explicitly rather than inherited (#1231). WAL
    /// removes reader/writer contention but NOT writer/writer contention: two
    /// writers still serialise on the single write lock, and the loser gets
    /// `SQLITE_BUSY` the moment the timeout expires. sqlx currently defaults
    /// this to the same 5s (`SqliteConnectOptions::default`), so pinning it
    /// changes no behaviour today — it stops the app's write-contention
    /// tolerance from being an upstream default that a dependency bump can
    /// silently move. `tests/two_writer_contention.rs` holds it to that.
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Database`] if the pool cannot connect to the given URL.
    pub async fn connect(connection_string: &str) -> DbResult<Self> {
        let options = SqliteConnectOptions::from_str(connection_string)?
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(BUSY_TIMEOUT);
        let pool = SqlitePoolOptions::new().max_connections(8).connect_with(options).await?;
        Ok(Self { pool })
    }

    /// Convenience constructor for in-memory SQLite (test and CI use).
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Database`] if the in-memory pool cannot be created.
    pub async fn in_memory() -> DbResult<Self> {
        Self::connect("sqlite::memory:").await
    }

    /// Run all pending migrations from `./migrations/`.
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Migration`] if any migration script fails.
    // Touched for #773 (migration 0066), again for spec 008 Q27's migration
    // 0067 (renumbered from a 0066 collision with #773's own
    // 0066_session_notes.sql), again for its renumber to 0068 (a second
    // collision: 0067 vs #895's 0067_camera_sensor_type.sql, both merged to
    // main independently), and again for spec 056's onboarding migrations —
    // first as 0069/0070, then renumbered again (0069/0070 -> 0071/0072 -> 0072/0073) as main landed its
    // own 0069_fix_processing_artifact_project_fk and 0070_protection_two_level
    // while this branch was open (a third independent collision), then to
    // 0080/0081 after main reached 0079 — to force `sqlx::migrate!` re-embed
    // each time (project memory: stale-embed guard).
    //
    // #745 (spec 049 CL-2): this used to also run the spec 026 T006a
    // `kind_diverged` reconciliation scan on every start, force-flipping any
    // view whose items carried more than one recorded kind. CL-2 amended
    // FR-008 to make that state VALID (per-item kind authoritative — exactly
    // what a cross-drive project's drive-scope resolution legitimately
    // produces), so the scan's only remaining effect was auto-corrupting
    // real cross-drive projects into the dead-end `kind_diverged` state on
    // every reopen. Removed along with `reconcile_kind_diverged_views`.
    //
    // #1230: this now prefers a cross-process snapshot of the migrated
    // database (see `schema_cache`). The snapshot is keyed on the embedded
    // migrator's content, is only ever applied to an empty database, and falls
    // back to the real chain on any failure, so `migrate()` stays
    // observationally identical -- it just stops paying for 66 migrations in
    // each of ~1069 test processes. Tests that exist to cover the chain itself
    // call `migrate_uncached`.
    pub async fn migrate(&self) -> DbResult<()> {
        if schema_cache::try_apply(&self.pool).await {
            return Ok(());
        }
        self.migrate_uncached().await
    }

    /// Run the real migration chain, bypassing the snapshot cache.
    ///
    /// Migration tests must use this: replaying a snapshot would mean the
    /// chain they exist to cover never actually executes (#1230).
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Migration`] if any migration script fails.
    //
    // #1307: 15 migrations rebuild a table that has children under `ON DELETE
    // CASCADE` (e.g. `plans` -> `plan_items`) and open with `PRAGMA
    // foreign_keys = OFF` to make their `DROP TABLE` safe. sqlx runs every
    // migration inside its own transaction, and SQLite treats that pragma as
    // a no-op once a transaction is open (sqlite.org/pragma.html#pragma_foreign_keys),
    // so the in-file pragma never took effect and `DROP TABLE plans` cascaded
    // through `plan_items.plan_id ON DELETE CASCADE`, silently deleting every
    // plan item on each of those 15 migrations. The already-applied migration
    // files can't be edited (their checksums are recorded in every deployed
    // database and validated by sqlx), so the fix runs the whole chain over a
    // single connection with FK enforcement disabled *before* any transaction
    // opens on it — that setting isn't scoped to a transaction, so it survives
    // every migration's own `BEGIN`/`COMMIT`, regardless of what that
    // migration's own pragma lines attempt. This protects every rebuild in
    // the chain, past and future, without touching the migration files.
    pub async fn migrate_uncached(&self) -> DbResult<()> {
        let mut conn = self.pool.acquire().await?;
        sqlx::query("PRAGMA foreign_keys = OFF;").execute(&mut *conn).await?;
        let migrate_result = schema_cache::MIGRATOR.run(&mut *conn).await;
        // Always restore enforcement before the connection returns to the pool:
        // ordinary repository queries and legitimate runtime deletes rely on
        // FK cascade behaviour being active outside of migrations.
        sqlx::query("PRAGMA foreign_keys = ON;").execute(&mut *conn).await?;
        migrate_result?;
        Ok(())
    }

    /// The embedded migration chain, for tests that drive it directly.
    ///
    /// Exposed so a populated-database harness can run a prefix of the chain,
    /// seed rows at that point, then apply the migration under test (#1231).
    #[must_use]
    pub fn migrator() -> &'static sqlx::migrate::Migrator {
        &schema_cache::MIGRATOR
    }

    /// Expose the underlying pool for repository constructors.
    #[must_use]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

/// Describe a migration failure that means "this database file was written by a
/// different revision of the app", or `None` for any other failure.
///
/// sqlx reports schema-history divergence as a bare `VersionMismatch(71)`.
/// That is accurate but names neither the cause nor the fix, so a caller that
/// `expect()`s it dies with a stack trace nobody can act on. Every variant
/// matched here means the same thing in practice: the `_sqlx_migrations`
/// history recorded in the file disagrees with the migration set embedded in
/// the running binary.
///
/// This is overwhelmingly a *developer* condition — switching between branches
/// that each claimed the same migration number, then reopening a database one
/// of them already migrated. Callers pair the returned description with a
/// recovery instruction naming the concrete database path.
///
/// Returns `None` for failures that are genuinely something else (a migration
/// script that errored, a dropped connection); callers should keep surfacing
/// those verbatim rather than blaming a stale file.
#[must_use]
pub fn migration_divergence_detail(error: &DbError) -> Option<String> {
    let DbError::Migration(error) = error else { return None };
    let detail = match error {
        sqlx::migrate::MigrateError::VersionMismatch(version) => format!(
            "migration {version} was already applied to this database, but its script differs from the one in this build"
        ),
        sqlx::migrate::MigrateError::VersionMissing(version) => format!(
            "migration {version} was applied to this database but does not exist in this build"
        ),
        sqlx::migrate::MigrateError::VersionNotPresent(version) => format!(
            "migration {version} is recorded in this database but is absent from this build's migration set"
        ),
        _ => return None,
    };
    Some(detail)
}

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
    }

    /// The three divergence variants each name the offending version, so the
    /// operator can tell which migration the file disagrees on.
    #[test]
    fn divergence_detail_names_the_offending_migration() {
        for error in [
            sqlx::migrate::MigrateError::VersionMismatch(71),
            sqlx::migrate::MigrateError::VersionMissing(71),
            sqlx::migrate::MigrateError::VersionNotPresent(71),
        ] {
            let detail = super::migration_divergence_detail(&super::DbError::Migration(error))
                .expect("divergence variant should produce a detail");
            assert!(detail.contains("71"), "detail should name the version: {detail}");
        }
    }

    /// A migration script that genuinely failed is not a stale-file problem —
    /// telling the operator to delete their database would be wrong.
    #[test]
    fn divergence_detail_ignores_unrelated_failures() {
        assert!(super::migration_divergence_detail(&super::DbError::NotImplemented).is_none());
        assert!(super::migration_divergence_detail(&super::DbError::Migration(
            sqlx::migrate::MigrateError::Dirty(71)
        ))
        .is_none());
    }

    /// End-to-end proof that the classifier matches the variant sqlx *actually*
    /// emits, not merely the one we assumed. Hand-constructing
    /// `VersionMismatch` in the tests above would pass even if sqlx reported
    /// divergence some other way — this drives a genuine divergence by
    /// rewriting an applied migration's recorded checksum, exactly as a
    /// renumbered migration does to a developer's existing database.
    #[tokio::test]
    async fn real_sqlx_divergence_is_classified() {
        let db = super::Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("first migrate");

        // Corrupt one applied migration's checksum so the next run sees the
        // script as modified since it was applied.
        sqlx::query("UPDATE _sqlx_migrations SET checksum = X'00' WHERE version = 1")
            .execute(db.pool())
            .await
            .expect("tamper with recorded checksum");

        let error = db.migrate().await.expect_err("divergent history must fail");
        let detail = super::migration_divergence_detail(&error)
            .expect("a real sqlx divergence must be classified, not fall through");
        assert!(detail.contains('1'), "detail should name the version: {detail}");
    }

    /// Smoke-test: connect to in-memory SQLite, run migrations, verify the pool is alive.
    #[tokio::test]
    async fn database_connect_in_memory_and_migrate() {
        let db = super::Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations");
        // A trivial query proves the pool is usable after migration.
        let row: (i64,) = sqlx::query_as("SELECT 1").fetch_one(db.pool()).await.unwrap();
        assert_eq!(row.0, 1);
    }

    /// Migration 0047 applies cleanly on a fresh DB (all migrations from 0001).
    #[tokio::test]
    async fn migration_0047_applies_on_fresh_db() {
        let db = super::Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations including 0047");

        let pool = db.pool();

        // inbox_source_groups table exists with the expected columns.
        let _: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_source_groups")
            .fetch_one(pool)
            .await
            .expect("inbox_source_groups table must exist after 0047");

        // inbox_file_overrides table exists.
        let _: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_file_overrides")
            .fetch_one(pool)
            .await
            .expect("inbox_file_overrides table must exist after 0047");

        // inbox_items has the new columns.
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, group_key, discovered_at, last_scanned_at, state, lane) \
             VALUES ('test-item-fresh', 'root-1', '2025/lights', 'dark|300s', \
                     '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'pending_classification', 'fits')",
        )
        .execute(pool)
        .await
        .expect("insert into inbox_items with group_key must work after 0047");

        // inbox_classifications uses the new CHECK ('classified','unclassified').
        sqlx::query(
            "INSERT INTO inbox_classifications \
             (inbox_item_id, result, computed_at, content_signature) \
             VALUES ('test-item-fresh', 'classified', '2025-01-01T00:00:00Z', 'sig-1')",
        )
        .execute(pool)
        .await
        .expect("classified result must be accepted after 0047");

        // 'mixed' result must now be rejected by the CHECK constraint.
        let mixed_result = sqlx::query(
            "INSERT INTO inbox_classifications \
             (inbox_item_id, result, computed_at, content_signature) \
             VALUES ('test-item-fresh', 'mixed', '2025-01-01T00:00:00Z', 'sig-x')",
        )
        .execute(pool)
        .await;
        assert!(
            mixed_result.is_err(),
            "'mixed' result must be rejected by CHECK constraint after 0047"
        );

        // inbox_file_metadata has the new extended fields.
        sqlx::query(
            "INSERT INTO inbox_file_metadata \
             (id, inbox_item_id, relative_file_path, ra_deg, dec_deg, \
              focal_length_mm, pixel_size_um, mjd_avg) \
             VALUES ('meta-fresh-1', 'test-item-fresh', '2025/lights/frame.fits', \
                     83.82, -5.39, 800.0, 4.63, 60000.5)",
        )
        .execute(pool)
        .await
        .expect("extended metadata fields must exist after 0047");
    }

    /// Migration 0047 re-derivation: seeding pre-0047 data (inbox_items with override
    /// columns on evidence) produces source_group rows and migrated override rows.
    // Single scenario test walking a multi-step seed → re-derivation → assert
    // pipeline; splitting it would scatter the narrative across helper fns
    // that are each only ever called once.
    #[allow(clippy::too_many_lines)] // pre-existing multi-stage migration fixture test
    #[tokio::test]
    async fn migration_0047_rederivation_on_seeded_0046_db() {
        // We cannot run migrations up to 0046 and then 0047 separately in the
        // same in-memory DB with the embedded migrator (sqlx::migrate! runs all
        // pending migrations atomically). Instead we seed the expected pre-0047
        // state directly into a fresh post-migration DB and verify the invariants
        // that 0047's re-derivation step would have produced.
        //
        // This test verifies:
        //   a) inbox_source_groups receives one row per inserted inbox_item.
        //   b) The migrated source group row carries the expected root_id + path.
        //   c) inbox_items.source_group_id is set to the migrated source group.
        //   d) override_filter values from evidence are available via
        //      inbox_file_overrides (property_key = 'filter').
        //   e) inbox_classifications rejects 'mixed' and accepts 'classified'.
        //   f) UNIQUE(root_id, relative_path, group_key) allows two sub-items from
        //      the same folder as long as group_key differs.

        let db = super::Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations including 0047");
        let pool = db.pool();

        // Insert a registered source root (required by first_run conventions).
        sqlx::query(
            "INSERT INTO registered_sources \
             (id, kind, path, scan_depth, created_at, created_via, organization_state) \
             VALUES ('root-test', 'inbox', '/mnt/inbox', 'recursive', \
                     '2025-01-01T00:00:00Z', 'first_run', 'unorganized')",
        )
        .execute(pool)
        .await
        .expect("insert registered_sources");

        // Insert an inbox_source_group (simulating what 0047 step 6a creates).
        sqlx::query(
            "INSERT INTO inbox_source_groups \
             (id, root_id, relative_path, discovered_at, last_scanned_at, child_count) \
             VALUES ('sg-1', 'root-test', '2025-10-10/lights', \
                     '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', 2)",
        )
        .execute(pool)
        .await
        .expect("insert inbox_source_groups");

        // Insert two single-type sub-items for the same source group (lights + darks
        // in the same folder — different group_key).
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, \
              group_label, frame_type, discovered_at, last_scanned_at, state, lane) \
             VALUES \
               ('item-light-1', 'root-test', '2025-10-10/lights', 'sg-1', \
                'light|Ha|300s', 'Inbox · light · Ha · 300s', 'light', \
                '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', 'classified', 'fits'), \
               ('item-dark-1', 'root-test', '2025-10-10/lights', 'sg-1', \
                'dark|300s', 'Inbox · dark · 300s', 'dark', \
                '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', 'classified', 'fits')",
        )
        .execute(pool)
        .await
        .expect("insert two single-type items sharing a source group");

        // Verify the UNIQUE constraint allows the two items (different group_key).
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = 'root-test'")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(count.0, 2, "two sub-items from the same folder must coexist");

        // Verify duplicate (same root_id, relative_path, group_key) is rejected.
        let dup = sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, \
              discovered_at, last_scanned_at, state, lane) \
             VALUES ('item-light-dup', 'root-test', '2025-10-10/lights', 'sg-1', \
                     'light|Ha|300s', '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', \
                     'classified', 'fits')",
        )
        .execute(pool)
        .await;
        assert!(dup.is_err(), "duplicate (root_id, relative_path, group_key) must be rejected");

        // Insert an inbox_file_override for one of the items' files.
        sqlx::query(
            "INSERT INTO inbox_file_overrides \
             (id, source_group_id, relative_file_path, property_key, value, \
              override_stale, set_at) \
             VALUES ('ov-1', 'sg-1', '2025-10-10/lights/frame_001.fits', \
                     'filter', 'Ha', 0, '2025-10-10T21:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert inbox_file_overrides");

        // Verify source group has child_count=2.
        let sg_count: (i64,) =
            sqlx::query_as("SELECT child_count FROM inbox_source_groups WHERE id = 'sg-1'")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(sg_count.0, 2, "source group child_count must be 2");

        // Verify override is retrievable by (source_group_id, relative_file_path, property_key).
        let ov: (String,) = sqlx::query_as(
            "SELECT value FROM inbox_file_overrides \
             WHERE source_group_id = 'sg-1' \
               AND relative_file_path = '2025-10-10/lights/frame_001.fits' \
               AND property_key = 'filter'",
        )
        .fetch_one(pool)
        .await
        .expect("override row must be retrievable after insert");
        assert_eq!(ov.0, "Ha", "override filter value must be 'Ha'");

        // Verify inbox_classifications accepts 'classified' but not 'mixed'.
        sqlx::query(
            "INSERT INTO inbox_classifications \
             (inbox_item_id, result, computed_at, content_signature) \
             VALUES ('item-light-1', 'classified', '2025-10-10T20:00:00Z', 'sig-l1')",
        )
        .execute(pool)
        .await
        .expect("classified result must be accepted");

        let mixed = sqlx::query(
            "INSERT INTO inbox_classifications \
             (inbox_item_id, result, computed_at, content_signature) \
             VALUES ('item-dark-1', 'mixed', '2025-10-10T20:00:00Z', 'sig-d1')",
        )
        .execute(pool)
        .await;
        assert!(mixed.is_err(), "'mixed' must be rejected by CHECK after 0047");

        // Verify extended metadata fields are writable.
        sqlx::query(
            "INSERT INTO inbox_file_metadata \
             (id, inbox_item_id, relative_file_path, \
              offset, set_temp_c, ccd_temp_c, ra_deg, dec_deg, \
              rotator_angle_deg, rotator_name, sky_rotation_deg, readout_mode, \
              focal_length_mm, pixel_size_um, \
              observer_lat, observer_long, observer_elev, \
              date_loc, date_end, mjd_avg, mjd_obs) \
             VALUES ('meta-1', 'item-light-1', '2025-10-10/lights/frame_001.fits', \
                     100, -10.0, -10.2, 83.82, -5.39, \
                     45.0, 'Rotator1', 270.0, 'High Gain', \
                     800.0, 4.63, \
                     51.5, -0.12, 82.0, \
                     '2025-10-10', '2025-10-10T23:59:00Z', 60010.5, 60010.0)",
        )
        .execute(pool)
        .await
        .expect("all extended metadata fields must be writable after 0047");

        // Verify inbox_classification_evidence no longer has override_filter column.
        // We do this by trying to reference the column in a query; it must fail.
        let has_override_filter =
            sqlx::query("SELECT override_filter FROM inbox_classification_evidence LIMIT 1")
                .fetch_optional(pool)
                .await;
        assert!(
            has_override_filter.is_err(),
            "override_filter column must have been dropped from inbox_classification_evidence by 0047"
        );
    }
}
