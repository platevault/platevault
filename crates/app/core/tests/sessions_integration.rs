#![allow(clippy::doc_markdown)]
//! Layer-1 integration tests for the sessions coverage area — feature 037 (T???).
//!
//! Covers:
//! 1. `inventory::review_session` — session-not-found error path.
//! 2. `inventory::review_session` — same-state noop (idempotency).
//! 3. `inventory::review_session` — discovered → candidate success path;
//!    persisted state is read back from DB.
//! 4. `sessions::merge_sessions` / `sessions::split_session` — stub error
//!    contracts verified against the real in-memory pool.
//!
//! Uses the shared harness in `tests/support/mod.rs`:
//!   `setup()` → `(Database, SqliteLifecycleRepository, EventBus)`
//! and raw-SQL seed helpers modelled after `transition_apply.rs`.

mod support;

use app_core::inventory::review_session;
use contracts_core::inventory::{InventorySessionReviewRequest, InventorySessionState};
use uuid::Uuid;

// ── Seed helpers ─────────────────────────────────────────────────────────────

/// Insert a minimal `acquisition_session` row.
///
/// Schema (migration 0002_lifecycle.sql):
///   id TEXT PK, session_key TEXT, frame_ids TEXT (JSON), state TEXT CHECK(...),
///   created_at TEXT
async fn insert_acquisition_session(pool: &sqlx::SqlitePool, id: &str, state: &str) {
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, frame_ids, state, created_at) \
         VALUES (?, 'KEY', '[]', ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(state)
    .execute(pool)
    .await
    .expect("insert acquisition_session");
}

// ── 1. review_session: session not found ─────────────────────────────────────

#[tokio::test]
async fn review_session_returns_error_when_session_not_found() {
    let (db, repo, bus) = support::setup().await;

    let missing_id = Uuid::new_v4().to_string();
    let req = InventorySessionReviewRequest {
        contract_version: "1.0.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: missing_id.clone(),
        next_state: InventorySessionState::Candidate,
        action_label: None,
        actor: "user".to_owned(),
    };

    let resp = review_session(db.pool(), &repo, &bus, req).await;

    assert_eq!(resp.status, "error", "expected error status, got: {resp:?}");
    let err = resp.error.expect("error field must be set on error status");
    assert_eq!(
        err.code, "session.not_found",
        "expected session.not_found code, got: {:?}",
        err.code
    );
}

// ── 2. review_session: same-state noop (idempotency) ────────────────────────

#[tokio::test]
async fn review_session_noop_when_already_in_target_state() {
    let (db, repo, bus) = support::setup().await;

    let session_id = Uuid::new_v4().to_string();
    insert_acquisition_session(db.pool(), &session_id, "candidate").await;

    let req = InventorySessionReviewRequest {
        contract_version: "1.0.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        next_state: InventorySessionState::Candidate, // same as current
        action_label: None,
        actor: "user".to_owned(),
    };

    let resp = review_session(db.pool(), &repo, &bus, req).await;

    assert_eq!(resp.status, "noop", "expected noop status, got: {resp:?}");

    // State must remain unchanged in the DB.
    let (state,): (String,) = sqlx::query_as("SELECT state FROM acquisition_session WHERE id = ?")
        .bind(&session_id)
        .fetch_one(db.pool())
        .await
        .expect("row must still exist");
    assert_eq!(state, "candidate");
}

// ── 3. review_session: discovered → candidate; persisted state read back ─────

#[tokio::test]
async fn review_session_discovered_to_candidate_persists_new_state() {
    let (db, repo, bus) = support::setup().await;

    let session_id = Uuid::new_v4().to_string();
    insert_acquisition_session(db.pool(), &session_id, "discovered").await;

    let req = InventorySessionReviewRequest {
        contract_version: "1.0.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        next_state: InventorySessionState::Candidate,
        action_label: Some("mark_candidate".to_owned()),
        actor: "user".to_owned(),
    };

    let resp = review_session(db.pool(), &repo, &bus, req).await;

    assert_eq!(resp.status, "success", "expected success, got: {resp:?}");
    assert!(resp.applied_at.is_some(), "applied_at must be set on success");
    assert!(resp.audit_id.is_some(), "audit_id must be set on success");

    // Verify the new state was committed to the DB.
    let (state,): (String,) = sqlx::query_as("SELECT state FROM acquisition_session WHERE id = ?")
        .bind(&session_id)
        .fetch_one(db.pool())
        .await
        .expect("session row must still exist");
    assert_eq!(state, "candidate", "DB must show the new state after transition");
}

// ── 4. sessions stub: merge and split return not-implemented errors ───────────

#[tokio::test]
async fn merge_and_split_stubs_return_not_implemented_errors() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    // split_session stub
    let split_result = app_core::sessions::split_session(pool, "ses-001", "filter").await;
    assert!(split_result.is_err(), "split_session must return Err");
    assert!(
        split_result.unwrap_err().contains("not yet implemented"),
        "error message must mention 'not yet implemented'"
    );

    // merge_sessions stub
    let ids = vec!["ses-001".to_owned(), "ses-002".to_owned()];
    let merge_result = app_core::sessions::merge_sessions(pool, &ids).await;
    assert!(merge_result.is_err(), "merge_sessions must return Err");
    assert!(
        merge_result.unwrap_err().contains("not yet implemented"),
        "error message must mention 'not yet implemented'"
    );
}
