#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! US1 coverage smoke tests — feature 037 (T006/T007).
//!
//! Validates that the real `SQLite` backend is wired correctly for:
//! (a) `project_setup::list` round-trips through raw SQL inserts.
//! (b) A successful lifecycle transition writes an `outcome = 'applied'` row
//!     in `audit_log_entry` (success-path audit durability).

mod support;

use app_core::transition_use_case::apply_transition;
use contracts_core::lifecycle::{
    ProjectState, ProjectTransitionRequest, TransitionActor, TransitionRequest, TransitionStatus,
};
use uuid::Uuid;

// ── (a) project_setup::list round-trip ───────────────────────────────────────

#[tokio::test]
async fn projects_list_reads_back_real_rows() {
    let (db, _repo, _bus) = support::setup().await;

    // Fresh DB should return an empty list.
    let rows =
        app_core::project_setup::list(db.pool()).await.expect("list should succeed on empty DB");
    assert!(rows.is_empty(), "expected empty list on a fresh DB, got {rows:?}");

    // The `projects` table (spec 008) is queried by project_setup::list, but
    // the `project` table (spec 002 lifecycle) is what apply_transition uses.
    // For this read-back test we insert a minimal row into `projects` directly.
    let project_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, 'Smoke Test', 'PixInsight', 'setup_incomplete', '/tmp/p', \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&project_id)
    .execute(db.pool())
    .await
    .expect("insert into projects failed");

    // After the insert, list should return exactly one summary.
    let rows =
        app_core::project_setup::list(db.pool()).await.expect("list should succeed with one row");
    assert_eq!(rows.len(), 1, "expected exactly one project summary, got {rows:?}");
}

// ── (b) success-path audit durability ────────────────────────────────────────

#[tokio::test]
async fn success_transition_writes_applied_audit_row() {
    let (db, repo, bus) = support::setup().await;

    // Seed a target + project in `ready` state via the support helper.
    // The edge ready → processing is allowed, requires no plan, and has no
    // action-review gate — confirmed by action_review_requirement tests.
    let target_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    let project_uuid = Uuid::parse_str(&project_id).expect("valid uuid");
    support::insert_target(db.pool(), &target_id).await;
    support::insert_project(db.pool(), &project_id, &target_id, "ready").await;

    // Build the contract-shaped request for ready → processing.
    let request = TransitionRequest::Project(ProjectTransitionRequest::new(
        Uuid::new_v4(),
        project_uuid,
        ProjectState::Ready,
        ProjectState::Processing,
        TransitionActor::User,
    ));

    let resp = apply_transition(&repo, &bus, request).await;

    assert_eq!(
        resp.status,
        TransitionStatus::Success,
        "expected Success, got {:?} — error: {:?}",
        resp.status,
        resp.error,
    );

    // Assert the audit row was written with outcome = 'applied'.
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_log_entry \
         WHERE entity_id = ? AND outcome = 'applied'",
    )
    .bind(&project_id)
    .fetch_one(db.pool())
    .await
    .expect("audit_log_entry query failed");

    assert_eq!(
        count, 1,
        "expected 1 audit row with outcome='applied' for project {project_id}, found {count}"
    );
}
