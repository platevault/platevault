#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 regression tests for #1218 — project source snapshots.
//!
//! `projects.create` (`initialSources`) and `projects.source.add` used to
//! hardcode every snapshot field to `""`/`0`, so `sourceview.generate`'s
//! WBPP `{date}/{filter}/{exposure}` layout put every real, project-linked
//! session in the `nofilter`/`unknown-exposure` fallback buckets.
//!
//! These tests drive the REAL use cases end to end (create → add_source →
//! generate) and assert real tokens on the generated destination path. They
//! deliberately do NOT hand-insert `project_sources` rows via raw SQL — that
//! bypass is exactly why the bug survived: it exercises only the (working)
//! consumer, never the producer.

mod support;

use app_core_projects::project_setup;
use app_core_projects::source_view_generate::generate_source_view;
use contracts_core::projects_v2::{ProjectCreateRequest, ProjectSourceAddRequest, ProjectTool};
use contracts_core::source_view_generate::SourceViewGenerateRequest;
use persistence_db::repositories::plans as plans_repo;
use uuid::Uuid;

/// These tests never set `canonical_target_id`, so `create`'s promotion path
/// never touches the resolve cache.
fn empty_cache() -> simbad_resolver::RedbCache {
    simbad_resolver::Store::in_memory().unwrap().cache()
}

/// One real light frame on disk + its `file_record`, plus the
/// `inbox_items`/`inbox_file_metadata` pair that carries its per-sub
/// exposure (the same shape `sessions_integration.rs` uses for #775).
async fn insert_frame(
    pool: &sqlx::SqlitePool,
    root_dir: &std::path::Path,
    root_id: &str,
    frame_id: &str,
    exposure_s: Option<f64>,
) {
    let relative = format!("{frame_id}.fits");
    std::fs::write(root_dir.join(&relative), b"canonical-bytes").unwrap();

    sqlx::query(
        "INSERT OR IGNORE INTO library_root (id, label, current_path, kind, state, created_at)
         VALUES (?, ?, ?, 'local', 'active', datetime('now'))",
    )
    .bind(root_id)
    .bind(root_id)
    .bind(root_dir.to_str().unwrap())
    .execute(pool)
    .await
    .expect("insert library_root");

    sqlx::query(
        "INSERT INTO file_record
            (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 100, datetime('now'), 'classified', datetime('now'), datetime('now'))",
    )
    .bind(frame_id)
    .bind(root_id)
    .bind(&relative)
    .execute(pool)
    .await
    .expect("insert file_record");

    let Some(exposure_s) = exposure_s else { return };
    let item_id = format!("item-{frame_id}");
    sqlx::query(
        "INSERT INTO inbox_items (id, root_id, relative_path, discovered_at, last_scanned_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    )
    .bind(&item_id)
    .bind(root_id)
    .bind(&relative)
    .execute(pool)
    .await
    .expect("insert inbox_items");

    sqlx::query(
        "INSERT INTO inbox_file_metadata (id, inbox_item_id, relative_file_path, exposure_s)
         VALUES (?, ?, ?, ?)",
    )
    .bind(format!("meta-{frame_id}"))
    .bind(&item_id)
    .bind(&relative)
    .bind(exposure_s)
    .execute(pool)
    .await
    .expect("insert inbox_file_metadata");
}

/// An acquisition session keyed exactly the way real ingest keys one
/// (`sessions::session_key`: `target|filter|binning|gain|night`).
async fn insert_session(
    pool: &sqlx::SqlitePool,
    session_id: &str,
    root_id: &str,
    filter: &str,
    frame_ids: &[&str],
) {
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
         VALUES (?, ?, ?, ?, '2026-01-12T00:00:00Z')",
    )
    .bind(session_id)
    .bind(format!("M 33|{filter}|1x1|100|2026-01-12"))
    .bind(root_id)
    .bind(serde_json::to_string(frame_ids).unwrap())
    .execute(pool)
    .await
    .expect("insert acquisition_session");
}

struct World {
    db: persistence_db::Database,
    bus: audit::bus::EventBus,
    root_dir: tempfile::TempDir,
    projects_dir: tempfile::TempDir,
}

async fn world() -> World {
    let (db, _repo, bus) = support::setup().await;
    let root_dir = tempfile::tempdir().unwrap();
    let projects_dir = tempfile::tempdir().unwrap();
    support::register_project_root(db.pool(), projects_dir.path().to_str().unwrap()).await;
    World { db, bus, root_dir, projects_dir }
}

fn create_req(name: &str, initial_sources: Vec<String>) -> ProjectCreateRequest {
    ProjectCreateRequest {
        request_id: Uuid::new_v4().to_string(),
        name: name.to_owned(),
        tool: ProjectTool::PixInsight,
        path: name.to_owned(),
        initial_sources,
        notes: None,
        canonical_target_id: None,
        is_mosaic: false,
    }
}

/// The generated plan's first `link` destination, relative to the project's
/// `source-views/<plan_id>/` tree — i.e. the `{date}/{filter}/{exposure}`
/// segments the WBPP profile lays out.
async fn generated_layout(
    pool: &sqlx::SqlitePool,
    project_id: &str,
    project_path: &str,
) -> Vec<String> {
    let resp = generate_source_view(
        pool,
        &SourceViewGenerateRequest {
            project_id: project_id.to_owned(),
            profile_id: None,
            destination_override: None,
            copy_opt_in: true,
            strict: false,
        },
    )
    .await
    .expect("generate_source_view");

    let items = plans_repo::list_plan_items(pool, &resp.plan_id).await.unwrap();
    let link = items.iter().find(|i| i.action == "link").expect("one link item");
    let prefix = format!("{project_path}/source-views/{}/", resp.plan_id);
    let tail = link
        .to_relative_path
        .replace('\\', "/")
        .strip_prefix(&prefix.replace('\\', "/"))
        .unwrap_or_else(|| panic!("{} should start with {prefix}", link.to_relative_path))
        .to_owned();
    tail.split('/').map(ToOwned::to_owned).collect()
}

#[tokio::test]
async fn create_with_initial_source_snapshots_real_filter_and_exposure() {
    let w = world().await;
    let pool = w.db.pool();
    insert_frame(pool, w.root_dir.path(), "root-1", "frame-1", Some(300.0)).await;
    insert_frame(pool, w.root_dir.path(), "root-1", "frame-2", Some(300.0)).await;
    insert_session(pool, "ses-1", "root-1", "Ha", &["frame-1", "frame-2"]).await;

    let res = project_setup::create(
        pool,
        &w.bus,
        &empty_cache(),
        &create_req("p1", vec!["ses-1".to_owned()]),
    )
    .await
    .expect("create");

    let detail = project_setup::get(pool, &res.project_id).await.expect("get");
    let src = &detail.sources[0];
    assert_eq!(src.filter, "Ha", "the source must snapshot the session's real filter");
    assert_eq!(src.exposure, "300s", "the source must snapshot the real PER-SUB exposure");
    assert_eq!(src.frames, 2, "the source must snapshot the active frame count");
    assert!(src.name.contains("M 33"), "expected a real session label, got {:?}", src.name);

    let project_path = format!("{}/p1", w.projects_dir.path().to_str().unwrap());
    let layout = generated_layout(pool, &res.project_id, &project_path).await;
    assert_eq!(
        layout[1], "Ha",
        "the WBPP layout must use the real filter, not the `nofilter` fallback: {layout:?}"
    );
    assert_eq!(
        layout[2], "300s",
        "the WBPP layout must use the real per-sub exposure, not `unknown-exposure`: {layout:?}"
    );
}

#[tokio::test]
async fn add_source_snapshots_real_filter_and_exposure() {
    let w = world().await;
    let pool = w.db.pool();
    insert_frame(pool, w.root_dir.path(), "root-2", "frame-3", Some(60.0)).await;
    insert_session(pool, "ses-2", "root-2", "OIII", &["frame-3"]).await;

    let created = project_setup::create(pool, &w.bus, &empty_cache(), &create_req("p2", vec![]))
        .await
        .expect("create");

    let added = project_setup::add_source(
        pool,
        &w.bus,
        &ProjectSourceAddRequest {
            request_id: Uuid::new_v4().to_string(),
            project_id: created.project_id.clone(),
            inventory_session_id: "ses-2".to_owned(),
        },
    )
    .await
    .expect("add_source");

    assert_eq!(added.source_added.filter, "OIII");
    assert_eq!(added.source_added.exposure, "60s");
    assert_eq!(added.source_added.frames, 1);

    let project_path = format!("{}/p2", w.projects_dir.path().to_str().unwrap());
    let layout = generated_layout(pool, &created.project_id, &project_path).await;
    assert_eq!(layout[1], "OIII", "{layout:?}");
    assert_eq!(layout[2], "60s", "{layout:?}");
}

/// Exposure is not part of `session_key`, so one session can hold several
/// per-sub exposures. No single scalar is truthful there, so the snapshot
/// stays empty and the pattern registry's documented `unknown-exposure`
/// fallback applies — the filter, which IS keyed, still resolves for real.
#[tokio::test]
async fn mixed_per_sub_exposures_fall_back_but_keep_the_real_filter() {
    let w = world().await;
    let pool = w.db.pool();
    insert_frame(pool, w.root_dir.path(), "root-3", "frame-4", Some(120.0)).await;
    insert_frame(pool, w.root_dir.path(), "root-3", "frame-5", Some(300.0)).await;
    insert_session(pool, "ses-3", "root-3", "SII", &["frame-4", "frame-5"]).await;

    let res = project_setup::create(
        pool,
        &w.bus,
        &empty_cache(),
        &create_req("p3", vec!["ses-3".to_owned()]),
    )
    .await
    .expect("create");

    let detail = project_setup::get(pool, &res.project_id).await.expect("get");
    assert_eq!(detail.sources[0].filter, "SII");
    assert_eq!(detail.sources[0].exposure, "", "a mixed-exposure session has no per-sub token");

    let project_path = format!("{}/p3", w.projects_dir.path().to_str().unwrap());
    let layout = generated_layout(pool, &res.project_id, &project_path).await;
    assert_eq!(layout[1], "SII", "{layout:?}");
    assert_eq!(layout[2], "unknown-exposure", "{layout:?}");
}

/// A frame with no reachable exposure metadata (the shape the spec-049
/// real-UI journey's fixture produces: a FITS file with no `EXPTIME` card)
/// keeps the real filter and falls back only on exposure.
#[tokio::test]
async fn missing_exposure_metadata_keeps_the_real_filter() {
    let w = world().await;
    let pool = w.db.pool();
    insert_frame(pool, w.root_dir.path(), "root-4", "frame-6", None).await;
    insert_session(pool, "ses-4", "root-4", "Ha", &["frame-6"]).await;

    let res = project_setup::create(
        pool,
        &w.bus,
        &empty_cache(),
        &create_req("p4", vec!["ses-4".to_owned()]),
    )
    .await
    .expect("create");

    let project_path = format!("{}/p4", w.projects_dir.path().to_str().unwrap());
    let layout = generated_layout(pool, &res.project_id, &project_path).await;
    assert_eq!(layout[1], "Ha", "{layout:?}");
    assert_eq!(layout[2], "unknown-exposure", "{layout:?}");
}
