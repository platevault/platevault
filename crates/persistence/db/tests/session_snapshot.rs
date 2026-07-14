// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T047 — integration tests for the immutable session snapshot writer.

use audit::bus::EventBus;
use persistence_db::repositories::session_snapshot::{
    latest_snapshot, should_snapshot, write_session_snapshot, SessionKind,
};
use persistence_db::Database;
use serde_json::json;
use uuid::Uuid;

async fn setup() -> Database {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    let _bus = EventBus::with_pool(db.pool().clone());
    db
}

async fn seed_audit_row(pool: &sqlx::SqlitePool, audit_id: &str, entity_id: &str) {
    sqlx::query(
        "INSERT INTO audit_log_entry \
         (audit_id, entity_type, entity_id, from_state, to_state, trigger, actor, \
          outcome, severity, request_id, at, payload) \
         VALUES (?, 'acquisition_session', ?, 'candidate', 'confirmed', 'review', 'user', \
                 'applied', 'workflow', ?, '2026-05-15T10:00:00Z', NULL)",
    )
    .bind(audit_id)
    .bind(entity_id)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn writes_and_reads_back_a_snapshot() {
    let db = setup().await;
    let session_id = Uuid::new_v4().to_string();
    let audit_id = Uuid::new_v4().to_string();
    seed_audit_row(db.pool(), &audit_id, &session_id).await;

    let context = json!({
        "target_id": "M31",
        "filter": "Lum",
        "frame_count": 12
    });
    let snap_id = write_session_snapshot(
        db.pool(),
        &session_id,
        SessionKind::Acquisition,
        "candidate",
        "confirmed",
        "2026-05-15T10:00:00Z",
        &audit_id,
        &context,
    )
    .await
    .expect("write snapshot");

    let row =
        latest_snapshot(db.pool(), &session_id).await.expect("query").expect("at least one row");
    assert_eq!(row.id, snap_id);
    assert_eq!(row.session_kind, "acquisition");
    assert_eq!(row.transition_from, "candidate");
    assert_eq!(row.transition_to, "confirmed");
    assert_eq!(row.audit_id, audit_id);
    assert!(row.context_json.contains("\"target_id\":\"M31\""));
}

#[tokio::test]
async fn latest_returns_newest() {
    let db = setup().await;
    let session_id = Uuid::new_v4().to_string();
    let a1 = Uuid::new_v4().to_string();
    let a2 = Uuid::new_v4().to_string();
    seed_audit_row(db.pool(), &a1, &session_id).await;
    seed_audit_row(db.pool(), &a2, &session_id).await;

    write_session_snapshot(
        db.pool(),
        &session_id,
        SessionKind::Acquisition,
        "candidate",
        "needs_review",
        "2026-05-15T10:00:00Z",
        &a1,
        &json!({"step": 1}),
    )
    .await
    .unwrap();
    write_session_snapshot(
        db.pool(),
        &session_id,
        SessionKind::Acquisition,
        "needs_review",
        "confirmed",
        "2026-05-15T11:00:00Z",
        &a2,
        &json!({"step": 2}),
    )
    .await
    .unwrap();

    let row = latest_snapshot(db.pool(), &session_id).await.unwrap().unwrap();
    assert_eq!(row.transition_to, "confirmed");
}

#[test]
fn should_snapshot_table_matches_fr_005() {
    assert!(should_snapshot("confirmed"));
    assert!(should_snapshot("rejected"));
    assert!(should_snapshot("needs_review"));
    assert!(!should_snapshot("candidate"));
}
