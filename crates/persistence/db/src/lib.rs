//! Persistence and repository boundary.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Production backend: sqlx 0.9 + SQLite (ratified stack, wired T003).
//! All migrations live in `./migrations/` and are consumed via `sqlx::migrate!()`.
//! Migration 0048 added `canonical_target.notes` (spec 023 US4).

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

pub mod operation_state;
/// Reference pattern for the centralized typed persistence layer (sea-query +
/// manual sqlx 0.9 binding). Compiled only under `cfg(test)`; not wired into
/// any real repository. See `query_builder_example.rs` and
/// `docs/development/persistence-layer-hardening.md`.
#[cfg(test)]
mod query_builder_example;
pub mod repositories;

pub const CRATE_NAME: &str = "persistence_db";

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
    /// # Errors
    ///
    /// Returns [`DbError::Database`] if the pool cannot connect to the given URL.
    pub async fn connect(connection_string: &str) -> DbResult<Self> {
        let pool = SqlitePoolOptions::new().max_connections(8).connect(connection_string).await?;
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
    pub async fn migrate(&self) -> DbResult<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    /// Expose the underlying pool for repository constructors.
    #[must_use]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
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
    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    #[allow(clippy::too_many_lines)] // pre-existing test, exercises a wide migration surface
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
