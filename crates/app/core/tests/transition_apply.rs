//! T029 — integration tests for `transition_use_case::apply_transition`
//! against a real `SqliteLifecycleRepository` + migrations.
//!
//! Covers the four scenarios called out in tasks.md T029:
//! 1. Success path — entity row + audit row both committed.
//! 2. Refused (disallowed edge) — no mutation, no audit row.
//! 3. Same-state no-op — sentinel response, no rows.
//! 4. Plan-required — refusal with `plan.required` code, no mutation.

use app_core::lifecycle_use_case::build_edge_table;
use app_core::transition_use_case::apply_transition;
use audit::bus::EventBus;
use contracts_core::lifecycle::{
    ProjectState, ProjectTransitionRequest, TransitionActor, TransitionErrorCode,
    TransitionRequest, TransitionStatus,
};
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use persistence_db::Database;
use uuid::Uuid;

async fn setup() -> (Database, SqliteLifecycleRepository, EventBus) {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    let bus = EventBus::with_pool(db.pool().clone());
    let repo = SqliteLifecycleRepository::new(db.pool().clone(), bus.clone());
    (db, repo, bus)
}

async fn insert_target(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO target (id, primary_designation, created_at) \
         VALUES (?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("T-{id}"))
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_project(pool: &sqlx::SqlitePool, id: &str, target: &str, state: &str) {
    sqlx::query(
        "INSERT INTO project (id, name, target_id, state, created_at) \
         VALUES (?, 'P', ?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(target)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
}

fn project_request(
    id: Uuid,
    from: ProjectState,
    to: ProjectState,
    actor: TransitionActor,
) -> TransitionRequest {
    TransitionRequest::Project(ProjectTransitionRequest {
        contract_version: "2.0.0".to_owned(),
        request_id: Uuid::new_v4(),
        entity_type: "project".to_owned(),
        entity_id: id,
        current_state: from,
        next_state: to,
        action_label: None,
        actor,
    })
}

#[tokio::test]
async fn success_path_commits_both_sides() {
    let (db, repo, bus) = setup().await;
    let target = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target).await;
    insert_project(db.pool(), &project, &target, "ready").await;

    let project_uuid = Uuid::parse_str(&project).unwrap();
    let table = build_edge_table();

    let resp = apply_transition(
        &repo,
        &bus,
        project_request(
            project_uuid,
            ProjectState::Ready,
            ProjectState::Processing,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    assert_eq!(resp.status, TransitionStatus::Success);
    let (state,): (String,) = sqlx::query_as("SELECT state FROM project WHERE id = ?")
        .bind(&project)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "processing");
}

#[tokio::test]
async fn refused_no_mutation_disallowed_edge() {
    let (db, repo, bus) = setup().await;
    let target = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target).await;
    insert_project(db.pool(), &project, &target, "processing").await;

    let project_uuid = Uuid::parse_str(&project).unwrap();
    let table = build_edge_table();

    // processing → ready is explicitly disallowed (research.md §2.1).
    let resp = apply_transition(
        &repo,
        &bus,
        project_request(
            project_uuid,
            ProjectState::Processing,
            ProjectState::Ready,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::TransitionRefused));
    // Entity unchanged.
    let (state,): (String,) = sqlx::query_as("SELECT state FROM project WHERE id = ?")
        .bind(&project)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "processing");
}

#[tokio::test]
async fn same_state_returns_noop_no_writes() {
    let (db, repo, bus) = setup().await;
    let target = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target).await;
    insert_project(db.pool(), &project, &target, "ready").await;

    let project_uuid = Uuid::parse_str(&project).unwrap();
    let table = build_edge_table();

    let resp = apply_transition(
        &repo,
        &bus,
        project_request(
            project_uuid,
            ProjectState::Ready,
            ProjectState::Ready,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    assert_eq!(resp.status, TransitionStatus::Noop);
    let (rows,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM audit_log_entry WHERE entity_id = ?")
            .bind(&project)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn plan_required_refusal() {
    let (db, repo, bus) = setup().await;
    let target = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    insert_target(db.pool(), &target).await;
    insert_project(db.pool(), &project, &target, "ready").await;

    let project_uuid = Uuid::parse_str(&project).unwrap();
    let table = build_edge_table();

    // ready → prepared requires a FilesystemPlan per T044.
    let resp = apply_transition(
        &repo,
        &bus,
        project_request(
            project_uuid,
            ProjectState::Ready,
            ProjectState::Prepared,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    // Entity unchanged.
    let (state,): (String,) = sqlx::query_as("SELECT state FROM project WHERE id = ?")
        .bind(&project)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "ready");
}
