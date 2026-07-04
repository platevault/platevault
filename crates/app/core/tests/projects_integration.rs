#![allow(clippy::doc_markdown)]
//! Layer-1 real-backend integration tests for feature 037 (T007/T008/T009).
//!
//! Covers:
//! - US7: `project_setup::create` / `get` round-trip (persisted fields).
//! - US8: project note add → update → read persistence.
//! - US9: manifest write → list → get round-trip.
//!
//! These tests use the shared `support` harness (real SQLite + migrations).
//! They do NOT duplicate scenarios already covered in:
//!   - `us1_coverage_smoke.rs` (projects list read-back, audit durability).
//!   - `project_setup.rs` inline tests (validation, auto-ready trigger, channels).
//!   - `project_manifests.rs` inline tests (manifest list ordering, pagination,
//!     notes snapshot embedding).

mod support;

use app_core::project_manifests::{self, WriteManifestParams};
use app_core::project_notes;
use app_core::project_setup;
use contracts_core::error_code::ErrorCode;
use contracts_core::manifests::{ManifestListRequest, ManifestReason, ProjectNoteUpdateRequest};
use contracts_core::projects_v2::ProjectCreateRequest;
use contracts_core::projects_v2::ProjectTool;
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

fn unique_name(prefix: &str) -> String {
    format!("{prefix}-{}", &Uuid::new_v4().to_string()[..8])
}

fn make_create_req(name: &str, tool: ProjectTool) -> ProjectCreateRequest {
    ProjectCreateRequest {
        request_id: Uuid::new_v4().to_string(),
        name: name.to_owned(),
        tool,
        path: format!("/library/projects/{name}"),
        initial_sources: vec![],
        notes: None,
        canonical_target_id: None,
    }
}

// ── US7: project_setup create → get round-trip ────────────────────────────────

/// Create a project and immediately fetch it back via `get`; assert every
/// persisted field matches the request values and the lifecycle starts as
/// `setup_incomplete` (no sources were linked).
#[tokio::test]
async fn create_then_get_returns_persisted_fields() {
    let (db, _repo, bus) = support::setup().await;

    let name = unique_name("M42");
    let req = ProjectCreateRequest {
        request_id: Uuid::new_v4().to_string(),
        name: name.clone(),
        tool: ProjectTool::PixInsight,
        path: format!("/library/projects/{name}"),
        initial_sources: vec![],
        notes: Some("Initial observing notes".to_owned()),
        canonical_target_id: None,
    };

    let result = project_setup::create(db.pool(), &bus, &req).await.expect("create must succeed");

    // Fresh project has no sources → lifecycle stays setup_incomplete.
    assert_eq!(
        result.lifecycle, "setup_incomplete",
        "lifecycle should be setup_incomplete with no sources"
    );
    // Constitution II: a folder-structure plan must always be returned.
    assert!(result.plan_id.is_some(), "create must return a plan_id");

    // Round-trip via get: assert all persisted fields.
    let detail = project_setup::get(db.pool(), &result.project_id)
        .await
        .expect("get must succeed after create");

    assert_eq!(detail.id, result.project_id);
    assert_eq!(detail.name, name, "persisted name must match request");
    assert_eq!(detail.tool, ProjectTool::PixInsight, "persisted tool must match request");
    assert_eq!(detail.lifecycle, "setup_incomplete");
    assert_eq!(
        detail.path,
        format!("/library/projects/{name}"),
        "persisted path must match request"
    );
    assert!(detail.sources.is_empty(), "no sources should be linked on create");
    assert!(detail.channels.is_empty(), "no channels inferred without sources");
    // notes field lives on the projects row; we pass it through the `notes` column.
    // The get DTO exposes notes via the summary row.
    // (The notes column is separate from project_notes table used by spec 024.)
}

/// Create two projects with the same name; the second must be rejected with
/// `name.duplicate`. This verifies the uniqueness constraint reaches the DB.
#[tokio::test]
async fn create_duplicate_name_is_rejected_at_db_layer() {
    let (db, _repo, bus) = support::setup().await;

    let name = unique_name("Orion");
    let req1 = make_create_req(&name, ProjectTool::PixInsight);
    project_setup::create(db.pool(), &bus, &req1).await.expect("first create must succeed");

    let req2 = ProjectCreateRequest {
        path: format!("/library/projects/{name}-2"), // different path
        ..make_create_req(&name, ProjectTool::PixInsight)
    };
    let err =
        project_setup::create(db.pool(), &bus, &req2).await.expect_err("duplicate name must fail");
    assert_eq!(err.code, ErrorCode::NameDuplicate);
}

/// `get` on a non-existent id returns an error (not a panic or empty result).
#[tokio::test]
async fn get_nonexistent_project_returns_error() {
    let (db, _repo, _bus) = support::setup().await;
    let bogus_id = Uuid::new_v4().to_string();
    let err =
        project_setup::get(db.pool(), &bogus_id).await.expect_err("get on missing id must fail");
    assert_eq!(err.code, ErrorCode::ProjectNotFound);
}

// ── US8: project notes add → update → read persistence ───────────────────────

/// Write a note, read it back; update with new content, read again.
/// Asserts the DB row is durably updated (not duplicated) on each upsert.
#[tokio::test]
async fn note_add_update_read_round_trip() {
    let (db, _repo, bus) = support::setup().await;

    // Create the project first (notes are associated by project_id).
    let name = unique_name("Crab");
    let req = make_create_req(&name, ProjectTool::PixInsight);
    let created = project_setup::create(db.pool(), &bus, &req).await.expect("create must succeed");
    let project_id = &created.project_id;

    // 1. Add a note.
    let add_req = ProjectNoteUpdateRequest {
        project_id: project_id.clone(),
        content: "First draft notes about the Crab Nebula session.".to_owned(),
    };
    let add_result = project_notes::update_note(db.pool(), &bus, add_req, None)
        .await
        .expect("first note write must succeed");
    assert_eq!(add_result.project_id, *project_id);
    assert!(!add_result.updated_at.is_empty(), "updated_at must be populated");

    // 2. Read back via persistence layer to confirm the row exists.
    let note_row = persistence_db::repositories::project_notes::get_note(db.pool(), project_id)
        .await
        .expect("get_note query must not fail")
        .expect("note row must exist after upsert");
    assert_eq!(note_row.content, "First draft notes about the Crab Nebula session.");

    // 3. Update with new content.
    let update_req = ProjectNoteUpdateRequest {
        project_id: project_id.clone(),
        content: "Revised notes: added Ha filter session details.".to_owned(),
    };
    let update_result = project_notes::update_note(db.pool(), &bus, update_req, None)
        .await
        .expect("note update must succeed");
    assert_eq!(update_result.project_id, *project_id);

    // 4. Read back again — must show the updated content, NOT the original.
    let updated_row = persistence_db::repositories::project_notes::get_note(db.pool(), project_id)
        .await
        .expect("get_note after update must not fail")
        .expect("note row must exist after update");
    assert_eq!(
        updated_row.content, "Revised notes: added Ha filter session details.",
        "content must reflect the latest update"
    );

    // 5. Confirm upsert semantics: there must still be exactly one note row.
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM project_notes WHERE project_id = ?")
            .bind(project_id)
            .fetch_one(db.pool())
            .await
            .expect("count query must succeed");
    assert_eq!(count, 1, "upsert must not create duplicate note rows");
}

/// Attempt to update notes on a non-existent project; expect `project.not_found`.
#[tokio::test]
async fn note_update_missing_project_returns_error() {
    let (db, _repo, bus) = support::setup().await;

    let req = ProjectNoteUpdateRequest {
        project_id: Uuid::new_v4().to_string(),
        content: "Should be rejected".to_owned(),
    };
    let err = project_notes::update_note(db.pool(), &bus, req, None)
        .await
        .expect_err("update on missing project must fail");
    assert_eq!(err.code, "project.not_found");
}

// ── US9: manifest write → list → get round-trip ──────────────────────────────

/// Write a manifest, list it, get it by id. Assert persisted body fields match.
///
/// This test uses a real tempdir so the manifest file write path is exercised,
/// which mirrors how `project_manifests::write` works in production.
#[tokio::test]
async fn manifest_write_list_get_round_trip() {
    let (db, _repo, bus) = support::setup().await;

    // Create a project to own the manifest.
    let name = unique_name("Andromeda");
    let req = make_create_req(&name, ProjectTool::PixInsight);
    let created = project_setup::create(db.pool(), &bus, &req).await.expect("create must succeed");
    let project_id = &created.project_id;

    // Write uses a real temp dir for the notes/ subdirectory.
    let dir = tempfile::tempdir().expect("tempdir must succeed");

    let rel_path = project_manifests::write(
        db.pool(),
        &bus,
        WriteManifestParams {
            project_id,
            reason: ManifestReason::Created,
            project_root: dir.path(),
            lifecycle_state: "setup_incomplete",
            source_map: None,
            calibration: None,
            workflow_profile: None,
        },
    )
    .await
    .expect("manifest write must succeed");

    // Path should be under notes/.
    assert!(
        rel_path.starts_with("notes/manifest-"),
        "manifest path must be under notes/; got {rel_path}"
    );

    // File must exist on disk.
    let abs = dir.path().join(&rel_path);
    assert!(abs.exists(), "manifest file must exist at {}", abs.display());

    // List must return exactly one entry for this project.
    let list_resp = project_manifests::list(
        db.pool(),
        ManifestListRequest { project_id: project_id.clone(), cursor: None, limit: Some(10) },
    )
    .await
    .expect("manifest list must succeed");

    assert_eq!(list_resp.manifests.len(), 1, "one manifest should be listed");
    let summary = &list_resp.manifests[0];
    assert_eq!(summary.path, rel_path, "listed path must match written path");

    // Get by id must return the full body with the correct lifecycle_state.
    let manifest_id = &summary.id;
    let get_resp =
        project_manifests::get(db.pool(), manifest_id).await.expect("manifest get must succeed");

    assert_eq!(get_resp.manifest.project_id, *project_id);
    assert_eq!(get_resp.manifest.body.lifecycle_state, "setup_incomplete");
}

/// Write a manifest with notes pre-loaded; assert the notes snapshot is
/// embedded in the manifest body (A8 requirement from spec 024).
#[tokio::test]
async fn manifest_embeds_notes_snapshot_from_db() {
    let (db, _repo, bus) = support::setup().await;

    let name = unique_name("Horsehead");
    let req = make_create_req(&name, ProjectTool::Siril);
    let created = project_setup::create(db.pool(), &bus, &req).await.expect("create must succeed");
    let project_id = &created.project_id;

    // Persist a note before writing the manifest.
    let note_req = ProjectNoteUpdateRequest {
        project_id: project_id.clone(),
        content: "Ha filter: 120s subs, 30 lights.".to_owned(),
    };
    project_notes::update_note(db.pool(), &bus, note_req, None)
        .await
        .expect("note upsert must succeed");

    let dir = tempfile::tempdir().expect("tempdir must succeed");
    project_manifests::write(
        db.pool(),
        &bus,
        WriteManifestParams {
            project_id,
            reason: ManifestReason::SourceChange,
            project_root: dir.path(),
            lifecycle_state: "ready",
            source_map: None,
            calibration: None,
            workflow_profile: None,
        },
    )
    .await
    .expect("manifest write with notes must succeed");

    // Read the raw body_json from the manifests table and check notes field.
    let (body_json,): (String,) =
        sqlx::query_as("SELECT body_json FROM manifests WHERE project_id = ? LIMIT 1")
            .bind(project_id)
            .fetch_one(db.pool())
            .await
            .expect("manifests row must exist");

    let body: serde_json::Value =
        serde_json::from_str(&body_json).expect("body_json must be valid JSON");
    let notes = body.get("notes").and_then(|v| v.as_str());
    assert_eq!(
        notes,
        Some("Ha filter: 120s subs, 30 lights."),
        "notes snapshot must be embedded in manifest body (A8)"
    );
}
