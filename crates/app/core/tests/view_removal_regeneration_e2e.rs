#![allow(clippy::doc_markdown)]

// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! End-to-end integration tests for spec 026 US1/US2 (T008/T013) — the real
//! spec 025 executor, not `simulateApply`: generate → remove → apply, and
//! generate → remove → apply → regenerate → apply.
//!
//! Also covers T017/T018/T020: the removal/regeneration plan-apply
//! finalization hooks (`finalize_view_removal`/`finalize_view_regeneration`
//! in `app_core::plan_apply`) and the per-item `plan_apply_events` audit
//! trail, which is origin-agnostic (spec 025) so it already covers these
//! plan types — this test asserts that generically-emitted trail exists for
//! `prepared_view_removal`/`prepared_view_regeneration` specifically.
//!
//! T005: exercises the `archive` per-item apply action for real on this
//! platform (POSIX here); Windows junction/reparse-point apply specifics
//! remain unverified on this dev machine and stay deferred to v1.x per
//! spec.md.

mod support;

use app_core_projects::prepared_views::{regenerate_prepared_view, remove_prepared_view};
use app_core_projects::source_view_generate::generate_source_view;
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

/// Count `plan_apply_events` rows for a plan — the durable per-item/plan
/// audit trail (spec 025 FR-003), origin-agnostic.
async fn event_count(pool: &sqlx::SqlitePool, plan_id: &str) -> i64 {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plan_apply_events WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_one(pool)
            .await
            .unwrap();
    count
}

/// Generate + approve + apply a real `prepared_view_generation` plan for a
/// fresh project/session/frame fixture, returning the recorded view id, the
/// on-disk source directory, and the destination directory (both must
/// outlive the returned view id).
async fn generate_and_apply_view(
    db: &persistence_db::Database,
    bus: &audit::bus::EventBus,
    project_id: &str,
    src_dir: &std::path::Path,
) -> (String, tempfile::TempDir) {
    // Removal/regeneration (spec 026 v1) refuse `hardlink` views — force the
    // intra-drive default to `symlink` so the generated view (both tempdirs
    // share a filesystem here, so intra-drive applies) is a valid target for
    // this test's remove/regenerate calls. Same fixture as
    // `source_view_generation_us3_regenerate.rs`.
    persistence_db::repositories::settings::set_raw(
        db.pool(),
        "sourceViewLinkKindIntraDrive",
        &serde_json::json!("symlink"),
    )
    .await
    .expect("set symlink default");

    let project_dir = tempfile::tempdir().unwrap();
    insert_project_at(db.pool(), project_id, project_dir.path().to_str().unwrap()).await;
    insert_root(db.pool(), &format!("root-{project_id}"), src_dir.to_str().unwrap()).await;
    std::fs::write(src_dir.join("light_001.fits"), b"canonical-bytes").unwrap();
    insert_file_record(
        db.pool(),
        &format!("frame-{project_id}"),
        &format!("root-{project_id}"),
        "light_001.fits",
    )
    .await;
    insert_acquisition_session(
        db.pool(),
        &format!("sess-{project_id}"),
        &format!("root-{project_id}"),
        &[&format!("frame-{project_id}")],
    )
    .await;
    link_project_source(db.pool(), project_id, &format!("sess-{project_id}")).await;

    let req = SourceViewGenerateRequest {
        project_id: project_id.to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    };
    let gen_resp = generate_source_view(db.pool(), &req).await.expect("generate_source_view");

    plans_repo::set_approved(
        db.pool(),
        &gen_resp.plan_id,
        "2026-01-01T00:00:00Z",
        &format!("tok-gen-{project_id}"),
    )
    .await
    .expect("set_approved");
    app_core::plan_apply::apply_plan(
        db.pool(),
        bus,
        &gen_resp.plan_id,
        &format!("tok-gen-{project_id}"),
        None,
    )
    .await
    .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let plan_row = plans_repo::get_plan(db.pool(), &gen_resp.plan_id, false).await.unwrap();
    assert_eq!(plan_row.state, "applied", "generation plan should fully apply");

    let views = views_repo::list_views_for_project(db.pool(), project_id).await.unwrap();
    assert_eq!(views.len(), 1, "exactly one view recorded on first materialization");

    (views[0].id.clone(), project_dir)
}

/// T008: generate → remove → apply with the real executor. The view is
/// marked `removed` (T017/T018 finalize_view_removal), the destination link
/// is archived off its original path (T005: real per-item `archive` apply),
/// and a durable audit trail exists for the removal plan (T018/T020).
#[tokio::test]
async fn remove_view_e2e_archives_links_and_marks_view_removed() {
    let (db, _repo, bus) = support::setup().await;
    let src_dir = tempfile::tempdir().unwrap();

    let (view_id, _project_dir) =
        generate_and_apply_view(&db, &bus, "proj-remove-e2e", src_dir.path()).await;

    let items_before = views_repo::list_view_items(db.pool(), &view_id).await.unwrap();
    assert_eq!(items_before.len(), 1);
    let dest_path = std::path::Path::new(&items_before[0].view_relative_path).to_path_buf();
    assert!(dest_path.symlink_metadata().is_ok(), "generated link exists before removal");

    let remove_resp =
        remove_prepared_view(db.pool(), &view_id).await.expect("remove_prepared_view");
    plans_repo::set_approved(db.pool(), &remove_resp.plan_id, "2026-01-01T00:00:00Z", "tok-remove")
        .await
        .expect("set_approved");
    app_core::plan_apply::apply_plan(db.pool(), &bus, &remove_resp.plan_id, "tok-remove", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let plan_row = plans_repo::get_plan(db.pool(), &remove_resp.plan_id, false).await.unwrap();
    assert_eq!(plan_row.state, "applied", "removal plan should fully apply");

    // T005: real per-item archive apply — the link is gone from its
    // original recorded path (moved into the archive tree, not deleted).
    assert!(
        dest_path.symlink_metadata().is_err(),
        "view item entry must be archived away from its original path"
    );

    // T017/T018: finalize_view_removal marks the view removed on a clean apply.
    let view = views_repo::get_view(db.pool(), &view_id).await.unwrap();
    assert_eq!(view.state, "removed");
    assert!(view.removed_at.is_some());

    // A4: membership preserved for later regeneration.
    let items_after = views_repo::list_view_items(db.pool(), &view_id).await.unwrap();
    assert_eq!(items_after.len(), 1);

    // T018/T020: durable per-item audit trail exists for the removal plan
    // (origin-agnostic spec 025 event log, already covers this plan type).
    assert!(
        event_count(db.pool(), &remove_resp.plan_id).await > 0,
        "removal plan apply must write plan_apply_events rows"
    );
}

/// T013: generate → remove → apply → regenerate → apply, with the real
/// executor end to end. The view returns to `current` after regeneration
/// (T017 finalize_view_regeneration rides the T014 sweep) and a fresh link
/// exists on disk again.
#[tokio::test]
async fn regenerate_view_e2e_recreates_links_and_marks_view_current() {
    let (db, _repo, bus) = support::setup().await;
    let src_dir = tempfile::tempdir().unwrap();

    let (view_id, _project_dir) =
        generate_and_apply_view(&db, &bus, "proj-regen-e2e", src_dir.path()).await;

    let remove_resp =
        remove_prepared_view(db.pool(), &view_id).await.expect("remove_prepared_view");
    plans_repo::set_approved(
        db.pool(),
        &remove_resp.plan_id,
        "2026-01-01T00:00:00Z",
        "tok-remove2",
    )
    .await
    .expect("set_approved");
    app_core::plan_apply::apply_plan(db.pool(), &bus, &remove_resp.plan_id, "tok-remove2", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(views_repo::get_view(db.pool(), &view_id).await.unwrap().state, "removed");

    let regen_resp =
        regenerate_prepared_view(db.pool(), &view_id).await.expect("regenerate_prepared_view");
    assert_eq!(regen_resp.unresolved_item_count, 0, "the source frame is still resolvable");

    plans_repo::set_approved(db.pool(), &regen_resp.plan_id, "2026-01-01T00:00:00Z", "tok-regen")
        .await
        .expect("set_approved");
    app_core::plan_apply::apply_plan(db.pool(), &bus, &regen_resp.plan_id, "tok-regen", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let plan_row = plans_repo::get_plan(db.pool(), &regen_resp.plan_id, false).await.unwrap();
    assert_eq!(plan_row.state, "applied", "regeneration plan should fully apply");

    // T017: finalize_view_regeneration's sweep observes the freshly-created
    // link and restores the view to `current`.
    let view = views_repo::get_view(db.pool(), &view_id).await.unwrap();
    assert_eq!(view.state, "current");

    let items = views_repo::list_view_items(db.pool(), &view_id).await.unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].last_observed_state, "present");
    let dest_path = std::path::Path::new(&items[0].view_relative_path).to_path_buf();
    assert!(dest_path.symlink_metadata().is_ok(), "regenerated link exists on disk");

    // T018/T020: durable audit trail for the regeneration plan too.
    assert!(
        event_count(db.pool(), &regen_resp.plan_id).await > 0,
        "regeneration plan apply must write plan_apply_events rows"
    );
}
