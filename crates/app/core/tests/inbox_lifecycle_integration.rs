#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
//! T4. inbox_item_persists_and_is_readable
//!     Insert an inbox_items row directly (mimicking the scan pipeline) and
//!     assert the row survives a round-trip read through the persistence
//!     repository.
//!
//! Spec 041 FR-051 (T076, Phase 13): the former T2
//! (`inventory_list_filters_by_state_excludes_ignored`) and T3
//! (`inventory_review_session_transitions_state`) scenarios were removed
//! along with the session review-state machine (`ignored` state,
//! `review_filter`, `inventory::review_session`). Sessions are now derived,
//! already-confirmed inventory.

mod support;

use app_core::inventory;
use contracts_core::inventory::InventorySourceState;
use persistence_inbox::repositories::inbox::{get_inbox_item, insert_inbox_item, InsertInboxItem};
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
    target_id: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO acquisition_session \
         (id, session_key, root_id, frame_ids, target_id, created_at) \
         VALUES (?, '{}', ?, '[]', ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(root_id)
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
    insert_acquisition_session(db.pool(), &session_id, &root_id, None).await;

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
