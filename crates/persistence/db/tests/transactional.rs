// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T031 — integration tests covering `SqliteLifecycleRepository::record_transition`
//! transactional behaviour. The contract (data-model.md AuditLogEntry Invariants):
//!
//! 1. A successful transition writes the entity update **and** the audit row
//!    in one transaction.
//! 2. A refused (stale `from_state`) transition writes nothing — the entity
//!    row keeps its prior state AND no `audit_log_entry` row is appended.
//! 3. Noop (from == to) writes nothing.

#![allow(clippy::doc_markdown)]

use audit::bus::EventBus;
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::lifecycle::{
    LifecycleRepository, SqliteLifecycleRepository, TransitionRequest,
};
use persistence_db::{Database, DbError};
use uuid::Uuid;

async fn setup() -> (Database, SqliteLifecycleRepository) {
    let db = Database::in_memory().await.expect("in-memory connect");
    db.migrate().await.expect("migrations");
    let repo =
        SqliteLifecycleRepository::new(db.pool().clone(), EventBus::new(db.pool().clone(), 16));
    (db, repo)
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

/// Insert a project into the canonical `projects` table used by lifecycle transitions.
async fn insert_project(pool: &sqlx::SqlitePool, id: &str, _target: &str, state: &str) {
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, 'P', 'PixInsight', ?, 'projects/P', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
}

async fn audit_row_count(pool: &sqlx::SqlitePool, entity_id: &str) -> i64 {
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM audit_log_entry WHERE entity_id = ?")
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .unwrap();
    n
}

/// Read project lifecycle from the canonical `projects` table.
async fn project_state(pool: &sqlx::SqlitePool, id: &str) -> String {
    let (s,): (String,) = sqlx::query_as("SELECT lifecycle FROM projects WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    s
}

#[tokio::test]
async fn successful_transition_writes_audit_and_entity_together() {
    let (db, repo) = setup().await;
    let target_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target_id).await;
    insert_project(db.pool(), &project_id, &target_id, "ready").await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&project_id).unwrap());
    let record = repo
        .record_transition(TransitionRequest {
            entity_id,
            entity_type: EntityType::Project,
            from_state: "ready".to_owned(),
            to_state: "processing".to_owned(),
            trigger: "Start processing".to_owned(),
            actor: "user".to_owned(),
            request_id: EntityId::new(),
        })
        .await
        .expect("transition succeeds");

    // Both sides committed.
    assert_eq!(project_state(db.pool(), &project_id).await, "processing");
    assert_eq!(audit_row_count(db.pool(), &project_id).await, 1);
    assert_eq!(record.to_state, "processing");
}

#[tokio::test]
async fn refused_transition_rolls_back_both_sides() {
    let (db, repo) = setup().await;
    let target_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target_id).await;
    // Stored state is `ready`; caller claims `prepared` — CAS must fail.
    insert_project(db.pool(), &project_id, &target_id, "ready").await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&project_id).unwrap());
    let result = repo
        .record_transition(TransitionRequest {
            entity_id,
            entity_type: EntityType::Project,
            from_state: "prepared".to_owned(), // stale
            to_state: "processing".to_owned(),
            trigger: "Will fail CAS".to_owned(),
            actor: "user".to_owned(),
            request_id: EntityId::new(),
        })
        .await;

    assert!(matches!(result, Err(DbError::NotFound(_))));

    // Neither side moved.
    assert_eq!(project_state(db.pool(), &project_id).await, "ready");
    assert_eq!(audit_row_count(db.pool(), &project_id).await, 0);
}

#[tokio::test]
async fn noop_transition_writes_nothing() {
    let (db, repo) = setup().await;
    let target_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target_id).await;
    insert_project(db.pool(), &project_id, &target_id, "ready").await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&project_id).unwrap());
    // Noop: from == to.
    let record = repo
        .record_transition(TransitionRequest {
            entity_id,
            entity_type: EntityType::Project,
            from_state: "ready".to_owned(),
            to_state: "ready".to_owned(),
            trigger: "noop".to_owned(),
            actor: "user".to_owned(),
            request_id: EntityId::new(),
        })
        .await
        .expect("noop returns a sentinel record without writing");

    // Sentinel record returned but no rows mutated.
    assert_eq!(record.from_state, "ready");
    assert_eq!(record.to_state, "ready");
    assert_eq!(project_state(db.pool(), &project_id).await, "ready");
    assert_eq!(audit_row_count(db.pool(), &project_id).await, 0);
}

#[tokio::test]
async fn audit_carries_full_envelope_columns() {
    let (db, repo) = setup().await;
    let target_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target_id).await;
    insert_project(db.pool(), &project_id, &target_id, "ready").await;

    let entity_id = EntityId::from_uuid(Uuid::parse_str(&project_id).unwrap());
    let request_id = EntityId::new();
    repo.record_transition(TransitionRequest {
        entity_id,
        entity_type: EntityType::Project,
        from_state: "ready".to_owned(),
        to_state: "processing".to_owned(),
        trigger: "envelope-check".to_owned(),
        actor: "user".to_owned(),
        request_id,
    })
    .await
    .unwrap();

    let (
        entity_type,
        from_state,
        to_state,
        trigger,
        actor,
        outcome,
        severity,
        stored_request_id,
    ): (String, String, String, String, String, String, String, String) = sqlx::query_as(
        "SELECT entity_type, from_state, to_state, trigger, actor, outcome, severity, request_id \
         FROM audit_log_entry WHERE entity_id = ?",
    )
    .bind(&project_id)
    .fetch_one(db.pool())
    .await
    .unwrap();

    assert_eq!(entity_type, "project");
    assert_eq!(from_state, "ready");
    assert_eq!(to_state, "processing");
    assert_eq!(trigger, "envelope-check");
    assert_eq!(actor, "user");
    assert_eq!(outcome, "applied");
    assert_eq!(severity, "workflow");
    assert_eq!(stored_request_id, request_id.as_uuid().to_string());
}
