// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use super::*;
use contracts_core::error_code::ErrorCode;
use contracts_core::source_view_generate::SourceViewGenerateRequest;
use domain_core::ids::new_id as new_test_id;
use persistence_db::repositories::plans as plans_repo;
use persistence_db::Database;

async fn setup() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db
}

async fn insert_project(db: &Database, id: &str, lifecycle: &str, path: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at)
         VALUES (?, ?, 'PixInsight', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(lifecycle)
    .bind(path)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_root(db: &Database, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
         VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(path)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_file_record(db: &Database, id: &str, root_id: &str, relative_path: &str) {
    sqlx::query(
        "INSERT INTO file_record (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 100, '2026-01-01T00:00:00Z', 'classified', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(root_id)
    .bind(relative_path)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_acquisition_session(db: &Database, id: &str, root_id: &str, frame_ids: &[&str]) {
    let json = serde_json::to_string(frame_ids).unwrap();
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(root_id)
    .bind(json)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn link_project_source(db: &Database, project_id: &str, session_id: &str) {
    link_project_source_with(db, project_id, session_id, "L", "300").await;
}

async fn link_project_source_with(
    db: &Database,
    project_id: &str,
    session_id: &str,
    filter: &str,
    exposure: &str,
) {
    sqlx::query(
        "INSERT INTO project_sources (id, project_id, inventory_session_id, name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at)
         VALUES (?, ?, ?, 'snap', 1, ?, ?, '2026-01-01T00:00:00Z')",
    )
    .bind(new_test_id())
    .bind(project_id)
    .bind(session_id)
    .bind(filter)
    .bind(exposure)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_acquisition_session_with_key(
    db: &Database,
    id: &str,
    session_key: &str,
    root_id: &str,
    frame_ids: &[&str],
) {
    let json = serde_json::to_string(frame_ids).unwrap();
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(session_key)
    .bind(root_id)
    .bind(json)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_calibration_session(db: &Database, id: &str, root_id: &str, frame_ids: &[&str]) {
    let json = serde_json::to_string(frame_ids).unwrap();
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, root_id, frame_ids, kind, created_at)
         VALUES (?, ?, ?, ?, 'flat', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(root_id)
    .bind(json)
    .execute(db.pool())
    .await
    .unwrap();
}

async fn insert_calibration_assignment(
    db: &Database,
    session_id: &str,
    calibration_type: &str,
    master_id: &str,
) {
    sqlx::query(
        "INSERT INTO calibration_assignment (id, session_id, calibration_type, master_id, confidence, assigned_at)
         VALUES (?, ?, ?, ?, 1.0, '2026-01-01T00:00:00Z')",
    )
    .bind(new_test_id())
    .bind(session_id)
    .bind(calibration_type)
    .bind(master_id)
    .execute(db.pool())
    .await
    .unwrap();
}

fn req(project_id: &str) -> SourceViewGenerateRequest {
    SourceViewGenerateRequest {
        project_id: project_id.to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    }
}

#[tokio::test]
async fn generates_plan_for_project_with_selected_lights() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
    link_project_source(&db, "p1", "sess1").await;

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    assert!(!resp.plan_id.is_empty());
    // No calibration assignment for sess1 → warning, not a failure.
    assert!(resp.warnings.iter().any(|w| w.code
        == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied));

    let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
    assert_eq!(plan.state, "ready_for_review");
    assert_eq!(plan.origin, "prepared_view_generation");
    assert_eq!(plan.plan_type, "source_view_generation");

    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    // 1 mkdir (view root + Lights/sess1 collapse to distinct dirs) + 1 link.
    assert!(items.iter().any(|i| i.action == "link"));
    assert!(items.iter().any(|i| i.action == "mkdir"));
    let link_item = items.iter().find(|i| i.action == "link").unwrap();
    assert_eq!(link_item.from_relative_path, "light1.fits");
    assert_eq!(link_item.linked_entity.as_deref(), Some("frame1"));
}

#[tokio::test]
async fn refuses_archived_project() {
    let db = setup().await;
    insert_project(&db, "p-arch", "archived", "/tmp/proj-arch").await;

    let err = generate_source_view(db.pool(), &req("p-arch")).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
}

#[tokio::test]
async fn refuses_no_selection() {
    let db = setup().await;
    insert_project(&db, "p-empty", "ready", "/tmp/proj-empty").await;

    let err = generate_source_view(db.pool(), &req("p-empty")).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::NoSelection);
}

#[tokio::test]
async fn project_not_found() {
    let db = setup().await;
    let err = generate_source_view(db.pool(), &req("nonexistent")).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ProjectNotFound);
}

// ── Spec 049 US2 ──────────────────────────────────────────────────────

/// T023 (builder-level companion to the `workflow_profiles` unit tests):
/// a PixInsight project groups lights by session/night → filter →
/// exposure instead of the US1 MVP flat `Lights/<session_id>/` tree.
#[tokio::test]
async fn wbpp_layout_groups_lights_by_night_filter_exposure() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_acquisition_session_with_key(
        &db,
        "sess1",
        "M31|Ha|1x1|100|2026-03-15",
        "root1",
        &["frame1"],
    )
    .await;
    link_project_source_with(&db, "p1", "sess1", "Ha", "300").await;

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let link_item = items.iter().find(|i| i.action == "link").unwrap();
    assert_eq!(
        link_item.to_relative_path,
        format!("{project_path}/source-views/{}/2026-03-15/Ha/300/light1.fits", resp.plan_id)
    );
}

/// T024: changing the metadata that feeds the profile pattern (a
/// different session/filter/exposure) changes only the destination path
/// — the canonical `file_record`/`acquisition_session` rows are read,
/// never written, by generation (US2 AS2).
#[tokio::test]
async fn changing_session_metadata_changes_destination_not_canonical_data() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_acquisition_session_with_key(
        &db,
        "sess1",
        "M31|Ha|1x1|100|2026-03-15",
        "root1",
        &["frame1"],
    )
    .await;
    link_project_source_with(&db, "p1", "sess1", "Lum", "600").await;

    let before: (String, String) =
        sqlx::query_as("SELECT relative_path, state FROM file_record WHERE id = 'frame1'")
            .fetch_one(db.pool())
            .await
            .unwrap();

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let link_item = items.iter().find(|i| i.action == "link").unwrap();
    assert!(link_item.to_relative_path.ends_with("2026-03-15/Lum/600/light1.fits"));

    // Canonical file_record is untouched by generation.
    let after: (String, String) =
        sqlx::query_as("SELECT relative_path, state FROM file_record WHERE id = 'frame1'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(before, after);
}

/// T026/FR-010: matched calibration lands under the profile's calibration
/// location, in its own `master_id` subdirectory (never colliding with
/// another matched set of the same type).
#[tokio::test]
async fn calibration_lands_under_profile_calibration_location() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    std::fs::write(format!("{}/flat1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_file_record(&db, "flat1", "root1", "flat1.fits").await;
    insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
    link_project_source(&db, "p1", "sess1").await;
    insert_calibration_session(&db, "master-flat-1", "root1", &["flat1"]).await;
    insert_calibration_assignment(&db, "sess1", "flat", "master-flat-1").await;

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    // Calibration matched → no "no calibration applied" warning.
    assert!(!resp.warnings.iter().any(|w| w.code
        == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied));

    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let cal_item =
        items.iter().find(|i| i.from_relative_path == "flat1.fits").expect("calibration link");
    assert!(
        cal_item.to_relative_path.ends_with("calibration/flat/master-flat-1/flat1.fits"),
        "unexpected calibration destination: {}",
        cal_item.to_relative_path
    );
}

/// T028: a session that matches *some* but not all of the project's
/// observed calibration types still generates, and is flagged the same
/// as a session with zero matches (FR-010a/CL-7 "no or partial").
#[tokio::test]
async fn partial_calibration_coverage_is_flagged() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;

    // sess1: matches both dark + flat (full coverage for this project).
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    std::fs::write(format!("{}/dark1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    std::fs::write(format!("{}/flat1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_file_record(&db, "dark1", "root1", "dark1.fits").await;
    insert_file_record(&db, "flat1", "root1", "flat1.fits").await;
    insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
    link_project_source(&db, "p1", "sess1").await;
    insert_calibration_session(&db, "master-dark-1", "root1", &["dark1"]).await;
    insert_calibration_session(&db, "master-flat-1", "root1", &["flat1"]).await;
    insert_calibration_assignment(&db, "sess1", "dark", "master-dark-1").await;
    insert_calibration_assignment(&db, "sess1", "flat", "master-flat-1").await;

    // sess2: matches only dark (partial relative to the project's flat+dark
    // coverage), via its own master (a shared master would trip the
    // pre-existing FR-009a collision guard, unrelated to this behavior).
    std::fs::write(format!("{}/light2.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    std::fs::write(format!("{}/dark2.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame2", "root1", "light2.fits").await;
    insert_file_record(&db, "dark2", "root1", "dark2.fits").await;
    insert_acquisition_session(&db, "sess2", "root1", &["frame2"]).await;
    link_project_source(&db, "p1", "sess2").await;
    insert_calibration_session(&db, "master-dark-2", "root1", &["dark2"]).await;
    insert_calibration_assignment(&db, "sess2", "dark", "master-dark-2").await;

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    let warning = resp
        .warnings
        .iter()
        .find(|w| {
            w.code
                == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied
        })
        .expect("partial coverage must still surface a warning");
    assert!(warning.items.contains(&"sess2".to_owned()));
    assert!(!warning.items.contains(&"sess1".to_owned()));
}

// ── T041: per-project destination override (FR-021b) ────────────────────

#[tokio::test]
async fn destination_override_roundtrips_and_defaults_to_none() {
    let db = setup().await;
    insert_project(&db, "p1", "ready", "/tmp/proj-override").await;

    assert_eq!(get_destination_override(db.pool(), "p1").await.unwrap(), None);

    set_destination_override(db.pool(), "p1", Some("/custom/dest")).await.unwrap();
    assert_eq!(
        get_destination_override(db.pool(), "p1").await.unwrap(),
        Some("/custom/dest".to_owned())
    );

    // Clearing (None) removes the override.
    set_destination_override(db.pool(), "p1", None).await.unwrap();
    assert_eq!(get_destination_override(db.pool(), "p1").await.unwrap(), None);
}

#[tokio::test]
async fn generate_uses_persisted_project_override_when_no_per_generation_override() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
    link_project_source(&db, "p1", "sess1").await;

    let custom_dest = format!("{}/custom-dest", dir.path().to_str().unwrap());
    set_destination_override(db.pool(), "p1", Some(&custom_dest)).await.unwrap();

    let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let link_item = items.iter().find(|i| i.action == "link").unwrap();
    assert!(
        link_item.to_relative_path.starts_with(&custom_dest),
        "expected destination under the persisted override, got {}",
        link_item.to_relative_path
    );
}

#[tokio::test]
async fn generate_per_generation_override_wins_over_persisted_project_override() {
    let db = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_path = format!("{}/proj", dir.path().to_str().unwrap());
    std::fs::create_dir_all(&project_path).unwrap();
    insert_project(&db, "p1", "ready", &project_path).await;
    insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
    std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
    insert_file_record(&db, "frame1", "root1", "light1.fits").await;
    insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
    link_project_source(&db, "p1", "sess1").await;

    let project_dest = format!("{}/project-dest", dir.path().to_str().unwrap());
    set_destination_override(db.pool(), "p1", Some(&project_dest)).await.unwrap();
    let per_gen_dest = format!("{}/per-gen-dest", dir.path().to_str().unwrap());

    let mut request = req("p1");
    request.destination_override = Some(per_gen_dest.clone());
    let resp = generate_source_view(db.pool(), &request).await.unwrap();
    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let link_item = items.iter().find(|i| i.action == "link").unwrap();
    assert!(
        link_item.to_relative_path.starts_with(&per_gen_dest),
        "expected per-generation override to win, got {}",
        link_item.to_relative_path
    );
    assert!(!link_item.to_relative_path.starts_with(&project_dest));
}

// ── T042/FR-018: Windows long-path threshold ─────────────────────────────

#[test]
fn exceeds_windows_long_path_limit_is_false_at_and_below_259() {
    // 259 is the last usable length — the 260th slot is reserved for the
    // Win32 trailing NUL.
    assert!(!exceeds_windows_long_path_limit(&"a".repeat(259)));
    assert!(!exceeds_windows_long_path_limit("a"));
}

#[test]
fn exceeds_windows_long_path_limit_is_true_at_and_above_260() {
    assert!(exceeds_windows_long_path_limit(&"a".repeat(260)));
    assert!(exceeds_windows_long_path_limit(&"a".repeat(261)));
}
