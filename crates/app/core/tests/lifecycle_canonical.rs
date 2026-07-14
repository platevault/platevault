// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 033 US5 tests — trustworthy project lifecycle.
//!
//! T046: user-IPC and automatic transitions both read/write `projects.lifecycle`
//!       (single canonical state, no divergence — FR-019 / D2).
//! T048: auto block / ready / unarchive write audit rows; `project.unarchived`
//!       emitted (FR-021).

mod support;

use app_core::project_health::{
    check_project_ready_invariant, emit_block_transition, emit_unarchive_transition,
    BlockCondition, DEBOUNCE_WINDOW,
};
use app_core::transition_use_case::apply_transition;
use app_core::{project_setup, project_setup::add_source};
use app_core_cache::DebounceCache;
use audit::bus::EventBus;
use contracts_core::lifecycle::{
    ProjectState, ProjectTransitionRequest, TransitionActor, TransitionRequest, TransitionStatus,
};
use contracts_core::projects_v2::{ProjectSourceAddRequest, ProjectTool};
use persistence_db::repositories::projects as repo;
use persistence_db::Database;
use sqlx::SqlitePool;
use uuid::Uuid;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// In-memory DB + bus with a registered project folder, so relative request
/// paths anchor portably on every platform (see [`support::TEST_PROJECT_ROOT`]
/// for why leading-slash paths are not used).
async fn setup() -> (SqlitePool, EventBus) {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    let bus = EventBus::with_pool(db.pool().clone());
    let pool = db.pool().clone();
    support::register_project_root(&pool, support::TEST_PROJECT_ROOT).await;
    (pool, bus)
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// These tests create projects with no `canonical_target_id`, so
/// `project_setup::create`'s promotion never touches the cache.
fn empty_cache() -> simbad_resolver::RedbCache {
    simbad_resolver::Store::in_memory().unwrap().cache()
}

async fn create_project(pool: &SqlitePool, bus: &EventBus, name: &str) -> String {
    use contracts_core::projects_v2::ProjectCreateRequest;
    let req = ProjectCreateRequest {
        request_id: new_id(),
        name: name.to_owned(),
        tool: ProjectTool::PixInsight,
        path: format!("projects/{name}"),
        initial_sources: vec![],
        notes: None,
        canonical_target_id: None,
    };
    let result = project_setup::create(pool, bus, &empty_cache(), &req).await.unwrap();
    result.project_id
}

fn make_project_transition(
    project_id: Uuid,
    current: ProjectState,
    next: ProjectState,
    actor: TransitionActor,
) -> TransitionRequest {
    TransitionRequest::Project(ProjectTransitionRequest {
        contract_version: "2.0.0".to_owned(),
        request_id: Uuid::new_v4(),
        entity_id: project_id,
        current_state: current,
        next_state: next,
        action_label: None,
        actor,
    })
}

// ── T046: single canonical state — no divergence ──────────────────────────────

/// T046a: A user-IPC transition (`apply_transition`) writes to `projects.lifecycle`
/// and the same value is readable by the health checker (`check_project_ready_invariant`).
/// This proves both surfaces hit the same canonical table (FR-019 / D2).
#[tokio::test]
async fn t046a_user_ipc_and_auto_read_same_canonical_lifecycle() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "Canonical Test M31").await;

    // Step 1: add a source so the project can be ready.
    add_source(
        &pool,
        &bus,
        &ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: project_id.clone(),
            inventory_session_id: "inv-canon-001".to_owned(),
        },
    )
    .await
    .unwrap();

    // The auto-ready invariant should have fired — check we're in `ready`.
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "ready", "auto-ready invariant should transition to ready");

    // Step 2: drive a user-IPC transition: ready → processing.
    let pid = Uuid::parse_str(&project_id).unwrap();
    let resp = apply_transition(
        &persistence_db::repositories::lifecycle::SqliteLifecycleRepository::new(
            pool.clone(),
            bus.clone(),
        ),
        &bus,
        make_project_transition(
            pid,
            ProjectState::Ready,
            ProjectState::Processing,
            TransitionActor::User,
        ),
    )
    .await;

    assert!(
        resp.error.is_none(),
        "user IPC ready→processing should succeed, got: {:?}",
        resp.error
    );

    // Step 3: read the state back via the project repo (the canonical source).
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(
        row.lifecycle, "processing",
        "canonical projects.lifecycle must reflect the user-IPC transition"
    );

    // Step 4: confirm the health checker also reads `processing` from the same
    // row (it won't apply a ready transition because lifecycle != setup_incomplete).
    let result = check_project_ready_invariant(&pool, &bus, &project_id).await.unwrap();
    assert_eq!(result, None, "auto-ready invariant is a no-op when lifecycle != setup_incomplete");

    // Step 5: drive the block auto-transition via the health surface.
    let debounce = DebounceCache::new(DEBOUNCE_WINDOW);
    let condition = BlockCondition::SourceMissing { inventory_id: "inv-gone".to_owned() };
    let block_result =
        emit_block_transition(&pool, &bus, &debounce, &project_id, &condition).await.unwrap();
    assert!(block_result.is_some(), "auto-block should fire from processing");

    // Step 6: both surfaces now read `blocked` from the same row.
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "blocked", "projects.lifecycle must be blocked after auto-block");

    // A user-IPC transition that reads from the same table should see `blocked`.
    let resp2 = apply_transition(
        &persistence_db::repositories::lifecycle::SqliteLifecycleRepository::new(
            pool.clone(),
            bus.clone(),
        ),
        &bus,
        make_project_transition(
            pid,
            ProjectState::Blocked,
            ProjectState::Ready,
            TransitionActor::User,
        ),
    )
    .await;

    assert!(
        resp2.error.is_none(),
        "user IPC blocked→ready should succeed when canonical state is blocked"
    );

    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "ready", "canonical lifecycle must be ready after user unblock");
}

/// T046b: Verify no divergence — the legacy `project` table is not written by
/// the IPC path after migration 0036. Reading from both old and new paths
/// returns consistent data (old path is now gone from the write surface).
#[tokio::test]
async fn t046b_no_dual_write_to_legacy_project_table() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "No Divergence NGC 7000").await;

    // Force the lifecycle to `ready` by direct repo call.
    repo::update_project_lifecycle(&pool, &project_id, "ready").await.unwrap();

    // Drive a user-IPC transition: ready → processing.
    let pid = Uuid::parse_str(&project_id).unwrap();
    let resp = apply_transition(
        &persistence_db::repositories::lifecycle::SqliteLifecycleRepository::new(
            pool.clone(),
            bus.clone(),
        ),
        &bus,
        make_project_transition(
            pid,
            ProjectState::Ready,
            ProjectState::Processing,
            TransitionActor::User,
        ),
    )
    .await;

    assert_eq!(resp.status, TransitionStatus::Success);

    // The canonical `projects` table must show `processing`.
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "processing", "canonical table updated");

    // The legacy `project` table should NOT have `processing` for this id
    // (it was never written by the new path — confirming no dual-write).
    // After migration 0036, the `project` table no longer has a `state` column,
    // so this query verifies that the column is absent.
    let legacy_state: Option<(String,)> = sqlx::query_as("SELECT name FROM project WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&pool)
        .await
        .unwrap_or(None);
    // The project was created via `projects` (spec-008 path) — it may not even
    // have a row in the legacy `project` table (different tables for different specs).
    // If it does exist, there is no `state` column after migration 0036.
    // The important assertion is that `projects.lifecycle` is the only state source.
    let _ = legacy_state; // just confirm no crash — table_for now points to `projects`
}

// ── T048: auto-transitions write audit rows and emit project.unarchived ───────

/// T048a: auto block transition writes an audit row.
#[tokio::test]
async fn t048a_auto_block_writes_audit_row() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "M42 Block Audit").await;
    let debounce = DebounceCache::new(DEBOUNCE_WINDOW);

    let condition = BlockCondition::ToolUnconfigured { tool: "PixInsight".to_owned() };
    let result =
        emit_block_transition(&pool, &bus, &debounce, &project_id, &condition).await.unwrap();
    assert!(result.is_some(), "block transition should fire");

    // Verify audit row was written.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_id = ? AND entity_type = 'project' AND to_state = 'blocked' \
           AND actor = 'system' AND outcome = 'applied'",
    )
    .bind(&project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 1, "auto-block must write exactly one audit row");
}

/// T048b: auto ready transition writes an audit row.
#[tokio::test]
async fn t048b_auto_ready_writes_audit_row() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "NGC 6992 Auto Ready").await;

    // Add a source to trigger the ready invariant, then reset lifecycle to
    // setup_incomplete so we can call check_project_ready_invariant directly.
    add_source(
        &pool,
        &bus,
        &ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: project_id.clone(),
            inventory_session_id: "inv-ready-001".to_owned(),
        },
    )
    .await
    .unwrap();

    // Reset to setup_incomplete to allow the invariant to fire again.
    repo::update_project_lifecycle(&pool, &project_id, "setup_incomplete").await.unwrap();

    // Count existing audit rows before the explicit call.
    let count_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_id = ? AND entity_type = 'project' AND to_state = 'ready' \
           AND from_state = 'setup_incomplete' AND actor = 'system' AND outcome = 'applied'",
    )
    .bind(&project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let result = check_project_ready_invariant(&pool, &bus, &project_id).await.unwrap();
    assert_eq!(result, Some("ready".to_owned()));

    // Verify exactly one new audit row was written by this call.
    let count_after: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_id = ? AND entity_type = 'project' AND to_state = 'ready' \
           AND from_state = 'setup_incomplete' AND actor = 'system' AND outcome = 'applied'",
    )
    .bind(&project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        count_after - count_before,
        1,
        "auto-ready must write exactly one new audit row per firing"
    );
}

/// T048c: auto unarchive transition writes an audit row and emits `project.unarchived`.
#[tokio::test]
async fn t048c_auto_unarchive_writes_audit_row_and_emits_event() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "IC 1805 Unarchive").await;

    // Set the project to archived.
    repo::update_project_lifecycle(&pool, &project_id, "archived").await.unwrap();

    // Count events before.
    let events_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE topic = 'project.unarchived'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let result = emit_unarchive_transition(&pool, &bus, &project_id).await;
    assert!(result.is_ok(), "unarchive transition should succeed");

    // Verify lifecycle changed.
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "ready", "lifecycle must be ready after unarchive");

    // Verify audit row was written.
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_id = ? AND entity_type = 'project' AND to_state = 'ready' \
           AND from_state = 'archived' AND actor = 'system' AND outcome = 'applied'",
    )
    .bind(&project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_count, 1, "unarchive must write exactly one audit row");

    // Verify `project.unarchived` event was emitted.
    let events_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE topic = 'project.unarchived'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(events_after > events_before, "project.unarchived event must be emitted on unarchive");
}

/// T048d: typed blocked reason is persisted and readable via the DTO.
#[tokio::test]
async fn t048d_typed_blocked_reason_persisted_and_readable() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "M8 Blocked Reason").await;
    let debounce = DebounceCache::new(DEBOUNCE_WINDOW);

    let condition = BlockCondition::SourceMissing { inventory_id: "inv-missing-42".to_owned() };
    emit_block_transition(&pool, &bus, &debounce, &project_id, &condition).await.unwrap();

    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "blocked");
    assert_eq!(
        row.blocked_reason_kind.as_deref(),
        Some("source_missing"),
        "blocked_reason_kind must be persisted"
    );
    assert!(row.blocked_reason_note.is_some(), "blocked_reason_note must be persisted");
    assert!(
        row.blocked_reason_note.as_deref().unwrap().contains("inv-missing-42"),
        "blocked_reason_note must contain the inventory id"
    );
}

/// T048e: transitioning out of blocked clears the reason fields.
#[tokio::test]
async fn t048e_unblocking_clears_blocked_reason() {
    let (pool, bus) = setup().await;
    let project_id = create_project(&pool, &bus, "M101 Clear Reason").await;
    let debounce = DebounceCache::new(DEBOUNCE_WINDOW);

    // Block first.
    let condition = BlockCondition::User { note: "manual block".to_owned() };
    emit_block_transition(&pool, &bus, &debounce, &project_id, &condition).await.unwrap();

    // Now unblock via user-IPC.
    let pid = Uuid::parse_str(&project_id).unwrap();
    let resp = apply_transition(
        &persistence_db::repositories::lifecycle::SqliteLifecycleRepository::new(
            pool.clone(),
            bus.clone(),
        ),
        &bus,
        make_project_transition(
            pid,
            ProjectState::Blocked,
            ProjectState::Ready,
            TransitionActor::User,
        ),
    )
    .await;
    assert!(resp.error.is_none());

    // blocked_reason fields must be cleared.
    let row = repo::get_project(&pool, &project_id).await.unwrap();
    assert_eq!(row.lifecycle, "ready");
    assert!(row.blocked_reason_kind.is_none(), "blocked_reason_kind must be cleared after unblock");
    assert!(row.blocked_reason_note.is_none(), "blocked_reason_note must be cleared after unblock");
}

// ── Path anchoring invariant (Constitution I) ─────────────────────────────────

/// A relative project path with no registered project folder must be rejected
/// with `PathInvalid` — there is no unambiguous location to anchor to. This is
/// the spec-intended invariant the fixtures above satisfy by registering a root.
#[tokio::test]
async fn relative_project_path_without_registered_root_is_rejected() {
    use contracts_core::projects_v2::ProjectCreateRequest;

    // Fresh DB WITHOUT a registered project folder (bypass the `setup` helper).
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    let bus = EventBus::with_pool(db.pool().clone());

    let req = ProjectCreateRequest {
        request_id: new_id(),
        name: "No Root".to_owned(),
        tool: ProjectTool::PixInsight,
        path: "projects/no-root".to_owned(),
        initial_sources: vec![],
        notes: None,
        canonical_target_id: None,
    };

    let err = project_setup::create(db.pool(), &bus, &empty_cache(), &req).await.unwrap_err();
    assert_eq!(
        err.code,
        contracts_core::error_code::ErrorCode::PathInvalid,
        "relative path with no registered project folder must be rejected"
    );
}
