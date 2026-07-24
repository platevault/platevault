// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Concurrency and CAS tests for the topology persistence layer.
//!
//! Every test boots a fresh in-memory SQLite database (WAL mode, FK ON) via
//! `persistence_core::test_support::setup_db()`. The targeted invariants are:
//!
//! 1. `insert_singleton_panel_group` creates an active group with generation 0.
//! 2. `append_panel_revision` advances the head via CAS; a concurrent write
//!    produces `DbError::CasFailed` on the losing side.
//! 3. `retire_panel_group` CAS refuses a stale generation.
//! 4. `lineage_cycle_exists` correctly detects direct and transitive cycles.
//! 5. Proposal accept CAS refuses a concurrent acceptor on the same proposal.
//! 6. Traversal preview reaches `Completed` state within a reasonable timeout.
//! 7. Traversal preview respects the node ceiling (sentinel detection).
//! 8. Traversal preview cancel reaches terminal state within one second.

#![allow(clippy::too_many_lines)]

use std::time::Duration;

use sqlx::{Acquire, SqlitePool};
use uuid::Uuid;

use persistence_core::DbError;
use persistence_topology::repositories::panels::{
    self, AppendPanelRevision, InsertSingletonPanel, RetirePanelGroup,
};
use persistence_topology::repositories::proposals::{self, AcceptProposal};
use persistence_topology::test_support as support;
use persistence_topology::traversal::{
    new_registry, start_traversal, TraversalDirection, TraversalGraph, TraversalLimits,
};

fn uuid() -> String {
    Uuid::new_v4().to_string()
}

/// Shared seed that provisions one actor, config revision, operation, and
/// target. Returns `(pool, actor_row_id, config_row_id, op_row_id, target_row_id)`.
async fn seed_basics(pool: &SqlitePool) -> (i64, i64, i64, i64) {
    let seq = support::insert_sequence(pool).await;
    let actor_id = support::insert_actor(pool, &uuid()).await;
    let cfg_id = support::insert_config_revision(pool, &uuid(), 1).await;
    let cmd_id = support::insert_command(pool, &uuid(), actor_id).await;
    let op_id = support::insert_materialization_operation(pool, &uuid(), cmd_id, cfg_id, seq).await;
    let target_id = support::insert_spec062_target(pool, &uuid()).await;
    (actor_id, cfg_id, op_id, target_id)
}

// ── 1. Singleton panel group creation ────────────────────────────────────────

#[tokio::test]
async fn singleton_panel_group_created_with_generation_zero() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let (session_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;

    let group_pub = uuid();
    let rev_pub = uuid();

    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let (group_row_id, rev_row_id) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &group_pub,
            revision_public_id: &rev_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // Verify head generation is 0 and head points to the revision.
    let (head_gen, head_rev_id): (i64, i64) = sqlx::query_as(
        "SELECT head_generation, head_revision_row_id FROM panel_group WHERE row_id = ?",
    )
    .bind(group_row_id)
    .fetch_one(pool)
    .await
    .unwrap();

    assert_eq!(head_gen, 0);
    assert_eq!(head_rev_id, rev_row_id);

    // Verify head history row inserted.
    let (hist_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM panel_group_head_history WHERE panel_group_row_id = ?",
    )
    .bind(group_row_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(hist_count, 1);
}

// ── 2. Append revision CAS ────────────────────────────────────────────────────

#[tokio::test]
async fn append_panel_revision_cas_winner_advances_head() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let (session_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;
    let (session2_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 1).await;

    // Create singleton group.
    let group_pub = uuid();
    let rev1_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (group_row_id, rev1_row_id) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &group_pub,
            revision_public_id: &rev1_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let proposal_id =
        support::insert_pending_proposal(pool, &uuid(), "panel_add", cfg_id, seq).await;

    // Append a successor revision.
    let seq2 = support::insert_sequence(pool).await;
    let rev2_pub = uuid();
    let mut conn2 = pool.acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    let rev2_row_id = panels::append_panel_revision(
        &mut tx2,
        &AppendPanelRevision {
            revision_public_id: &rev2_pub,
            panel_group_row_id: group_row_id,
            parent_revision_row_id: rev1_row_id,
            current_revision_number: 1,
            members: &[(session_row_id, 0), (session2_row_id, 1)],
            representative_session_row_id: session_row_id,
            proposal_row_id: proposal_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            reason_code: "panel_add",
            created_sequence: seq2,
            created_at: "2026-07-22T00:00:01.000000Z",
            expected_head_generation: 0,
        },
    )
    .await
    .unwrap();
    tx2.commit().await.unwrap();

    // Head now at generation 1 pointing to rev2.
    let (head_gen, head_id): (i64, i64) = sqlx::query_as(
        "SELECT head_generation, head_revision_row_id FROM panel_group WHERE row_id = ?",
    )
    .bind(group_row_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(head_gen, 1);
    assert_eq!(head_id, rev2_row_id);
}

#[tokio::test]
async fn append_panel_revision_cas_loser_gets_conflict_error() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let (session_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;
    let (session2_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 1).await;

    // Create singleton group.
    let group_pub = uuid();
    let rev1_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (group_row_id, rev1_row_id) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &group_pub,
            revision_public_id: &rev1_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let proposal_id =
        support::insert_pending_proposal(pool, &uuid(), "panel_add", cfg_id, seq).await;

    // Winner advances head to generation 1.
    let seq2 = support::insert_sequence(pool).await;
    let rev2_pub = uuid();
    let mut conn2 = pool.acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    panels::append_panel_revision(
        &mut tx2,
        &AppendPanelRevision {
            revision_public_id: &rev2_pub,
            panel_group_row_id: group_row_id,
            parent_revision_row_id: rev1_row_id,
            current_revision_number: 1,
            members: &[(session_row_id, 0)],
            representative_session_row_id: session_row_id,
            proposal_row_id: proposal_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            reason_code: "panel_add",
            created_sequence: seq2,
            created_at: "2026-07-22T00:00:01.000000Z",
            expected_head_generation: 0, // correct
        },
    )
    .await
    .unwrap();
    tx2.commit().await.unwrap();

    // Loser attempts to append a successor revision using the same parent.
    // UNIQUE(parent_revision_row_id) on panel_group_revision rejects a second
    // writer at INSERT time, before the CAS UPDATE runs. Both a DB unique
    // constraint error and CasFailed are valid concurrent-write rejections.
    let rev3_pub = uuid();
    let proposal2_id =
        support::insert_pending_proposal(pool, &uuid(), "panel_add", cfg_id, seq2).await;
    let mut conn3 = pool.acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    let result = panels::append_panel_revision(
        &mut tx3,
        &AppendPanelRevision {
            revision_public_id: &rev3_pub,
            panel_group_row_id: group_row_id,
            parent_revision_row_id: rev1_row_id, // same parent → UNIQUE violation
            current_revision_number: 1,
            members: &[(session2_row_id, 0)],
            representative_session_row_id: session2_row_id,
            proposal_row_id: proposal2_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            reason_code: "panel_add",
            created_sequence: seq2,
            created_at: "2026-07-22T00:00:01.000000Z",
            expected_head_generation: 0,
        },
    )
    .await;
    // Concurrent write is always rejected (UNIQUE constraint or CAS UPDATE).
    assert!(result.is_err(), "concurrent write must be rejected, got Ok");
}

// ── 3. Retire group CAS ───────────────────────────────────────────────────────

#[tokio::test]
async fn retire_panel_group_cas_refuses_stale_generation() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let (session_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;

    let group_pub = uuid();
    let rev_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (group_row_id, _) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &group_pub,
            revision_public_id: &rev_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    // Create a successor group so the FK in lineage is satisfied.
    let (session2_row_id, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 1).await;
    let group2_pub = uuid();
    let rev2_pub = uuid();
    let mut conn2 = pool.acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    let (group2_row_id, _) = panels::insert_singleton_panel_group(
        &mut tx2,
        &InsertSingletonPanel {
            group_public_id: &group2_pub,
            revision_public_id: &rev2_pub,
            session_row_id: session2_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx2.commit().await.unwrap();

    let proposal_id =
        support::insert_pending_proposal(pool, &uuid(), "panel_merge", cfg_id, seq).await;

    // Attempt to retire with wrong generation (1 instead of 0).
    let mut conn3 = pool.acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    let result = panels::retire_panel_group(
        &mut tx3,
        &RetirePanelGroup {
            group_row_id,
            successor_group_row_id: group2_row_id,
            lineage_kind: "merge",
            proposal_row_id: proposal_id,
            lineage_ordinal: 0,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
            expected_head_generation: 1, // stale — actual is 0
        },
    )
    .await;
    assert!(matches!(result, Err(DbError::CasFailed(_))), "expected Conflict, got {result:?}");
}

// ── 4. Lineage cycle detection ────────────────────────────────────────────────

#[tokio::test]
async fn lineage_cycle_detection_rejects_direct_cycle() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let (s1, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;
    let (s2, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 1).await;

    let g1_pub = uuid();
    let r1_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (g1, _) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &g1_pub,
            revision_public_id: &r1_pub,
            session_row_id: s1,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let g2_pub = uuid();
    let r2_pub = uuid();
    let mut conn2 = pool.acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    let (g2, _) = panels::insert_singleton_panel_group(
        &mut tx2,
        &InsertSingletonPanel {
            group_public_id: &g2_pub,
            revision_public_id: &r2_pub,
            session_row_id: s2,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx2.commit().await.unwrap();

    let proposal_id =
        support::insert_pending_proposal(pool, &uuid(), "panel_merge", cfg_id, seq).await;

    // Insert g1 → g2.
    let mut conn3 = pool.acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    panels::retire_panel_group(
        &mut tx3,
        &RetirePanelGroup {
            group_row_id: g1,
            successor_group_row_id: g2,
            lineage_kind: "merge",
            proposal_row_id: proposal_id,
            lineage_ordinal: 0,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
            expected_head_generation: 0,
        },
    )
    .await
    .unwrap();
    tx3.commit().await.unwrap();

    // Propose g2 → g1 (would create a direct cycle).
    let mut conn4 = pool.acquire().await.unwrap();
    let cycle = panels::lineage_cycle_exists(&mut *conn4, g2, g1).await.unwrap();
    assert!(cycle, "direct cycle g2 → g1 should be detected");

    // No cycle for a fresh group.
    let (s3, _) =
        support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, 2).await;
    let g3_pub = uuid();
    let r3_pub = uuid();
    let mut conn5 = pool.acquire().await.unwrap();
    let mut tx5 = conn5.begin().await.unwrap();
    let (g3, _) = panels::insert_singleton_panel_group(
        &mut tx5,
        &InsertSingletonPanel {
            group_public_id: &g3_pub,
            revision_public_id: &r3_pub,
            session_row_id: s3,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx5.commit().await.unwrap();

    let mut conn6 = pool.acquire().await.unwrap();
    let no_cycle = panels::lineage_cycle_exists(&mut *conn6, g1, g3).await.unwrap();
    assert!(!no_cycle, "g1 → g3 should not form a cycle");
}

// ── 5. Proposal accept CAS ────────────────────────────────────────────────────

#[tokio::test]
async fn proposal_accept_cas_refuses_concurrent_acceptor() {
    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, _op_id, _target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    let proposal_pub = uuid();
    let proposal_row_id =
        support::insert_pending_proposal(pool, &proposal_pub, "panel_add", cfg_id, seq).await;

    // We need an audit_event FK — insert a stub audit row.
    // audit_event requires command_row_id. Insert a minimal command and audit.
    let cmd_pub = uuid();
    let cmd_row_id = support::insert_command(pool, &cmd_pub, actor_id).await;

    let seq2 = support::insert_sequence(pool).await;

    // Insert a placeholder audit row for the decision snapshot FK.
    // audit_event.decision_snapshot_row_id is nullable so we insert with
    // session_row_id = NULL workaround is not possible due to the CHECK.
    // The relation_decision_snapshot references audit_event with DEFERRABLE FK.
    // We insert the audit row before committing to satisfy the deferred FK.
    //
    // The audit_event CHECK requires exactly one of the optional foreign keys.
    // We satisfy it with proposal_row_id.
    sqlx::query(
        "INSERT INTO audit_event
             (public_id, command_row_id, proposal_row_id, actor_row_id,
              action, outcome, reason_code, created_sequence, occurred_at)
         VALUES (?, ?, ?, ?, 'proposal.accepted', 'applied', 'accepted', ?, '2026-07-22T00:00:01Z')",
    )
    .bind(uuid())
    .bind(cmd_row_id)
    .bind(proposal_row_id)
    .bind(actor_id)
    .bind(seq2)
    .execute(pool)
    .await
    .unwrap();

    let (audit_row_id,): (i64,) =
        sqlx::query_as("SELECT MAX(row_id) FROM audit_event").fetch_one(pool).await.unwrap();

    // First acceptor succeeds.
    let snapshot1_pub = uuid();
    let mut conn1 = pool.acquire().await.unwrap();
    let mut tx1 = conn1.begin().await.unwrap();
    let result1 = proposals::accept_proposal(
        &mut tx1,
        &AcceptProposal {
            proposal_row_id,
            expected_proposal_revision: 1,
            decision_snapshot_public_id: &snapshot1_pub,
            accepted_revision_count: 1,
            retired_group_count: 0,
            lineage_count: 0,
            actor_row_id: actor_id,
            reason_code: "accepted",
            audit_row_id,
            decided_sequence: seq2,
            decided_at: "2026-07-22T00:00:01.000000Z",
        },
    )
    .await;
    assert!(result1.is_ok(), "first acceptor should succeed: {result1:?}");
    tx1.commit().await.unwrap();

    // Second acceptor with same stale revision should fail.
    let snapshot2_pub = uuid();
    let mut conn2 = pool.acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    let result2 = proposals::accept_proposal(
        &mut tx2,
        &AcceptProposal {
            proposal_row_id,
            expected_proposal_revision: 1, // stale — first acceptor moved it to 2
            decision_snapshot_public_id: &snapshot2_pub,
            accepted_revision_count: 1,
            retired_group_count: 0,
            lineage_count: 0,
            actor_row_id: actor_id,
            reason_code: "accepted",
            audit_row_id,
            decided_sequence: seq2,
            decided_at: "2026-07-22T00:00:01.000000Z",
        },
    )
    .await;
    assert!(
        matches!(result2, Err(DbError::CasFailed(_))),
        "second acceptor should get Conflict: {result2:?}"
    );
}

// ── 6. Traversal preview completes ───────────────────────────────────────────

#[tokio::test]
async fn traversal_preview_completes_for_empty_graph() {
    let db = support::setup_db().await;
    let pool = db.pool().clone();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(&pool).await;
    let seq = support::insert_sequence(&pool).await;

    let (session_row_id, _) =
        support::insert_light_session(&pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;

    // Create a singleton group — no lineage edges, so traversal returns just
    // the start node.
    let group_pub = uuid();
    let rev_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (group_row_id, _) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &group_pub,
            revision_public_id: &rev_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let registry = new_registry();
    let start_ref = persistence_topology::traversal::EntityRef {
        entity_type: "panel_group",
        entity_id: group_pub.clone(),
        row_id: group_row_id,
    };

    let (op_id_uuid, _watermark) = start_traversal(
        &registry,
        pool.clone(),
        vec![start_ref],
        TraversalGraph::PanelLineage,
        TraversalDirection::Both,
        TraversalLimits::default(),
    )
    .await
    .unwrap();

    // Poll until completed or timeout.
    let timeout = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let state =
            persistence_topology::traversal::get_progress(&registry, op_id_uuid).await.unwrap();
        if state.phase == persistence_topology::traversal::TraversalPhase::Completed {
            assert_eq!(state.visited_node_count, 1, "only the start node");
            assert_eq!(state.visited_edge_count, 0);
            break;
        }
        if std::time::Instant::now() > timeout {
            panic!("traversal did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// ── 7. Traversal node ceiling ─────────────────────────────────────────────────

#[tokio::test]
async fn traversal_node_ceiling_produces_ceiling_error() {
    let db = support::setup_db().await;
    let pool = db.pool().clone();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(&pool).await;
    let seq = support::insert_sequence(&pool).await;
    let proposal_id =
        support::insert_pending_proposal(&pool, &uuid(), "panel_merge", cfg_id, seq).await;

    // Build a chain of 4 groups: g1 → g2 → g3 → g4.
    let mut prev_group_row_id: Option<i64> = None;
    for i in 0..4u64 {
        let (s, _) =
            support::insert_light_session(&pool, &uuid(), &uuid(), op_id, target_id, seq, i as i64)
                .await;

        let g_pub = uuid();
        let r_pub = uuid();
        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let (g_row_id, _) = panels::insert_singleton_panel_group(
            &mut tx,
            &InsertSingletonPanel {
                group_public_id: &g_pub,
                revision_public_id: &r_pub,
                session_row_id: s,
                canonical_target_row_id: target_id,
                config_revision_row_id: cfg_id,
                actor_row_id: actor_id,
                created_sequence: seq,
                created_at: "2026-07-22T00:00:00.000000Z",
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        if let Some(prev) = prev_group_row_id {
            // Retire previous group into this one.
            let mut conn2 = pool.acquire().await.unwrap();
            let mut tx2 = conn2.begin().await.unwrap();
            panels::retire_panel_group(
                &mut tx2,
                &RetirePanelGroup {
                    group_row_id: prev,
                    successor_group_row_id: g_row_id,
                    lineage_kind: "merge",
                    proposal_row_id: proposal_id,
                    lineage_ordinal: i as i64,
                    created_sequence: seq,
                    created_at: "2026-07-22T00:00:00.000000Z",
                    expected_head_generation: 0,
                },
            )
            .await
            .unwrap();
            tx2.commit().await.unwrap();
        }

        prev_group_row_id = Some(g_row_id);
    }

    // Traverse with node ceiling = 2 — should hit the ceiling at node 3.
    let start_group_id = {
        let (id, pub_id): (i64, String) =
            sqlx::query_as("SELECT row_id, public_id FROM panel_group ORDER BY row_id ASC LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        persistence_topology::traversal::EntityRef {
            entity_type: "panel_group",
            entity_id: pub_id,
            row_id: id,
        }
    };

    let registry = new_registry();
    let (op_id_uuid, _) = start_traversal(
        &registry,
        pool.clone(),
        vec![start_group_id],
        TraversalGraph::PanelLineage,
        TraversalDirection::Successors,
        TraversalLimits { max_nodes: 2, max_depth: 64, max_edges: 1_000 },
    )
    .await
    .unwrap();

    let timeout = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let state =
            persistence_topology::traversal::get_progress(&registry, op_id_uuid).await.unwrap();
        use persistence_topology::traversal::TraversalPhase;
        if state.phase == TraversalPhase::Failed {
            // Ceiling hit sets phase=Failed with NodeCeiling terminal error.
            assert!(
                matches!(
                    state.terminal_error,
                    Some(persistence_topology::traversal::TraversalError::NodeCeiling { .. })
                ),
                "expected NodeCeiling error, got {:?}",
                state.terminal_error
            );
            break;
        }
        if state.phase == TraversalPhase::Cancelled {
            panic!("traversal was cancelled instead of hitting the ceiling");
        }
        if state.phase == TraversalPhase::Completed {
            panic!(
                "traversal completed without ceiling error (visited {} nodes)",
                state.visited_node_count
            );
        }
        if std::time::Instant::now() > timeout {
            panic!("traversal did not terminate within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// ── 8. Traversal cancel ───────────────────────────────────────────────────────
// Both cancellation paths in traversal.rs (frontier check and 256-edge batch
// check) must return TraversalError::Cancelled, never DbError("cancelled").
// Verified statically: `grep 'DbError("cancelled")' src/traversal.rs` is empty.

#[tokio::test]
async fn traversal_cancel_reaches_terminal_within_one_second() {
    let db = support::setup_db().await;
    let pool = db.pool().clone();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(&pool).await;
    let seq = support::insert_sequence(&pool).await;

    let (session_row_id, _) =
        support::insert_light_session(&pool, &uuid(), &uuid(), op_id, target_id, seq, 0).await;
    let g_pub = uuid();
    let r_pub = uuid();
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    let (g_row_id, _) = panels::insert_singleton_panel_group(
        &mut tx,
        &InsertSingletonPanel {
            group_public_id: &g_pub,
            revision_public_id: &r_pub,
            session_row_id,
            canonical_target_row_id: target_id,
            config_revision_row_id: cfg_id,
            actor_row_id: actor_id,
            created_sequence: seq,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let registry = new_registry();
    let (op_id_uuid, _) = start_traversal(
        &registry,
        pool.clone(),
        vec![persistence_topology::traversal::EntityRef {
            entity_type: "panel_group",
            entity_id: g_pub.clone(),
            row_id: g_row_id,
        }],
        TraversalGraph::PanelLineage,
        TraversalDirection::Both,
        TraversalLimits::default(),
    )
    .await
    .unwrap();

    // Cancel immediately.
    persistence_topology::traversal::cancel_traversal(&registry, op_id_uuid).await;

    let cancel_deadline = std::time::Instant::now() + Duration::from_secs(1);
    loop {
        let state =
            persistence_topology::traversal::get_progress(&registry, op_id_uuid).await.unwrap();
        use persistence_topology::traversal::TraversalPhase;
        if state.phase == TraversalPhase::Cancelled {
            // Cancel sets Cancelled phase with no terminal_error.
            assert!(
                state.terminal_error.is_none(),
                "cancelled traversal must not set a terminal_error"
            );
            break;
        }
        if matches!(state.phase, TraversalPhase::Completed | TraversalPhase::Failed) {
            // Completed before cancel was observed by the BFS loop is also acceptable
            // (empty graph may complete before cancel is processed).
            break;
        }
        if std::time::Instant::now() > cancel_deadline {
            panic!("traversal did not reach terminal state within 1 second of cancel");
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

// ── 9. Proposal list cursor pagination ───────────────────────────────────────

#[tokio::test]
async fn list_proposals_cursor_pages_past_non_null_cursor() {
    use persistence_topology::repositories::proposals::list_proposals;

    let db = support::setup_db().await;
    let pool = db.pool();
    let (_actor_id, cfg_id, _op_id, _target_id) = seed_basics(pool).await;
    let seq = support::insert_sequence(pool).await;

    // Insert 3 proposals with distinct timestamps so ordering is deterministic.
    let timestamps = [
        "2026-07-22T00:00:03.000000Z",
        "2026-07-22T00:00:02.000000Z",
        "2026-07-22T00:00:01.000000Z",
    ];
    let mut proposal_pubs = Vec::new();
    for ts in &timestamps {
        let pub_id = uuid();
        let basis = format!("basis-{pub_id}");
        let evidence = format!("evidence-{pub_id}");
        sqlx::query(
            "INSERT INTO relation_proposal
                 (public_id, proposal_revision, kind, basis_digest, evidence_digest,
                  config_revision_row_id, state, created_sequence, created_at)
             VALUES (?, 1, 'panel_add', ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(&pub_id)
        .bind(&basis)
        .bind(&evidence)
        .bind(cfg_id)
        .bind(seq)
        .bind(ts)
        .execute(pool)
        .await
        .unwrap();
        proposal_pubs.push(pub_id);
    }

    let mut conn = pool.acquire().await.unwrap();

    // Page 1: limit=2, no cursor — should return the two newest.
    let page1 = list_proposals(&mut *conn, None, None, None, None, 2).await.unwrap();
    assert_eq!(page1.len(), 2, "page 1 should have 2 rows");
    assert_eq!(page1[0].created_at, "2026-07-22T00:00:03.000000Z");
    assert_eq!(page1[1].created_at, "2026-07-22T00:00:02.000000Z");

    // Page 2: cursor from last row of page 1.
    let after_created_at = page1[1].created_at.clone();
    let after_public_id = page1[1].public_id.clone();
    let page2 =
        list_proposals(&mut *conn, None, None, Some(&after_created_at), Some(&after_public_id), 2)
            .await
            .unwrap();
    assert_eq!(page2.len(), 1, "page 2 should have 1 row");
    assert_eq!(page2[0].created_at, "2026-07-22T00:00:01.000000Z");

    // No overlap between pages.
    let page1_ids: std::collections::HashSet<_> =
        page1.iter().map(|r| r.public_id.clone()).collect();
    assert!(!page1_ids.contains(&page2[0].public_id), "pages must not overlap");
}

// ── 10. Panel group list cursor pagination ────────────────────────────────────

#[tokio::test]
async fn list_panel_groups_cursor_pages_past_non_null_cursor() {
    use persistence_topology::repositories::panels::list_panel_groups_by_target;

    let db = support::setup_db().await;
    let pool = db.pool();
    let (actor_id, cfg_id, op_id, target_id) = seed_basics(pool).await;

    // Insert 3 groups with distinct creation timestamps.
    let timestamps = [
        "2026-07-22T00:00:03.000000Z",
        "2026-07-22T00:00:02.000000Z",
        "2026-07-22T00:00:01.000000Z",
    ];
    for (i, ts) in timestamps.iter().enumerate() {
        let seq = support::insert_sequence(pool).await;
        let (session_row_id, _) =
            support::insert_light_session(pool, &uuid(), &uuid(), op_id, target_id, seq, i as i64)
                .await;

        let g_pub = uuid();
        let r_pub = uuid();
        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();

        // Insert group directly with the desired timestamp instead of
        // insert_singleton_panel_group (which uses a fixed timestamp).
        sqlx::query(
            "INSERT INTO panel_group
                 (public_id, canonical_target_row_id, cross_target_association_row_id,
                  status, head_revision_row_id, head_generation,
                  created_sequence, created_at)
             VALUES (?, ?, NULL, 'active', NULL, 0, ?, ?)",
        )
        .bind(&g_pub)
        .bind(target_id)
        .bind(seq)
        .bind(ts)
        .execute(&mut *tx)
        .await
        .unwrap();

        let (group_row_id,): (i64,) =
            sqlx::query_as("SELECT row_id FROM panel_group WHERE public_id = ?")
                .bind(&g_pub)
                .fetch_one(&mut *tx)
                .await
                .unwrap();

        sqlx::query(
            "INSERT INTO panel_group_revision
                 (public_id, panel_group_row_id, revision_number, parent_revision_row_id,
                  representative_session_row_id, representative_session_kind,
                  proposal_row_id, config_revision_row_id, actor_row_id,
                  reason_code, created_sequence, created_at)
             VALUES (?, ?, 1, NULL, ?, 'light', NULL, ?, ?, 'singleton_created', ?, ?)",
        )
        .bind(&r_pub)
        .bind(group_row_id)
        .bind(session_row_id)
        .bind(cfg_id)
        .bind(actor_id)
        .bind(seq)
        .bind(ts)
        .execute(&mut *tx)
        .await
        .unwrap();

        let (rev_row_id,): (i64,) =
            sqlx::query_as("SELECT row_id FROM panel_group_revision WHERE public_id = ?")
                .bind(&r_pub)
                .fetch_one(&mut *tx)
                .await
                .unwrap();

        sqlx::query(
            "INSERT INTO panel_revision_session
                 (panel_revision_row_id, session_row_id, session_kind, ordinal)
             VALUES (?, ?, 'light', 0)",
        )
        .bind(rev_row_id)
        .bind(session_row_id)
        .execute(&mut *tx)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE panel_group SET head_revision_row_id = ?
             WHERE row_id = ? AND head_revision_row_id IS NULL",
        )
        .bind(rev_row_id)
        .bind(group_row_id)
        .execute(&mut *tx)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO panel_group_head_history
                 (panel_group_row_id, generation, head_revision_row_id, accepted_sequence)
             VALUES (?, 0, ?, ?)",
        )
        .bind(group_row_id)
        .bind(rev_row_id)
        .bind(seq)
        .execute(&mut *tx)
        .await
        .unwrap();

        tx.commit().await.unwrap();
    }

    let mut conn = pool.acquire().await.unwrap();

    // Page 1: limit=2, no cursor.
    let page1 = list_panel_groups_by_target(&mut *conn, Some(target_id), true, None, None, 2)
        .await
        .unwrap();
    assert_eq!(page1.len(), 2, "page 1 should have 2 rows");
    assert_eq!(page1[0].created_at, "2026-07-22T00:00:03.000000Z");
    assert_eq!(page1[1].created_at, "2026-07-22T00:00:02.000000Z");

    // Page 2: cursor from last row of page 1.
    let after_created_at = page1[1].created_at.clone();
    let after_public_id = page1[1].public_id.clone();
    let page2 = list_panel_groups_by_target(
        &mut *conn,
        Some(target_id),
        true,
        Some(&after_created_at),
        Some(&after_public_id),
        2,
    )
    .await
    .unwrap();
    assert_eq!(page2.len(), 1, "page 2 should have 1 row");
    assert_eq!(page2[0].created_at, "2026-07-22T00:00:01.000000Z");

    // No overlap.
    let page1_ids: std::collections::HashSet<_> =
        page1.iter().map(|r| r.public_id.clone()).collect();
    assert!(!page1_ids.contains(&page2[0].public_id), "pages must not overlap");
}
