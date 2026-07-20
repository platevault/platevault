// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0045 integration tests (spec 041, T003).
#![allow(clippy::doc_markdown)]
//!
//! Asserts:
//!   - Migration applies on a fresh in-memory DB without error.
//!   - Backfill: a seeded non-inbox source receives organization_state = 'organized'.
//!   - Backfill: a seeded inbox source receives organization_state = 'unorganized'.
//!   - inbox_file_metadata table exists and enforces the unique constraint.
//!   - inbox_classification_evidence has the new override columns.
//!   - plan_items accepts 'catalogue' as a valid action value.

mod common;

use persistence_db::Database;
use uuid::Uuid;

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

async fn setup() -> Database {
    let db = Database::in_memory().await.expect("in-memory db");
    // Uncached: this file exists to cover the migration chain, so replaying a
    // schema snapshot would mean the thing under test never ran (#1230).
    db.migrate_uncached().await.expect("migrations should apply cleanly");
    db
}

/// A database migrated to 0044 -- the last version before 0045.
async fn setup_pre_0045() -> Database {
    common::migrated_to(44).await
}

/// Seed a registered_source row with the given kind (bypassing the ORM so we
/// can control pre-migration shape). organization_state is NOT set — that is
/// what the migration backfill should establish.
async fn seed_source(pool: &sqlx::SqlitePool, id: &str, kind: &str) {
    sqlx::query(
        "INSERT INTO registered_sources \
         (id, kind, path, scan_depth, created_at, created_via) \
         VALUES (?, ?, ?, 'recursive', '2026-06-01T00:00:00Z', 'first_run')",
    )
    .bind(id)
    .bind(kind)
    .bind(format!("/astro/{id}"))
    .execute(pool)
    .await
    .expect("seed registered_source");
}

// ── Migration applies cleanly ─────────────────────────────────────────────────

#[tokio::test]
async fn migration_0045_applies_on_fresh_db() {
    // setup() already calls migrate(); reaching here means it succeeded.
    let _db = setup().await;
}

// ── Backfill: non-inbox → organized, inbox → unorganized ─────────────────────

/// The backfill is exercised by running migration 0045 against rows that
/// existed before it (#1231).
///
/// These tests used to seed a fully-migrated database and then run a
/// hand-copied duplicate of the migration's own UPDATE, which meant they
/// asserted only that SQLite executes a CASE expression -- they passed
/// regardless of what 0045 did, and would still have passed if 0045 were
/// deleted outright.
#[tokio::test]
async fn backfill_sets_organization_state_from_source_kind() {
    let db = setup_pre_0045().await;

    let inbox_id = new_id();
    let light_id = new_id();
    seed_source(db.pool(), &inbox_id, "inbox").await;
    seed_source(db.pool(), &light_id, "light_frames").await;

    // The column does not exist yet, so these rows are genuinely pre-0045.
    let pre_existing: Result<(String,), _> =
        sqlx::query_as("SELECT organization_state FROM registered_sources WHERE id = ?")
            .bind(&inbox_id)
            .fetch_one(db.pool())
            .await;
    assert!(
        pre_existing.is_err(),
        "organization_state must not exist before 0045, or this test is not testing the backfill"
    );

    common::migrate_through(&db, 45).await;

    let state_of = async |id: &str| -> String {
        sqlx::query_as::<_, (String,)>(
            "SELECT organization_state FROM registered_sources WHERE id = ?",
        )
        .bind(id)
        .fetch_one(db.pool())
        .await
        .expect("fetch organization_state")
        .0
    };

    assert_eq!(
        state_of(&inbox_id).await,
        "unorganized",
        "0045 must backfill a pre-existing inbox source to 'unorganized'"
    );
    assert_eq!(
        state_of(&light_id).await,
        "organized",
        "0045 must backfill a pre-existing non-inbox source to 'organized'"
    );
}

// ── inbox_file_metadata table exists ─────────────────────────────────────────

#[tokio::test]
async fn inbox_file_metadata_table_exists_and_unique_constraint_enforced() {
    let db = setup().await;

    // We need a parent inbox_items row. Seed the minimum required rows.
    let source_id = new_id();
    seed_source(db.pool(), &source_id, "inbox").await;

    let item_id = new_id();
    sqlx::query(
        "INSERT INTO inbox_items \
         (id, root_id, relative_path, file_count, lane, state, \
          discovered_at, last_scanned_at) \
         VALUES (?, ?, 'session_2026', 10, 'fits', 'pending_classification', \
                 '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')",
    )
    .bind(&item_id)
    .bind(&source_id)
    .execute(db.pool())
    .await
    .expect("seed inbox_item");

    // Insert a metadata row.
    let meta_id = new_id();
    sqlx::query(
        "INSERT INTO inbox_file_metadata \
         (id, inbox_item_id, relative_file_path, filter, exposure_s) \
         VALUES (?, ?, 'session_2026/frame_001.fits', 'Lum', 120.0)",
    )
    .bind(&meta_id)
    .bind(&item_id)
    .execute(db.pool())
    .await
    .expect("insert inbox_file_metadata");

    // Duplicate (inbox_item_id, relative_file_path) must fail.
    let dup_result = sqlx::query(
        "INSERT INTO inbox_file_metadata \
         (id, inbox_item_id, relative_file_path) \
         VALUES (?, ?, 'session_2026/frame_001.fits')",
    )
    .bind(new_id())
    .bind(&item_id)
    .execute(db.pool())
    .await;

    assert!(dup_result.is_err(), "duplicate (inbox_item_id, relative_file_path) must be rejected");
}

// ── inbox_classification_evidence has override_stale column ──────────────────
//
// Migration 0045 originally added four override columns to
// inbox_classification_evidence. Migration 0048 migrated the three non-type
// columns (override_filter, override_exposure_s, override_binning) to the new
// inbox_file_overrides table and dropped them. Only override_stale remains on
// the evidence row (it is a per-file staleness flag used by the UI).

#[tokio::test]
async fn inbox_classification_evidence_has_override_columns() {
    let db = setup().await;

    // Verify that override_stale is present and the three dropped columns are gone.
    let cols: Vec<(String,)> = sqlx::query_as(
        "SELECT name FROM pragma_table_info('inbox_classification_evidence') \
         WHERE name IN ('override_filter', 'override_exposure_s', 'override_binning', 'override_stale') \
         ORDER BY name",
    )
    .fetch_all(db.pool())
    .await
    .expect("pragma_table_info");

    let names: Vec<&str> = cols.iter().map(|(n,)| n.as_str()).collect();
    // override_stale is retained on the evidence row (staleness flag).
    assert!(names.contains(&"override_stale"), "override_stale column missing");
    // The three non-type override columns were migrated to inbox_file_overrides by 0048.
    assert!(
        !names.contains(&"override_filter"),
        "override_filter must have been dropped from evidence by migration 0048"
    );
    assert!(
        !names.contains(&"override_exposure_s"),
        "override_exposure_s must have been dropped from evidence by migration 0048"
    );
    assert!(
        !names.contains(&"override_binning"),
        "override_binning must have been dropped from evidence by migration 0048"
    );
    assert_eq!(names.len(), 1, "expected exactly 1 override column remaining on evidence");
}

// ── plan_items accepts 'catalogue' action ─────────────────────────────────────

#[tokio::test]
async fn plan_items_accepts_catalogue_action() {
    let db = setup().await;

    // Seed a minimal plans row.
    // Column names and CHECK values from migration 0029.
    let plan_id = new_id();
    sqlx::query(
        "INSERT INTO plans \
         (id, number, title, origin, state, plan_type, destructive_destination, created_at) \
         VALUES (?, 1, 'test plan', 'cleanup', 'ready_for_review', 'cleanup', \
                 'archive', '2026-06-01T00:00:00Z')",
    )
    .bind(&plan_id)
    .execute(db.pool())
    .await
    .expect("seed plan");

    // Insert a catalogue action item — would have been rejected before 0045.
    let result = sqlx::query(
        "INSERT INTO plan_items \
         (id, plan_id, item_index, name, action, from_relative_path, to_relative_path, \
          created_at) \
         VALUES (?, ?, 1, 'catalogue in place', 'catalogue', 'session/f.fits', \
                 'session/f.fits', '2026-06-01T00:00:00Z')",
    )
    .bind(new_id())
    .bind(&plan_id)
    .execute(db.pool())
    .await;

    assert!(result.is_ok(), "plan_items should accept 'catalogue' action after migration 0045");
}
