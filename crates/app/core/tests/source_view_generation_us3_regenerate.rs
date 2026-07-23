#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration test for spec 049 US3 — regeneration reuses spec 026's
//! `preparedview.regenerate` machinery unchanged (T032/T033).
//!
//! Proves a `current` `PreparedSourceView` produced by US1/US2's
//! `sourceview.generate` → apply → `finalize_view_generation` path is a valid
//! input to `prepared_views::regenerate_prepared_view`: same
//! `PreparedSourceView`/`PreparedSourceViewItem` entities (both read/write the
//! same `persistence_db::repositories::prepared_source_views` tables), no new
//! regeneration logic added (FR-012/FR-013).
//!
//! Scenario: generate + apply a view for one session's one frame, then remove
//! that frame from canonical inventory (`file_record`) — simulating a
//! selection/match change that leaves a stale reference — and regenerate.
//! Expect the regenerated plan to contain 0 dangling link items (SC-005) and
//! the removed reference counted as unresolved (US3 AS1/AS2).

mod support;

use app_core_projects::prepared_views::regenerate_prepared_view;
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

#[tokio::test]
async fn regenerate_reflects_removed_selection_with_zero_dangling_links() {
    let (db, _repo, bus) = support::setup().await;

    let src_dir = tempfile::tempdir().unwrap();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_str().unwrap().to_owned();

    // Regeneration (spec 026 v1) refuses `hardlink` views — force the
    // intra-drive default to `symlink` so the generated view (both tempdirs
    // share a filesystem, so intra-drive applies) is regeneratable. Unrelated
    // to what this test proves (US1/US2 views are valid regenerate input).
    persistence_db::repositories::settings::set_raw(
        db.pool(),
        "sourceViewLinkKindIntraDrive",
        &serde_json::json!("symlink"),
    )
    .await
    .expect("set symlink default");

    insert_project_at(db.pool(), "proj-1", &project_path).await;
    insert_root(db.pool(), "root-1", src_dir.path().to_str().unwrap()).await;
    std::fs::write(src_dir.path().join("light_001.fits"), b"canonical-bytes").unwrap();
    insert_file_record(db.pool(), "frame-1", "root-1", "light_001.fits").await;
    insert_acquisition_session(db.pool(), "sess-1", "root-1", &["frame-1"]).await;
    link_project_source(db.pool(), "proj-1", "sess-1").await;

    // 1. Generate + approve + apply (US1/US2 path) to get a `current` view.
    let req = SourceViewGenerateRequest {
        project_id: "proj-1".to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    };
    let gen_resp = generate_source_view(db.pool(), &req).await.expect("generate_source_view");
    plans_repo::set_approved(db.pool(), &gen_resp.plan_id, "2026-01-01T00:00:00Z", "tok-us3")
        .await
        .expect("set_approved");
    app_core::plan_apply::apply_plan(db.pool(), &bus, &gen_resp.plan_id, "tok-us3", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let views = views_repo::list_views_for_project(db.pool(), "proj-1").await.unwrap();
    assert_eq!(views.len(), 1, "US1/US2 generation must record exactly one current view");
    let view_id = views[0].id.clone();
    assert_eq!(views[0].state, "current");

    // 2. Simulate a selection/match change that leaves this reference stale:
    // the frame is removed from canonical inventory (e.g. re-scan dropped it).
    sqlx::query("DELETE FROM file_record WHERE id = 'frame-1'").execute(db.pool()).await.unwrap();

    // 3. Regenerate via spec 026's unchanged machinery (T033) — this is the
    // whole point of the test: a US1/US2-produced view is valid input here
    // with no adapter code, because both write the same
    // PreparedSourceView/PreparedSourceViewItem tables.
    let regen_resp =
        regenerate_prepared_view(db.pool(), &view_id).await.expect("regenerate_prepared_view");

    // T032/SC-005: the stale reference is flagged, not silently dropped or
    // silently kept.
    assert_eq!(regen_resp.unresolved_item_count, 1, "the removed frame must be flagged");

    // 0 dangling links in the regenerated plan: no link item references the
    // now-missing frame.
    let regen_items = plans_repo::list_plan_items(db.pool(), &regen_resp.plan_id).await.unwrap();
    let link_items: Vec<_> = regen_items.iter().filter(|i| i.action == "link").collect();
    assert!(
        link_items.is_empty(),
        "the only member was the removed frame — 0 dangling links expected, got {link_items:?}"
    );
}
