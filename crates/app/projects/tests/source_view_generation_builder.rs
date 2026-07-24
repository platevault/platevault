// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 049 T011 — generation-plan builder integration test.
//!
//! `tasks.md` pointed at `crates/fs/planner/tests`, but the actual plan
//! builder lives in `app_core_projects::source_view_generate` (mirroring
//! spec 026's `prepared_views::regenerate_prepared_view`, which also builds
//! its plan directly against the DB rather than through `fs_planner` — that
//! crate is a small pure domain crate with no DB access). This test lives
//! next to the real implementation.
//!
//! Builds a generation plan for a fixture project with a selected light
//! session **and** a matched calibration assignment, then asserts:
//! - per-item `link` + `mkdir` actions are present;
//! - every `link` action's destination is under the plan's own destination
//!   root (never targets a canonical inventory path);
//! - `origin = prepared_view_generation` / `plan_type = source_view_generation`
//!   (FR-021a).

use app_core_projects::source_view_generate::generate_source_view;
use camino::Utf8PathBuf;
use contracts_core::source_view_generate::SourceViewGenerateRequest;
use persistence_core::Database;
use persistence_plans::repositories::plans as plans_repo;

async fn setup() -> Database {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db
}

async fn insert_project_at(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at)
         VALUES (?, ?, 'PixInsight', 'ready', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(path)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_root(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
         VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(path)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_file_record(pool: &sqlx::SqlitePool, id: &str, root_id: &str, relative_path: &str) {
    sqlx::query(
        "INSERT INTO file_record (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 100, '2026-01-01T00:00:00Z', 'classified', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(root_id)
    .bind(relative_path)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_acquisition_session(
    pool: &sqlx::SqlitePool,
    id: &str,
    root_id: &str,
    frame_ids: &[&str],
) {
    let json = serde_json::to_string(frame_ids).unwrap();
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(root_id)
    .bind(json)
    .execute(pool)
    .await
    .unwrap();
}

async fn link_project_source(pool: &sqlx::SqlitePool, project_id: &str, session_id: &str) {
    sqlx::query(
        "INSERT INTO project_sources (id, project_id, inventory_session_id, name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at)
         VALUES (?, ?, ?, 'snap', 1, 'L', '300', '2026-01-01T00:00:00Z')",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(project_id)
    .bind(session_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Insert a "master" as a `calibration_session` (+ 1:1 `calibration_fingerprint`
/// row, per migration 0023: `calibration_fingerprint.id REFERENCES
/// calibration_session(id)`) plus one `calibration_assignment` pointing the
/// light session at it. This is the real resolution chain
/// `calibration_assignment.master_id == calibration_fingerprint.id ==
/// calibration_session.id` used by `source_view_generate`.
async fn insert_matched_master(
    pool: &sqlx::SqlitePool,
    light_session_id: &str,
    cal_session_id: &str,
    root_id: &str,
    frame_ids: &[&str],
) {
    let json = serde_json::to_string(frame_ids).unwrap();
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, root_id, frame_ids, kind, created_at)
         VALUES (?, ?, ?, ?, 'dark', '2026-01-01T00:00:00Z')",
    )
    .bind(cal_session_id)
    .bind(cal_session_id)
    .bind(root_id)
    .bind(json)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO calibration_fingerprint (id, calibration_type) VALUES (?, 'dark')")
        .bind(cal_session_id)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO calibration_assignment
            (id, session_id, calibration_type, master_id, confidence, assigned_at)
         VALUES (?, ?, 'dark', ?, 0.9, '2026-01-01T00:00:00Z')",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(light_session_id)
    .bind(cal_session_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn builder_emits_link_and_mkdir_actions_scoped_to_destination() {
    let db = setup().await;
    let src_dir = tempfile::tempdir().unwrap();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_str().unwrap().to_owned();

    insert_project_at(db.pool(), "proj-b1", &project_path).await;
    insert_root(db.pool(), "root-b1", src_dir.path().to_str().unwrap()).await;
    insert_file_record(db.pool(), "frame-b1", "root-b1", "light_a.fits").await;
    insert_acquisition_session(db.pool(), "sess-b1", "root-b1", &["frame-b1"]).await;
    link_project_source(db.pool(), "proj-b1", "sess-b1").await;

    // Matched calibration (a "master").
    insert_file_record(db.pool(), "cal-frame-b1", "root-b1", "master_dark.fits").await;
    insert_matched_master(db.pool(), "sess-b1", "cal-sess-b1", "root-b1", &["cal-frame-b1"]).await;

    let req = SourceViewGenerateRequest {
        project_id: "proj-b1".to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    };
    let resp = generate_source_view(db.pool(), &req).await.expect("generate_source_view");

    // No "no_calibration_applied" warning — the match resolved.
    assert!(resp.warnings.iter().all(|w| {
        w.code != contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied
    }));

    let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
    assert_eq!(plan.origin, "prepared_view_generation", "FR-021a distinct origin");
    assert_eq!(plan.plan_type, "source_view_generation", "FR-021a distinct plan type");

    let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
    let mkdir_items: Vec<_> = items.iter().filter(|i| i.action == "mkdir").collect();
    let link_items: Vec<_> = items.iter().filter(|i| i.action == "link").collect();
    assert!(!mkdir_items.is_empty(), "expected at least one mkdir action");
    assert_eq!(link_items.len(), 2, "one light + one matched calibration item");

    // Build the expected destination root the same way the production code
    // does (`Utf8PathBuf::join`), so the comparison is platform-separator
    // agnostic instead of assuming forward slashes (production uses the
    // platform's native separator, which is `\` on Windows).
    let destination_root =
        Utf8PathBuf::from(&project_path).join("source-views").join(&resp.plan_id);
    for item in &link_items {
        let dest = Utf8PathBuf::from(&item.to_relative_path);
        assert!(
            dest.starts_with(&destination_root),
            "link destination '{}' must be under the plan's own destination root '{destination_root}'",
            item.to_relative_path
        );
        // No action targets an inventory (canonical source) path on the
        // destination side — the destination is always inside the generated
        // view tree, never the source library root.
        let source_root = Utf8PathBuf::from(src_dir.path().to_str().unwrap());
        assert!(!dest.starts_with(&source_root));
    }
    for item in &mkdir_items {
        let dest = Utf8PathBuf::from(&item.to_relative_path);
        assert!(dest.starts_with(&destination_root));
    }
}
