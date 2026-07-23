#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for spec 049 US1 — source view generation
//! (`sourceview.generate` → review → approve → apply).
//!
//! T012: an applied generation plan creates one real link per selected item
//! resolving to its canonical source, zero copies, the canonical DB
//! unchanged, and a `current` `PreparedSourceView` recorded with per-item
//! materialization.
//!
//! T013: the generated tree contains zero tool-control files (SC-002/FR-011).

mod support;

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
#[allow(clippy::case_sensitive_file_extension_comparisons)] // `name` is already lowercased above
async fn applied_generation_plan_creates_real_link_and_recorded_view() {
    let (db, _repo, bus) = support::setup().await;

    let src_dir = tempfile::tempdir().unwrap();
    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().to_str().unwrap().to_owned();

    insert_project_at(db.pool(), "proj-1", &project_path).await;
    insert_root(db.pool(), "root-1", src_dir.path().to_str().unwrap()).await;
    std::fs::write(src_dir.path().join("light_001.fits"), b"canonical-bytes").unwrap();
    insert_file_record(db.pool(), "frame-1", "root-1", "light_001.fits").await;
    insert_acquisition_session(db.pool(), "sess-1", "root-1", &["frame-1"]).await;
    link_project_source(db.pool(), "proj-1", "sess-1").await;

    // 1. Generate: reviewable plan, nothing on disk yet (FR-001).
    let req = SourceViewGenerateRequest {
        project_id: "proj-1".to_owned(),
        profile_id: None,
        destination_override: None,
        copy_opt_in: false,
        strict: false,
    };
    let gen_resp = generate_source_view(db.pool(), &req).await.expect("generate_source_view");
    assert!(!gen_resp.plan_id.is_empty());

    let items_before = plans_repo::list_plan_items(db.pool(), &gen_resp.plan_id).await.unwrap();
    let link_item = items_before.iter().find(|i| i.action == "link").expect("one link item");
    let dest_path = std::path::Path::new(&link_item.to_relative_path);
    assert!(!dest_path.exists(), "nothing written to disk before apply");

    // 2. Approve (fixed token, mirrors plan_apply_audit_integration.rs convention).
    plans_repo::set_approved(db.pool(), &gen_resp.plan_id, "2026-01-01T00:00:00Z", "tok-us1")
        .await
        .expect("set_approved");

    // 3. Apply.
    app_core::plan_apply::apply_plan(db.pool(), &bus, &gen_resp.plan_id, "tok-us1", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // T012: the plan reached a successful terminal state.
    let plan_row = plans_repo::get_plan(db.pool(), &gen_resp.plan_id, false).await.unwrap();
    assert_eq!(plan_row.state, "applied", "generation plan should fully apply");

    // T012: one real link per selected item, resolving to the canonical
    // source. The default settings pair resolves `hardlink` intra-drive and
    // `symlink` cross-drive (spec 049 FR-004); both tempdirs here live under
    // the same filesystem, so intra-drive is expected — assert against
    // whichever kind the plan actually recorded rather than hardcoding one.
    let views = views_repo::list_views_for_project(db.pool(), "proj-1").await.unwrap();
    assert_eq!(views.len(), 1, "exactly one view recorded on first materialization");
    assert_eq!(views[0].state, "current");
    let view_items = views_repo::list_view_items(db.pool(), &views[0].id).await.unwrap();
    assert_eq!(view_items.len(), 1);
    assert_eq!(view_items[0].inventory_item_id, "frame-1");
    let recorded_kind = view_items[0].materialization.clone();
    assert!(
        matches!(recorded_kind.as_str(), "symlink" | "hardlink"),
        "expected a real link kind, got {recorded_kind}"
    );

    assert!(dest_path.symlink_metadata().is_ok(), "destination link was not created");
    if recorded_kind == "symlink" {
        assert!(dest_path.symlink_metadata().unwrap().file_type().is_symlink());
    }
    assert_eq!(std::fs::read(dest_path).unwrap(), b"canonical-bytes");

    // Zero copies: mutating the canonical source through its original path is
    // visible at the destination for both symlink and hardlink kinds (a
    // `copy` would NOT observe this — proving no copy was made).
    std::fs::write(src_dir.path().join("light_001.fits"), b"mutated-bytes").unwrap();
    assert_eq!(
        std::fs::read(dest_path).unwrap(),
        b"mutated-bytes",
        "destination is an independent copy, not a link"
    );

    // T013/SC-002: the generated tree contains zero tool-control files.
    let view_root = dest_path.ancestors().nth(2).unwrap(); // .../source-views/<plan-id>
    let mut found_tool_files = Vec::new();
    for entry in walkdir_flat(view_root) {
        let name = entry.to_string_lossy().to_lowercase();
        if name.ends_with(".xpsm") || name.ends_with(".xosm") || name.contains("process_icon") {
            found_tool_files.push(entry);
        }
    }
    assert!(found_tool_files.is_empty(), "found tool-control files: {found_tool_files:?}");
}

/// Minimal recursive directory walk (avoids adding a `walkdir` dependency for
/// one test file).
fn walkdir_flat(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}
