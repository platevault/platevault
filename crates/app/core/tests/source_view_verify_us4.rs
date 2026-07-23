#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for spec 049 US4 — `sourceview.verify`.
//!
//! T037: an all-present view verifies clean (0 false alarms, SC-006); a
//! moved/removed source is reported with its reference, 0 filesystem
//! mutations, no auto-repair (US4 AS1/AS2/FR-015).

mod support;

use app_core_projects::source_view_generate::generate_source_view;
use app_core_projects::source_view_verify::verify_source_view;
use contracts_core::source_view_generate::SourceViewGenerateRequest;
use persistence_db::repositories::{plans as plans_repo, prepared_source_views as views_repo};

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

/// Generate + approve + apply a real `prepared_view_generation` plan for a
/// fresh project/session/frame fixture, returning the recorded view id and
/// the on-disk source file path.
async fn generate_and_apply_view(
    db: &persistence_db::Database,
    bus: &audit::bus::EventBus,
    project_id: &str,
    src_dir: &std::path::Path,
) -> (String, std::path::PathBuf, tempfile::TempDir) {
    let project_dir = tempfile::tempdir().unwrap();
    insert_project_at(db.pool(), project_id, project_dir.path().to_str().unwrap()).await;
    insert_root(db.pool(), "root-verify", src_dir.to_str().unwrap()).await;
    let source_file = src_dir.join("light_001.fits");
    std::fs::write(&source_file, b"canonical-bytes").unwrap();
    insert_file_record(db.pool(), "frame-verify", "root-verify", "light_001.fits").await;
    insert_acquisition_session(db.pool(), "sess-verify", "root-verify", &["frame-verify"]).await;
    link_project_source(db.pool(), project_id, "sess-verify").await;

    let req = SourceViewGenerateRequest {
        project_id: project_id.to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    };
    let gen_resp = generate_source_view(db.pool(), &req).await.expect("generate_source_view");

    plans_repo::set_approved(db.pool(), &gen_resp.plan_id, "2026-01-01T00:00:00Z", "tok-verify")
        .await
        .expect("set_approved");
    app_core::plan_apply::apply_plan(db.pool(), bus, &gen_resp.plan_id, "tok-verify", None)
        .await
        .expect("apply_plan should start");
    support::wait_plan_terminal(db.pool(), &gen_resp.plan_id).await;

    let plan_row = plans_repo::get_plan(db.pool(), &gen_resp.plan_id, false).await.unwrap();
    assert_eq!(plan_row.state, "applied", "generation plan should fully apply");

    let views = views_repo::list_views_for_project(db.pool(), project_id).await.unwrap();
    assert_eq!(views.len(), 1, "exactly one view recorded on first materialization");

    (views[0].id.clone(), source_file, project_dir)
}

#[tokio::test]
async fn all_present_view_verifies_clean_with_zero_false_alarms() {
    let (db, _repo, bus) = support::setup().await;
    let src_dir = tempfile::tempdir().unwrap();

    let (view_id, _source_file, _project_dir) =
        generate_and_apply_view(&db, &bus, "proj-verify-clean", src_dir.path()).await;

    let resp = verify_source_view(db.pool(), &view_id).await.expect("verify_source_view");
    assert!(resp.clean, "expected clean (SC-006), got broken_items: {:?}", resp.broken_items);
    assert!(resp.broken_items.is_empty());
}

#[tokio::test]
async fn moved_source_is_reported_with_zero_mutation_and_no_auto_repair() {
    let (db, _repo, bus) = support::setup().await;
    let src_dir = tempfile::tempdir().unwrap();

    let (view_id, source_file, _project_dir) =
        generate_and_apply_view(&db, &bus, "proj-verify-broken", src_dir.path()).await;

    let view_items_before = views_repo::list_view_items(db.pool(), &view_id).await.unwrap();
    assert_eq!(view_items_before.len(), 1);
    let dest_path = std::path::Path::new(&view_items_before[0].view_relative_path).to_path_buf();
    let dest_kind_before = dest_path.symlink_metadata().ok().map(|m| m.file_type().is_symlink());

    // Simulate the source being moved/removed outside the app (US4 AS2): the
    // file itself is gone, and — mirroring how the app's own filesystem
    // watcher would reconcile a vanished path — its `file_record` state
    // flips to `missing`. Reproduced this way (not just deleting the file)
    // because a hardlink destination (the intra-drive default here, both
    // tempdirs sharing a filesystem) keeps its bytes independently of the
    // source name being removed; the canonical-source bookkeeping going
    // stale is the actual "broken" signal in that case.
    std::fs::remove_file(&source_file).unwrap();
    sqlx::query("UPDATE file_record SET state = 'missing' WHERE id = 'frame-verify'")
        .execute(db.pool())
        .await
        .unwrap();

    let resp = verify_source_view(db.pool(), &view_id).await.expect("verify_source_view");
    assert!(!resp.clean);
    assert_eq!(resp.broken_items.len(), 1, "exactly one broken item, referencing the source");
    assert_eq!(resp.broken_items[0].inventory_item_id, "frame-verify");

    // FR-015: no filesystem mutation and no auto-repair — the destination
    // entry and its recorded DB row are unchanged by verify itself.
    assert_eq!(
        dest_path.symlink_metadata().ok().map(|m| m.file_type().is_symlink()),
        dest_kind_before,
        "verify must not touch the destination entry"
    );
    let view_items_after = views_repo::list_view_items(db.pool(), &view_id).await.unwrap();
    assert_eq!(
        view_items_after[0].view_relative_path, view_items_before[0].view_relative_path,
        "no auto-repair: view membership is untouched by verify"
    );
}
