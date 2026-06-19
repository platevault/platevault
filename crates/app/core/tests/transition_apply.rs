//! T029 + T050 — integration tests for `transition_use_case::apply_transition`
//! against a real `SqliteLifecycleRepository` + migrations.
//!
//! Covers the scenarios called out in tasks.md T029:
//! 1. Success path — entity row + audit row both committed.
//! 2. Refused (disallowed edge) — no mutation, no audit row.
//! 3. Same-state no-op — sentinel response, no rows.
//! 4. Plan-required — refusal with `plan.required` code, no mutation.
//!
//! And T050 (action-bound review, FR-009/FR-010):
//! 5. Refused (`provenance.unreviewed`) when `observer_location` is not
//!    `reviewed` on `acquisition_session.candidate → confirmed`.
//!    (Clarified 2026-05-23 — gate sits on the confirmation edges, not
//!    on the pipeline-driven entry-to-review edge.)
//! 6. Success path when the same field carries a `reviewed` origin.

use app_core::lifecycle_use_case::build_edge_table;
use app_core::transition_use_case::apply_transition;
use audit::bus::EventBus;
use contracts_core::lifecycle::{
    InventorySessionTransitionRequest, ProjectState, ProjectTransitionRequest, SessionState,
    TransitionActor, TransitionErrorCode, TransitionRequest, TransitionStatus,
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

/// Insert a project into the canonical `projects` table (spec-008, migration 0018).
/// After migration 0036, this is the sole owner of project lifecycle state.
/// The legacy `project.state` column was dropped; user-IPC transitions now
/// read/write `projects.lifecycle` via `table_for(EntityType::Project)` = "projects".
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
    // FR-019 / T052: canonical lifecycle is now in `projects.lifecycle`
    let (state,): (String,) = sqlx::query_as("SELECT lifecycle FROM projects WHERE id = ?")
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
    // Entity unchanged — FR-019: canonical lifecycle in `projects.lifecycle`.
    let (state,): (String,) = sqlx::query_as("SELECT lifecycle FROM projects WHERE id = ?")
        .bind(&project)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "processing");

    // Refused-outcome audit row is DURABLE per data-model.md §242 / §378:
    // refusals MUST be audit-logged, not merely observable in the response.
    let (refused_rows, to_state, outcome, actor, payload): (
        i64,
        Option<String>,
        String,
        String,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT COUNT(*), MAX(to_state), MAX(outcome), MAX(actor), MAX(payload) \
         FROM audit_log_entry WHERE entity_id = ? AND outcome = 'refused'",
    )
    .bind(&project)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(refused_rows, 1, "exactly one refused row must exist");
    assert!(to_state.is_none(), "refused rows MUST have to_state == null (data-model.md:376)");
    assert_eq!(outcome, "refused");
    assert_eq!(actor, "user");
    let payload = payload.expect("payload populated");
    assert!(payload.contains("\"code\":\"transition.refused\""));
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
    // Entity unchanged — FR-019: canonical lifecycle in `projects.lifecycle`.
    let (state,): (String,) = sqlx::query_as("SELECT lifecycle FROM projects WHERE id = ?")
        .bind(&project)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "ready");
}

// ── T050 — action-bound review (FR-009/FR-010) ───────────────────────────────

async fn insert_acquisition_session(pool: &sqlx::SqlitePool, id: &str, state: &str) {
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, state, created_at) \
         VALUES (?, 'KEY', '[]', ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_prov_row(
    pool: &sqlx::SqlitePool,
    asset_id: &str,
    field_path: &str,
    origin: &str,
    value_json: &str,
) {
    sqlx::query(
        "INSERT INTO provenance_history_archive \
         (id, asset_type, asset_id, field_path, origin, value, captured_at, source_id, replaced_by, archived_at) \
         VALUES (?, 'acquisition_session', ?, ?, ?, ?, '2026-05-01T00:00:00Z', NULL, NULL, '2026-05-01T00:00:00Z')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(asset_id)
    .bind(field_path)
    .bind(origin)
    .bind(value_json)
    .execute(pool)
    .await
    .unwrap();
}

fn session_request(
    id: Uuid,
    from: SessionState,
    to: SessionState,
    actor: TransitionActor,
) -> TransitionRequest {
    TransitionRequest::InventorySession(InventorySessionTransitionRequest {
        contract_version: "2.0.0".to_owned(),
        request_id: Uuid::new_v4(),
        entity_type: "inventory_session".to_owned(),
        entity_id: id,
        current_state: from,
        next_state: to,
        action_label: None,
        actor,
    })
}

#[tokio::test]
async fn provenance_unreviewed_refusal_when_observer_location_only_observed() {
    let (db, repo, bus) = setup().await;
    let session = Uuid::new_v4().to_string();
    insert_acquisition_session(db.pool(), &session, "candidate").await;
    // observer_location carries an `observed` origin — NOT reviewed.
    insert_prov_row(db.pool(), &session, "observer_location", "observed", r#"{"tz":"UTC"}"#).await;

    let session_uuid = Uuid::parse_str(&session).unwrap();
    let table = build_edge_table();

    let resp = apply_transition(
        &repo,
        &bus,
        session_request(
            session_uuid,
            SessionState::Candidate,
            SessionState::Confirmed,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    let err = resp.error.expect("must refuse");
    assert_eq!(err.code, TransitionErrorCode::ProvenanceUnreviewed);
    let details = err.details.expect("details populated").0;
    let blocking =
        details.get("blockingFields").and_then(|v| v.as_array()).expect("blockingFields array");
    assert_eq!(blocking.len(), 1);
    assert_eq!(blocking[0].get("fieldPath").and_then(|v| v.as_str()), Some("observer_location"));
    assert_eq!(blocking[0].get("requiredOrigin").and_then(|v| v.as_str()), Some("reviewed"));

    // Durable refused row exists for the provenance.unreviewed refusal too.
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log_entry WHERE entity_id = ? \
         AND outcome = 'refused' AND payload LIKE '%provenance.unreviewed%'",
    )
    .bind(&session)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(count, 1, "provenance.unreviewed refusal must be audit-logged");

    // Entity row unchanged.
    let (state,): (String,) = sqlx::query_as("SELECT state FROM acquisition_session WHERE id = ?")
        .bind(&session)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "candidate");
}

#[tokio::test]
async fn provenance_unreviewed_refusal_when_field_missing_entirely() {
    let (db, repo, bus) = setup().await;
    let session = Uuid::new_v4().to_string();
    insert_acquisition_session(db.pool(), &session, "candidate").await;
    // No provenance rows at all — must still refuse.

    let session_uuid = Uuid::parse_str(&session).unwrap();
    let table = build_edge_table();

    let resp = apply_transition(
        &repo,
        &bus,
        session_request(
            session_uuid,
            SessionState::Candidate,
            SessionState::Confirmed,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    assert_eq!(
        resp.error.as_ref().map(|e| e.code),
        Some(TransitionErrorCode::ProvenanceUnreviewed)
    );
}

#[tokio::test]
async fn provenance_reviewed_allows_candidate_to_confirmed() {
    let (db, repo, bus) = setup().await;
    let session = Uuid::new_v4().to_string();
    insert_acquisition_session(db.pool(), &session, "candidate").await;
    insert_prov_row(
        db.pool(),
        &session,
        "observer_location",
        "reviewed",
        r#"{"tz":"Europe/Amsterdam"}"#,
    )
    .await;

    let session_uuid = Uuid::parse_str(&session).unwrap();
    let table = build_edge_table();

    let resp = apply_transition(
        &repo,
        &bus,
        session_request(
            session_uuid,
            SessionState::Candidate,
            SessionState::Confirmed,
            TransitionActor::User,
        ),
        &table,
    )
    .await;

    // Inventory/AcquisitionSession is not plan-required so this must succeed.
    assert_eq!(resp.status, TransitionStatus::Success, "resp = {resp:?}");
    let (state,): (String,) = sqlx::query_as("SELECT state FROM acquisition_session WHERE id = ?")
        .bind(&session)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "confirmed");
}
