#![allow(clippy::doc_markdown)]
//! Feature 037 — Layer-1 integration tests for inbox mixed-folder split (#3)
//! and inventory/data-lifecycle state (#4).
//!
//! Uses a real in-memory SQLite DB with migrations applied via the shared
//! `support` harness. No mocks, no file I/O — all assertions are against
//! persisted database state.
//!
//! Test matrix
//! ──────────────────────────────────────────────────────────────────
//! T1. inventory_list_returns_seeded_acquisition_session
//!     Seed a library_root + acquisition_session; assert inventory::list
//!     returns one InventorySource with one session.
//!
//! T2. inventory_list_filters_by_state_excludes_ignored
//!     Seed an ignored acquisition_session; assert the default list (no
//!     filter) omits it, and that a review_filter="ignored" query finds it.
//!
//! T3. inventory_review_session_transitions_state
//!     Seed a `discovered` acquisition_session; drive
//!     inventory::review_session to `candidate` and assert the state column
//!     is updated in the DB and an audit row is written.
//!
//! T4. inbox_item_persists_and_is_readable
//!     Insert an inbox_items row directly (mimicking the scan pipeline) and
//!     assert the row survives a round-trip read through the persistence
//!     repository.

mod support;

use app_core::inventory;
use contracts_core::inventory::{
    InventoryListFilters, InventorySessionReviewRequest, InventorySessionState,
    InventorySourceState,
};
use persistence_db::repositories::inbox::{get_inbox_item, insert_inbox_item, InsertInboxItem};
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Seed a minimal `library_root` row. Returns the inserted id.
async fn insert_library_root(pool: &sqlx::SqlitePool, id: &str, path: &str, state: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, 'Test Root', ?, 'local', ?, '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(path)
    .bind(state)
    .execute(pool)
    .await
    .expect("insert library_root");
}

/// Seed a minimal `acquisition_session` row.
async fn insert_acquisition_session(
    pool: &sqlx::SqlitePool,
    id: &str,
    root_id: &str,
    state: &str,
    target_id: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO acquisition_session \
         (id, session_key, root_id, frame_ids, state, target_id, created_at) \
         VALUES (?, '{}', ?, '[]', ?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(root_id)
    .bind(state)
    .bind(target_id)
    .execute(pool)
    .await
    .expect("insert acquisition_session");
}

// ── T1 ────────────────────────────────────────────────────────────────────────

/// `inventory::list` returns a populated `InventorySource` for seeded rows.
#[tokio::test]
async fn inventory_list_returns_seeded_acquisition_session() {
    let (db, _repo, _bus) = support::setup().await;

    let root_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id, "/data/light", "active").await;
    insert_acquisition_session(db.pool(), &session_id, &root_id, "discovered", None).await;

    let sources = inventory::list(db.pool(), None).await.expect("inventory::list should succeed");

    assert_eq!(sources.len(), 1, "expected one source, got {}", sources.len());

    let source = &sources[0];
    assert_eq!(source.id, root_id, "source id should match root_id");
    assert!(
        matches!(source.state, InventorySourceState::Active),
        "source state should be Active, got {:?}",
        source.state
    );
    assert_eq!(source.sessions.len(), 1, "expected one session, got {}", source.sessions.len());
    assert_eq!(source.sessions[0].id, session_id, "session id should match");
}

// ── T2 ────────────────────────────────────────────────────────────────────────

/// Default `inventory::list` excludes `ignored` sessions; an explicit
/// `review_filter = "ignored"` query finds them.
#[tokio::test]
async fn inventory_list_filters_by_state_excludes_ignored() {
    let (db, _repo, _bus) = support::setup().await;

    let root_id = Uuid::new_v4().to_string();
    let ignored_id = Uuid::new_v4().to_string();
    let visible_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id, "/data/mixed", "active").await;
    insert_acquisition_session(db.pool(), &ignored_id, &root_id, "ignored", None).await;
    insert_acquisition_session(db.pool(), &visible_id, &root_id, "candidate", None).await;

    // Default list (no filter): ignored session must be absent.
    let sources_default =
        inventory::list(db.pool(), None).await.expect("inventory::list (default) should succeed");
    assert_eq!(sources_default.len(), 1, "expected one source for default filter");
    let default_sessions = &sources_default[0].sessions;
    assert_eq!(
        default_sessions.len(),
        1,
        "expected exactly 1 visible session (not the ignored one)"
    );
    assert_eq!(default_sessions[0].id, visible_id, "visible session should be the candidate");

    // Explicit review_filter = "ignored": ignored session must appear.
    let ignored_filter = Some(InventoryListFilters {
        source_filter: None,
        frame_filter: None,
        review_filter: Some("ignored".to_owned()),
    });
    let sources_ignored = inventory::list(db.pool(), ignored_filter)
        .await
        .expect("inventory::list (ignored filter) should succeed");
    assert_eq!(sources_ignored.len(), 1, "expected one source for ignored filter");
    let ignored_sessions = &sources_ignored[0].sessions;
    assert_eq!(ignored_sessions.len(), 1, "expected exactly 1 ignored session");
    assert_eq!(ignored_sessions[0].id, ignored_id, "returned session should be the ignored one");
}

// ── T3 ────────────────────────────────────────────────────────────────────────

/// `inventory::review_session` transitions a `discovered` acquisition_session
/// to `candidate` and writes an audit row.
#[tokio::test]
async fn inventory_review_session_transitions_state() {
    let (db, repo, bus) = support::setup().await;

    let root_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id, "/data/targets", "active").await;
    insert_acquisition_session(db.pool(), &session_id, &root_id, "discovered", None).await;

    let req = InventorySessionReviewRequest {
        contract_version: "1.0.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        next_state: InventorySessionState::Candidate,
        action_label: Some("mark_candidate".to_owned()),
        actor: "user".to_owned(),
    };

    let resp = inventory::review_session(db.pool(), &repo, &bus, req).await;

    assert_eq!(
        resp.status, "success",
        "expected success, got '{}'; error = {:?}",
        resp.status, resp.error
    );

    // Verify the state column was updated in the DB.
    let (new_state,): (String,) =
        sqlx::query_as("SELECT state FROM acquisition_session WHERE id = ?")
            .bind(&session_id)
            .fetch_one(db.pool())
            .await
            .expect("SELECT state from acquisition_session");

    assert_eq!(new_state, "candidate", "DB state should be 'candidate' after transition");

    // Verify an audit row was written.
    let (audit_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log_entry WHERE entity_id = ? AND outcome = 'applied'",
    )
    .bind(&session_id)
    .fetch_one(db.pool())
    .await
    .expect("SELECT COUNT from audit_log_entry");

    assert_eq!(audit_count, 1, "expected 1 applied audit row for session {session_id}");
}

// ── T4 ────────────────────────────────────────────────────────────────────────

/// An inbox_items row inserted via the persistence repository round-trips
/// correctly through `get_inbox_item`.
#[tokio::test]
async fn inbox_item_persists_and_is_readable() {
    let (db, _repo, _bus) = support::setup().await;

    let root_id = Uuid::new_v4().to_string();
    let item_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id, "/data/inbox", "active").await;

    let item = InsertInboxItem {
        id: &item_id,
        root_id: &root_id,
        relative_path: "NGC1234/Ha/2026-05-01",
        file_count: 42,
        content_signature: Some("abc123"),
        lane: "fits",
    };

    insert_inbox_item(db.pool(), &item).await.expect("insert_inbox_item should succeed");

    let row = get_inbox_item(db.pool(), &item_id).await.expect("get_inbox_item should succeed");

    assert_eq!(row.id, item_id, "id round-trip");
    assert_eq!(row.root_id, root_id, "root_id round-trip");
    assert_eq!(row.relative_path, "NGC1234/Ha/2026-05-01", "relative_path round-trip");
    assert_eq!(row.file_count, 42, "file_count round-trip");
    assert_eq!(row.content_signature.as_deref(), Some("abc123"), "content_signature round-trip");
    assert_eq!(
        row.state, "pending_classification",
        "initial state should be pending_classification"
    );
    assert_eq!(row.lane, "fits", "lane round-trip");
}
