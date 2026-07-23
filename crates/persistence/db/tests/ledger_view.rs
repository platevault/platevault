// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for the materialised ledger view + `list_assets_ledger`.
//!
//! Boots an in-memory `SQLite` pool, runs all migrations, inserts seed rows
//! across multiple entity tables, then exercises the various filter
//! combinations supported by `LedgerFilter`.

use audit::bus::EventBus;
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::lifecycle::{
    LedgerFilter, LifecycleRepository, SqliteLifecycleRepository,
};
use persistence_db::Database;
use uuid::Uuid;

async fn setup() -> (Database, SqliteLifecycleRepository) {
    let db = Database::in_memory().await.expect("in-memory connect");
    db.migrate().await.expect("migrations");
    let repo =
        SqliteLifecycleRepository::new(db.pool().clone(), EventBus::new(db.pool().clone(), 16));
    (db, repo)
}

fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

async fn insert_library_root(pool: &sqlx::SqlitePool, id: &str, label: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, last_seen_at, created_at) \
         VALUES (?, ?, '/tmp/lr', 'local', 'active', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(label)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_target(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO target (id, primary_designation, created_at) \
         VALUES (?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("DES-{id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Insert a project into the canonical `projects` table used by the baseline ledger view.
async fn insert_project(
    pool: &sqlx::SqlitePool,
    id: &str,
    name: &str,
    _target_id: &str,
    state: &str,
    created_at: &str,
) {
    // Use the id as part of the path to avoid UNIQUE(path) collisions.
    let path = format!("projects/{id}");
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, ?, 'PixInsight', ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(state)
    .bind(&path)
    .bind(created_at)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_file_record(
    pool: &sqlx::SqlitePool,
    id: &str,
    root_id: &str,
    rel_path: &str,
    state: &str,
    last_seen_at: &str,
) {
    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES (?, ?, ?, 0, '2026-05-01T00:00:00Z', ?, '2026-05-01T00:00:00Z', ?)",
    )
    .bind(id)
    .bind(root_id)
    .bind(rel_path)
    .bind(state)
    .bind(last_seen_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn ledger_view_unions_all_seeded_entities() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    let project = new_uuid();
    let file = new_uuid();

    insert_library_root(pool, &root, "lr-1").await;
    insert_target(pool, &target).await;
    insert_project(pool, &project, "Test Project", &target, "ready", "2026-05-10T00:00:00Z").await;
    insert_file_record(
        pool,
        &file,
        &root,
        "raw/2026-05-10/light.fits",
        "observed",
        "2026-05-11T00:00:00Z",
    )
    .await;

    let rows = repo.list_assets_ledger(LedgerFilter::default()).await.unwrap();
    // 1 library_root + 1 project + 1 file = 3 rows. Spec 041 FR-051 (T076):
    // acquisition_session/calibration_session were dropped from ledger_view —
    // sessions no longer carry a review-transitionable lifecycle state.
    assert_eq!(rows.len(), 3, "rows = {rows:#?}");
}

#[tokio::test]
async fn entity_type_filter_restricts_results() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    let project = new_uuid();

    insert_library_root(pool, &root, "lr").await;
    insert_target(pool, &target).await;
    insert_project(pool, &project, "P", &target, "ready", "2026-05-10T00:00:00Z").await;

    let filter = LedgerFilter { entity_types: vec![EntityType::Project], ..Default::default() };
    let rows = repo.list_assets_ledger(filter).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_type, EntityType::Project);
    assert_eq!(rows[0].title.as_deref(), Some("P"));
}

#[tokio::test]
async fn state_filter_in_clause() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    insert_library_root(pool, &root, "lr").await;
    insert_target(pool, &target).await;

    let p_ready = new_uuid();
    let p_completed = new_uuid();
    let p_processing = new_uuid();
    insert_project(pool, &p_ready, "ready", &target, "ready", "2026-05-10T00:00:00Z").await;
    insert_project(pool, &p_completed, "completed", &target, "completed", "2026-05-11T00:00:00Z")
        .await;
    insert_project(
        pool,
        &p_processing,
        "processing",
        &target,
        "processing",
        "2026-05-12T00:00:00Z",
    )
    .await;

    let filter = LedgerFilter {
        states: vec!["ready".to_owned(), "completed".to_owned()],
        ..Default::default()
    };
    let rows = repo.list_assets_ledger(filter).await.unwrap();
    assert_eq!(rows.len(), 2);
    for r in &rows {
        assert!(r.current_state == "ready" || r.current_state == "completed");
    }
}

#[tokio::test]
async fn project_id_filter_restricts_to_owning_project() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    let p1 = new_uuid();
    let p2 = new_uuid();
    insert_library_root(pool, &root, "lr").await;
    insert_target(pool, &target).await;
    insert_project(pool, &p1, "P1", &target, "ready", "2026-05-10T00:00:00Z").await;
    insert_project(pool, &p2, "P2", &target, "ready", "2026-05-11T00:00:00Z").await;

    // project_id on a project row equals its own id.
    let filter = LedgerFilter {
        project_id: Some(EntityId::from_uuid(Uuid::parse_str(&p1).unwrap())),
        ..Default::default()
    };
    let rows = repo.list_assets_ledger(filter).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_id.as_uuid().to_string(), p1);
}

#[tokio::test]
async fn updated_range_filter() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    insert_library_root(pool, &root, "lr").await;
    insert_target(pool, &target).await;

    let p_early = new_uuid();
    let p_mid = new_uuid();
    let p_late = new_uuid();
    insert_project(pool, &p_early, "E", &target, "ready", "2026-04-01T00:00:00Z").await;
    insert_project(pool, &p_mid, "M", &target, "ready", "2026-05-15T00:00:00Z").await;
    insert_project(pool, &p_late, "L", &target, "ready", "2026-06-01T00:00:00Z").await;

    let filter = LedgerFilter {
        entity_types: vec![EntityType::Project],
        updated_after: Some("2026-05-01T00:00:00Z".to_owned()),
        updated_before: Some("2026-05-31T00:00:00Z".to_owned()),
        ..Default::default()
    };
    let rows = repo.list_assets_ledger(filter).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title.as_deref(), Some("M"));
}

#[tokio::test]
async fn limit_and_offset_paginate() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let target = new_uuid();
    insert_library_root(pool, &root, "lr").await;
    insert_target(pool, &target).await;

    for i in 0..5 {
        let id = new_uuid();
        insert_project(
            pool,
            &id,
            &format!("P{i}"),
            &target,
            "ready",
            &format!("2026-05-{:02}T00:00:00Z", 10 + i),
        )
        .await;
    }

    let page1 = repo
        .list_assets_ledger(LedgerFilter {
            entity_types: vec![EntityType::Project],
            limit: Some(2),
            offset: Some(0),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page1.len(), 2);

    let page2 = repo
        .list_assets_ledger(LedgerFilter {
            entity_types: vec![EntityType::Project],
            limit: Some(2),
            offset: Some(2),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page2.len(), 2);

    // No overlap.
    let p1_ids: std::collections::HashSet<_> =
        page1.iter().map(|r| r.entity_id.as_uuid().to_string()).collect();
    let p2_ids: std::collections::HashSet<_> =
        page2.iter().map(|r| r.entity_id.as_uuid().to_string()).collect();
    assert!(p1_ids.is_disjoint(&p2_ids));
}

#[tokio::test]
async fn file_record_carries_path_not_title() {
    let (db, repo) = setup().await;
    let pool = db.pool();

    let root = new_uuid();
    let file = new_uuid();
    insert_library_root(pool, &root, "lr").await;
    insert_file_record(
        pool,
        &file,
        &root,
        "raw/2026-05-10/light_001.fits",
        "observed",
        "2026-05-12T00:00:00Z",
    )
    .await;

    let rows = repo
        .list_assets_ledger(LedgerFilter {
            entity_types: vec![EntityType::FileRecord],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].title.is_none());
    assert_eq!(rows[0].path.as_deref(), Some("raw/2026-05-10/light_001.fits"));
}
