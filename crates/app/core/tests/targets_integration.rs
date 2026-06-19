#![allow(clippy::doc_markdown)]
//! Layer-1 integration tests for target lookup (US #12) and target
//! identity/history/notes (US #13) — feature 037 (T008).
//!
//! Uses the real in-memory SQLite backend (all migrations applied) via the
//! shared `support::setup()` harness. No mocks.

mod support;

use contracts_core::target_lookup::{ResolveStatus, TargetLookupRequest, TargetResolveRequest};
use contracts_core::targets::{
    TargetAliasAddRequest, TargetAliasRemoveRequest, TargetNoteUpdateRequest,
    TargetPrimaryRenameRequest,
};
use persistence_db::repositories::targets::{upsert_catalog_ref, upsert_target};
use persistence_db::repositories::targets::{CatalogRefRow, TargetRow};
use targeting::identity::target_id as make_target_id;
use uuid::Uuid;

// ── Seed helpers ──────────────────────────────────────────────────────────────

/// Seed a `targets` row (spec 013 table) with a Messier designation.
/// Returns the UUID string used as the row id.
async fn seed_target(pool: &sqlx::SqlitePool, designation: &str) -> String {
    let id = make_target_id("messier", designation).to_string();
    upsert_target(
        pool,
        &TargetRow {
            id: id.clone(),
            primary_designation: designation.to_owned(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            notes: None,
            updated_at: None,
        },
    )
    .await
    .expect("upsert_target failed");
    id
}

/// Seed a `target_catalog_refs` row so the in-memory catalog can resolve it.
async fn seed_catalog_ref(
    pool: &sqlx::SqlitePool,
    target_id: &str,
    catalog_id: &str,
    catalog_display: &str,
    designation: &str,
) {
    upsert_catalog_ref(
        pool,
        &CatalogRefRow {
            target_id: target_id.to_owned(),
            catalog_id: catalog_id.to_owned(),
            catalog_display: catalog_display.to_owned(),
            designation: designation.to_owned(),
        },
    )
    .await
    .expect("upsert_catalog_ref failed");
}

// ── US #12: target lookup from FITS OBJECT ────────────────────────────────────

/// TC-12.1: `target.resolve` resolves an exact FITS OBJECT value ("M 31") to
/// the seeded target and returns `resolved` status with the correct
/// `primary_designation`.
#[tokio::test]
async fn resolve_exact_fits_object_returns_resolved() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "M 31").await;
    seed_catalog_ref(pool, &tid, "messier", "Messier", "M31").await;

    // Build the in-memory catalog from the SQLite rows.
    let catalog = targeting::load::load_from_db(pool).await.expect("load_from_db failed");

    let resp = app_core::target_lookup::resolve(
        &catalog,
        &TargetResolveRequest {
            contract_version: "1.0".to_owned(),
            request_id: Uuid::new_v4().to_string(),
            // Exact catalog designation as it appears in a FITS OBJECT header.
            fits_object_value: "M31".to_owned(),
        },
    );

    assert_eq!(
        resp.status,
        ResolveStatus::Resolved,
        "expected Resolved, got {:?}; errors: {:?}",
        resp.status,
        resp.errors
    );
    assert_eq!(
        resp.primary_designation.as_deref(),
        Some("M 31"),
        "primary_designation mismatch: {resp:?}"
    );
    assert_eq!(resp.target_id.as_deref(), Some(tid.as_str()), "target_id mismatch: {resp:?}");
}

/// TC-12.2: `target.lookup` returns at least one high-confidence match when
/// queried with the NGC designation of a target that also has a Messier ref.
/// Verifies cross-catalog equivalence: the same `target_id` is returned
/// whether matched by "M31" or "NGC 224".
#[tokio::test]
async fn lookup_cross_catalog_designations_return_same_target() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "M 31").await;
    seed_catalog_ref(pool, &tid, "messier", "Messier", "M31").await;
    seed_catalog_ref(pool, &tid, "openngc", "OpenNGC", "NGC 224").await;

    let catalog = targeting::load::load_from_db(pool).await.expect("load_from_db failed");
    let req_id = Uuid::new_v4().to_string();

    let by_messier = app_core::target_lookup::lookup(
        &catalog,
        &TargetLookupRequest {
            contract_version: "1.0".to_owned(),
            request_id: req_id.clone(),
            query: "M31".to_owned(),
            limit: 5,
        },
    );
    let by_ngc = app_core::target_lookup::lookup(
        &catalog,
        &TargetLookupRequest {
            contract_version: "1.0".to_owned(),
            request_id: req_id,
            query: "NGC 224".to_owned(),
            limit: 5,
        },
    );

    let messier_matches = by_messier.matches.expect("expected matches for M31");
    let ngc_matches = by_ngc.matches.expect("expected matches for NGC 224");

    assert!(!messier_matches.is_empty(), "no matches for M31");
    assert!(!ngc_matches.is_empty(), "no matches for NGC 224");

    assert_eq!(
        messier_matches[0].target_id, ngc_matches[0].target_id,
        "M31 and NGC 224 resolved to different target IDs; expected the same target"
    );
    assert_eq!(messier_matches[0].target_id, tid);
}

/// TC-12.3: `target.resolve` returns `error` with `catalog.not_installed` code
/// when the catalog is empty (first-run, no catalog downloaded yet).
/// This is the non-blocking sentinel per spec 013 R8: the ingestion pipeline
/// treats this outcome as a non-fatal skip, not a hard failure.
#[tokio::test]
async fn resolve_empty_catalog_returns_not_installed_error() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    // No targets seeded — catalog stays empty.
    let catalog = targeting::load::load_from_db(pool).await.expect("load_from_db failed");
    assert!(catalog.is_empty(), "expected empty catalog");

    let resp = app_core::target_lookup::resolve(
        &catalog,
        &TargetResolveRequest {
            contract_version: "1.0".to_owned(),
            request_id: Uuid::new_v4().to_string(),
            fits_object_value: "M31".to_owned(),
        },
    );

    assert_eq!(
        resp.status,
        ResolveStatus::Error,
        "expected Error (catalog.not_installed) on empty catalog, got {:?}",
        resp.status
    );
    let errors = resp.errors.expect("expected errors field on Error response");
    assert!(
        errors.iter().any(|e| e.code == "catalog.not_installed"),
        "expected catalog.not_installed error code, got {errors:?}"
    );
}

// ── US #13: target identity / history / notes ─────────────────────────────────

/// TC-13.1: `target_get` returns full identity (id, primary_designation, notes,
/// aliases) after seeding the target and two aliases.
#[tokio::test]
async fn target_get_returns_identity_with_aliases() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "M 31").await;

    // Add two aliases via the use case.
    app_core::target_identity::target_alias_add(
        pool,
        TargetAliasAddRequest { target_id: tid.clone(), alias: "Andromeda Galaxy".to_owned() },
    )
    .await
    .expect("alias_add Andromeda Galaxy failed");

    app_core::target_identity::target_alias_add(
        pool,
        TargetAliasAddRequest { target_id: tid.clone(), alias: "NGC 224".to_owned() },
    )
    .await
    .expect("alias_add NGC 224 failed");

    let result =
        app_core::target_identity::target_get(pool, &tid).await.expect("target_get failed");

    assert_eq!(result.target.id, tid, "id mismatch");
    assert_eq!(result.target.primary_designation, "M 31");
    assert!(
        result.target.aliases.contains(&"Andromeda Galaxy".to_owned()),
        "missing 'Andromeda Galaxy' in aliases: {:?}",
        result.target.aliases
    );
    assert!(
        result.target.aliases.contains(&"NGC 224".to_owned()),
        "missing 'NGC 224' in aliases: {:?}",
        result.target.aliases
    );
}

/// TC-13.2: `target_note_update` persists a note and `target_get` reads it
/// back. Then clearing the note via an empty string stores `None`.
#[tokio::test]
async fn note_update_persists_and_clears() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "M 101").await;

    // Write a note.
    let update_result = app_core::target_identity::target_note_update(
        pool,
        TargetNoteUpdateRequest {
            target_id: tid.clone(),
            content: "Face-on spiral; good Ha target".to_owned(),
        },
    )
    .await
    .expect("target_note_update failed");

    assert!(!update_result.updated_at.is_empty(), "updated_at should be set");

    // Read back.
    let detail =
        app_core::target_identity::target_get(pool, &tid).await.expect("target_get failed");
    assert_eq!(
        detail.target.notes.as_deref(),
        Some("Face-on spiral; good Ha target"),
        "note not persisted: {:?}",
        detail.target.notes
    );

    // Clear the note.
    app_core::target_identity::target_note_update(
        pool,
        TargetNoteUpdateRequest { target_id: tid.clone(), content: String::new() },
    )
    .await
    .expect("clear note failed");

    let after_clear =
        app_core::target_identity::target_get(pool, &tid).await.expect("target_get after clear");
    assert!(
        after_clear.target.notes.is_none(),
        "note should be None after clear, got {:?}",
        after_clear.target.notes
    );
}

/// TC-13.3: `target_alias_add` + `target_alias_remove` round-trip: alias is
/// present after add and absent after remove. Primary designation is protected
/// from removal.
#[tokio::test]
async fn alias_add_remove_round_trip_and_primary_guard() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "NGC 7000").await;

    // Add alias.
    let add_result = app_core::target_identity::target_alias_add(
        pool,
        TargetAliasAddRequest { target_id: tid.clone(), alias: "North America Nebula".to_owned() },
    )
    .await
    .expect("alias_add failed");
    assert!(add_result.added, "expected added=true on first add");

    // Confirm alias visible via target_get.
    let detail = app_core::target_identity::target_get(pool, &tid).await.unwrap();
    assert!(
        detail.target.aliases.contains(&"North America Nebula".to_owned()),
        "alias missing after add: {:?}",
        detail.target.aliases
    );

    // Remove alias.
    app_core::target_identity::target_alias_remove(
        pool,
        TargetAliasRemoveRequest {
            target_id: tid.clone(),
            alias: "North America Nebula".to_owned(),
        },
    )
    .await
    .expect("alias_remove failed");

    // Confirm alias gone.
    let after_remove = app_core::target_identity::target_get(pool, &tid).await.unwrap();
    assert!(
        !after_remove.target.aliases.contains(&"North America Nebula".to_owned()),
        "alias still present after remove: {:?}",
        after_remove.target.aliases
    );

    // Removing the primary designation must be rejected.
    let primary_remove_err = app_core::target_identity::target_alias_remove(
        pool,
        TargetAliasRemoveRequest { target_id: tid.clone(), alias: "NGC 7000".to_owned() },
    )
    .await
    .expect_err("expected alias.is_primary error when removing primary");
    assert_eq!(
        primary_remove_err.code, "alias.is_primary",
        "wrong error code: {primary_remove_err:?}"
    );
}

/// TC-13.4: `target_primary_rename` swaps primary and alias in the DB. The
/// prior primary appears as an alias afterwards and the note is preserved
/// across the rename (T026 survival test).
#[tokio::test]
async fn primary_rename_swaps_and_note_survives() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let tid = seed_target(pool, "M 31").await;

    // Write a note before the rename.
    app_core::target_identity::target_note_update(
        pool,
        TargetNoteUpdateRequest {
            target_id: tid.clone(),
            content: "Narrowband imaging site".to_owned(),
        },
    )
    .await
    .expect("note_update failed");

    // Add "Andromeda Galaxy" as an alias so it can be promoted.
    app_core::target_identity::target_alias_add(
        pool,
        TargetAliasAddRequest { target_id: tid.clone(), alias: "Andromeda Galaxy".to_owned() },
    )
    .await
    .expect("alias_add failed");

    // Promote it to primary.
    let rename_result = app_core::target_identity::target_primary_rename(
        pool,
        TargetPrimaryRenameRequest {
            target_id: tid.clone(),
            new_primary_designation: "Andromeda Galaxy".to_owned(),
        },
    )
    .await
    .expect("target_primary_rename failed");

    assert_eq!(rename_result.prior_primary, "M 31");
    assert_eq!(rename_result.new_primary, "Andromeda Galaxy");

    // Assert via target_get.
    let detail = app_core::target_identity::target_get(pool, &tid).await.unwrap();
    assert_eq!(detail.target.primary_designation, "Andromeda Galaxy");
    assert!(
        detail.target.aliases.contains(&"M 31".to_owned()),
        "prior primary 'M 31' should now be an alias: {:?}",
        detail.target.aliases
    );
    assert!(
        !detail.target.aliases.contains(&"Andromeda Galaxy".to_owned()),
        "'Andromeda Galaxy' should no longer be in aliases after promotion"
    );

    // Note must survive the rename.
    assert_eq!(
        detail.target.notes.as_deref(),
        Some("Narrowband imaging site"),
        "note lost after primary rename: {:?}",
        detail.target.notes
    );
}
