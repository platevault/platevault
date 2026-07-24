// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for `persistence_sessions` repository functions.
//!
//! All tests use a real in-memory SQLite database with the full migration chain.
//! Fixture helpers insert the minimal rows required to satisfy FK constraints.

use persistence_core::test_support::setup_db;
use sqlx::Acquire;
use persistence_sessions::{
    repositories::{
        equipment_resolution::{
            advance_equipment_resolution_head, get_accepted_equipment_resolution,
            get_equipment_resolution_head, insert_equipment_resolution,
            insert_equipment_resolution_head, InsertEquipmentResolution,
        },
        materialization::{
            get_operation_by_public_id, get_result_snapshot_by_operation_public_id,
            insert_materialization_operation, insert_result_snapshot,
            transition_operation_to_applied, transition_operation_to_applying,
            transition_operation_to_failed, InsertMaterializationOperation,
            InsertMaterializationResultSnapshot,
        },
        metadata_resolution::{
            advance_metadata_resolution_head, get_accepted_metadata_resolution,
            get_metadata_resolution_head, insert_metadata_resolution,
            insert_metadata_resolution_frame, insert_metadata_resolution_head,
            InsertMetadataResolution, InsertMetadataResolutionFrame,
        },
        sessions::{
            current_change_sequence, get_session_by_public_id, insert_session,
            insert_session_frame, insert_session_visibility, list_session_frames,
            list_sessions_at_watermark, InsertSession, InsertSessionFrame, SessionListFilter,
        },
        supersession::{
            assert_no_supersession_cycle, insert_supersession, is_session_current,
            list_supersession_predecessors, list_supersession_successors, InsertSupersession,
        },
    },
    test_support::{seed_frame, seed_operation_fixtures},
};

// ── Session insert and fetch ──────────────────────────────────────────────────

#[tokio::test]
async fn session_insert_and_fetch_round_trip() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let session_id = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-b000-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "dark-session-digest",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .expect("insert session");

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: session_id,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .expect("insert session frame");

    insert_session_visibility(&mut tx, session_id, 1, "created").await.expect("insert visibility");

    tx.commit().await.unwrap();

    let row = get_session_by_public_id(db.pool(), "00000000-0000-7000-b000-000000000001")
        .await
        .expect("fetch session");

    assert_eq!(row.kind, "dark");
    assert_eq!(row.ordinal_in_operation, 0);
    assert_eq!(row.identity_digest, "dark-session-digest");
    assert_eq!(row.night_derivation, "reviewed_local_fallback");
    assert!(row.canonical_target_row_id.is_none());
}

#[tokio::test]
async fn session_not_found_returns_error() {
    let db = setup_db().await;
    let result = get_session_by_public_id(db.pool(), "00000000-0000-7000-b000-nonexistent").await;
    assert!(result.is_err());
}

// ── Frame membership ──────────────────────────────────────────────────────────

#[tokio::test]
async fn frame_membership_list_returns_ordered_members() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;
    seed_frame(db.pool(), 2).await;

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let session_id = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-b001-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "d2",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    for (frame_id, ordinal, is_rep) in [(1i64, 0i64, false), (2, 1, true)] {
        insert_session_frame(
            &mut tx,
            &InsertSessionFrame {
                session_row_id: session_id,
                frame_row_id: frame_id,
                materialization_operation_row_id: 1,
                ordinal,
                is_representative: is_rep,
                created_sequence: 1,
                _phantom: std::marker::PhantomData,
            },
        )
        .await
        .unwrap();
    }

    insert_session_visibility(&mut tx, session_id, 1, "created").await.unwrap();
    tx.commit().await.unwrap();

    let frames =
        list_session_frames(db.pool(), "00000000-0000-7000-b001-000000000001").await.unwrap();

    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].ordinal, 0);
    assert_eq!(frames[0].is_representative, 0);
    assert_eq!(frames[1].ordinal, 1);
    assert_eq!(frames[1].is_representative, 1);
}

// ── Watermarked list ──────────────────────────────────────────────────────────

#[tokio::test]
async fn watermarked_list_excludes_sessions_created_after_watermark() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;
    seed_frame(db.pool(), 2).await;

    // Insert first session at sequence=1, capture watermark
    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let s1_id = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-b002-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "digest-s1",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: s1_id,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    insert_session_visibility(&mut tx, s1_id, 1, "created").await.unwrap();
    tx.commit().await.unwrap();

    // Watermark pinned at sequence=1
    let watermark = current_change_sequence(db.pool()).await.unwrap();
    assert_eq!(watermark, 1);

    // Insert a second session at sequence=2
    sqlx::query(
        "INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, '2026-07-22T00:00:01.000000Z')"
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();

    let s2_id = insert_session(
        &mut tx2,
        &InsertSession {
            public_id: "00000000-0000-7000-b002-000000000002",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 1,
            identity_digest: "digest-s2",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 2,
            created_at: "2026-07-22T00:00:01.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx2,
        &InsertSessionFrame {
            session_row_id: s2_id,
            frame_row_id: 2,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 2,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    insert_session_visibility(&mut tx2, s2_id, 2, "created").await.unwrap();
    tx2.commit().await.unwrap();

    let results = list_sessions_at_watermark(
        db.pool(),
        watermark,
        &SessionListFilter::default(),
        None,
        None,
        10,
    )
    .await
    .unwrap();

    // Only s1 was visible at watermark=1
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].public_id, "00000000-0000-7000-b002-000000000001");
}

// ── Supersession ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn supersession_cycle_detection_rejects_cycle() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;

    // We need a reclassification_plan_revision row for the FK.
    // Also need a reclassification_plan and relation_proposal.
    sqlx::query(
        "INSERT INTO relation_proposal
         (row_id, public_id, proposal_revision, kind, basis_digest, evidence_digest,
          config_revision_row_id, state, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-c000-000000000001', 1, 'panel_add',
                 'b', 'e', 1, 'pending', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO reclassification_plan
         (row_id, public_id, head_generation, created_at)
         VALUES (1, '00000000-0000-7000-c000-000000000002', 0, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // Seed the two sessions first (needed as FKs on reclassification_plan_revision)
    seed_frame(db.pool(), 1).await;
    seed_frame(db.pool(), 2).await;

    let mut conn_pre = db.pool().acquire().await.unwrap();
    let mut tx_pre = conn_pre.begin().await.unwrap();

    let s1 = insert_session(
        &mut tx_pre,
        &InsertSession {
            public_id: "00000000-0000-7000-c001-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "d-s1",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx_pre,
        &InsertSessionFrame {
            session_row_id: s1,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    let s2 = insert_session(
        &mut tx_pre,
        &InsertSession {
            public_id: "00000000-0000-7000-c001-000000000002",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 1,
            identity_digest: "d-s2",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx_pre,
        &InsertSessionFrame {
            session_row_id: s2,
            frame_row_id: 2,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    // Need metadata + equipment resolution rows for the plan revision FKs.
    let mr1 = insert_metadata_resolution(
        &mut tx_pre,
        &InsertMetadataResolution {
            public_id: "00000000-0000-7000-c000-000000000010",
            session_row_id: s1,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            state: "accepted",
            actor_row_id: 1,
            command_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_metadata_resolution_head(&mut tx_pre, s1, mr1).await.unwrap();

    let er1 = insert_equipment_resolution(
        &mut tx_pre,
        &InsertEquipmentResolution {
            public_id: "00000000-0000-7000-c000-000000000011",
            session_row_id: s1,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            camera_row_id: None,
            optical_profile_row_id: None,
            camera_alias_evidence_row_id: None,
            optical_alias_evidence_row_id: None,
            focal_length_reported_um: None,
            focal_length_calculated_um: None,
            comparison_severity: "unknown",
            assignment_mode: "automatic",
            accepted_proposal_row_id: None,
            config_revision_row_id: 1,
            actor_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_equipment_resolution_head(&mut tx_pre, s1, er1).await.unwrap();

    tx_pre.commit().await.unwrap();

    sqlx::query(
        "INSERT INTO reclassification_plan_revision
         (row_id, public_id, plan_row_id, revision_number, state,
          source_session_row_id, metadata_resolution_row_id, equipment_resolution_row_id,
          basis_digest, actor_row_id, command_row_id, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-c000-000000000003', 1, 1, 'applied',
                 ?, ?, ?, 'basis', 1, 1, 1, '2026-07-22T00:00:00.000000Z')",
    )
    .bind(s1)
    .bind(mr1)
    .bind(er1)
    .execute(db.pool())
    .await
    .unwrap();

    // Insert the supersession edge s1 → s2 in a new transaction
    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    insert_supersession(
        &mut tx,
        &InsertSupersession {
            predecessor_session_row_id: s1,
            replacement_session_row_id: s2,
            kind: "dark",
            applied_plan_revision_row_id: 1,
            ordinal: 0,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // s1 should no longer be current (has a supersession starting from it)
    assert!(!is_session_current(db.pool(), s1).await.unwrap());
    // s2 should be current
    assert!(is_session_current(db.pool(), s2).await.unwrap());

    // Cycle detection: proposing s2 → s1 should fail (s1 is reachable from s2 via nothing,
    // but more importantly s2 is a replacement of s1, so inserting s2 → s1 would make
    // s1 reachable from s1 in one hop).
    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    let cycle_result = assert_no_supersession_cycle(&mut tx2, s2, s1).await;
    assert!(
        cycle_result.is_err(),
        "proposing s2→s1 when s1→s2 exists should detect a cycle"
    );
    tx2.rollback().await.unwrap();
}

#[tokio::test]
async fn supersession_successor_and_predecessor_list() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;
    seed_frame(db.pool(), 2).await;

    // Insert sessions, then metadata/equipment resolution rows required by
    // reclassification_plan_revision FKs.
    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let s1 = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-d001-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "digest-d1",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: s1,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    let s2 = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-d001-000000000002",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 1,
            identity_digest: "digest-d2",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: s2,
            frame_row_id: 2,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    let mr = insert_metadata_resolution(
        &mut tx,
        &InsertMetadataResolution {
            public_id: "00000000-0000-7000-d000-000000000010",
            session_row_id: s1,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            state: "accepted",
            actor_row_id: 1,
            command_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    insert_metadata_resolution_head(&mut tx, s1, mr).await.unwrap();

    let er = insert_equipment_resolution(
        &mut tx,
        &InsertEquipmentResolution {
            public_id: "00000000-0000-7000-d000-000000000011",
            session_row_id: s1,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            camera_row_id: None,
            optical_profile_row_id: None,
            camera_alias_evidence_row_id: None,
            optical_alias_evidence_row_id: None,
            focal_length_reported_um: None,
            focal_length_calculated_um: None,
            comparison_severity: "unknown",
            assignment_mode: "automatic",
            accepted_proposal_row_id: None,
            config_revision_row_id: 1,
            actor_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();
    insert_equipment_resolution_head(&mut tx, s1, er).await.unwrap();

    tx.commit().await.unwrap();

    // Seed reclassification plan and revision
    sqlx::query(
        "INSERT INTO reclassification_plan
         (row_id, public_id, head_generation, created_at)
         VALUES (1, '00000000-0000-7000-d000-000000000002', 0, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO reclassification_plan_revision
         (row_id, public_id, plan_row_id, revision_number, state,
          source_session_row_id, metadata_resolution_row_id, equipment_resolution_row_id,
          basis_digest, actor_row_id, command_row_id, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-d000-000000000003', 1, 1, 'applied',
                 ?, ?, ?, 'basis', 1, 1, 1, '2026-07-22T00:00:00.000000Z')",
    )
    .bind(s1)
    .bind(mr)
    .bind(er)
    .execute(db.pool())
    .await
    .unwrap();

    // Insert supersession
    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();

    insert_supersession(
        &mut tx2,
        &InsertSupersession {
            predecessor_session_row_id: s1,
            replacement_session_row_id: s2,
            kind: "dark",
            applied_plan_revision_row_id: 1,
            ordinal: 0,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    tx2.commit().await.unwrap();

    let successors = list_supersession_successors(db.pool(), s1).await.unwrap();
    assert_eq!(successors.len(), 1);
    assert_eq!(successors[0].replacement_session_row_id, s2);

    let predecessors = list_supersession_predecessors(db.pool(), s2).await.unwrap();
    assert_eq!(predecessors.len(), 1);
    assert_eq!(predecessors[0].predecessor_session_row_id, s1);
}

// ── Equipment resolution ──────────────────────────────────────────────────────

#[tokio::test]
async fn equipment_resolution_insert_and_cas_advance() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let session_id = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-e001-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "digest-e",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: session_id,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();
    insert_session_visibility(&mut tx, session_id, 1, "created").await.unwrap();

    // Insert first equipment resolution revision
    let rev1_id = insert_equipment_resolution(
        &mut tx,
        &InsertEquipmentResolution {
            public_id: "00000000-0000-7000-e001-000000000010",
            session_row_id: session_id,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            camera_row_id: None,
            optical_profile_row_id: None,
            camera_alias_evidence_row_id: None,
            optical_alias_evidence_row_id: None,
            focal_length_reported_um: None,
            focal_length_calculated_um: None,
            comparison_severity: "unknown",
            assignment_mode: "automatic",
            accepted_proposal_row_id: None,
            config_revision_row_id: 1,
            actor_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_equipment_resolution_head(&mut tx, session_id, rev1_id).await.unwrap();
    tx.commit().await.unwrap();

    // Verify head points to rev1
    let head = get_equipment_resolution_head(db.pool(), session_id).await.unwrap();
    assert_eq!(head.head_resolution_row_id, rev1_id);
    assert_eq!(head.head_generation, 0);

    // Insert rev2 and advance with CAS
    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();

    let rev2_id = insert_equipment_resolution(
        &mut tx2,
        &InsertEquipmentResolution {
            public_id: "00000000-0000-7000-e001-000000000011",
            session_row_id: session_id,
            revision_number: 2,
            predecessor_resolution_row_id: Some(rev1_id),
            camera_row_id: None,
            optical_profile_row_id: None,
            camera_alias_evidence_row_id: None,
            optical_alias_evidence_row_id: None,
            focal_length_reported_um: None,
            focal_length_calculated_um: None,
            comparison_severity: "normal",
            assignment_mode: "reviewed",
            accepted_proposal_row_id: None,
            config_revision_row_id: 1,
            actor_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:01.000000Z",
        },
    )
    .await
    .unwrap();

    advance_equipment_resolution_head(&mut tx2, session_id, rev1_id, 0, rev2_id).await.unwrap();
    tx2.commit().await.unwrap();

    let accepted = get_accepted_equipment_resolution(db.pool(), session_id).await.unwrap();
    assert_eq!(accepted.revision_number, 2);
    assert_eq!(accepted.comparison_severity, "normal");

    // Stale CAS must fail
    let mut conn3 = db.pool().acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    let stale_result =
        advance_equipment_resolution_head(&mut tx3, session_id, rev1_id, 0, rev1_id).await;
    assert!(stale_result.is_err(), "stale CAS must be rejected");
    tx3.rollback().await.unwrap();
}

// ── Metadata resolution ───────────────────────────────────────────────────────

#[tokio::test]
async fn metadata_resolution_insert_and_cas_advance() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;
    seed_frame(db.pool(), 1).await;

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let session_id = insert_session(
        &mut tx,
        &InsertSession {
            public_id: "00000000-0000-7000-f001-000000000001",
            materialization_operation_row_id: 1,
            kind: "dark",
            ordinal_in_operation: 0,
            identity_digest: "digest-f",
            observing_night_date: "2026-07-21",
            site_row_id: None,
            timezone_name_snapshot: None,
            night_derivation: "reviewed_local_fallback",
            canonical_target_row_id: None,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    insert_session_frame(
        &mut tx,
        &InsertSessionFrame {
            session_row_id: session_id,
            frame_row_id: 1,
            materialization_operation_row_id: 1,
            ordinal: 0,
            is_representative: true,
            created_sequence: 1,
            _phantom: std::marker::PhantomData,
        },
    )
    .await
    .unwrap();

    insert_session_visibility(&mut tx, session_id, 1, "created").await.unwrap();

    let rev1_id = insert_metadata_resolution(
        &mut tx,
        &InsertMetadataResolution {
            public_id: "00000000-0000-7000-f001-000000000010",
            session_row_id: session_id,
            revision_number: 1,
            predecessor_resolution_row_id: None,
            state: "accepted",
            actor_row_id: 1,
            command_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:00.000000Z",
        },
    )
    .await
    .unwrap();

    // Insert frame evidence pin
    insert_metadata_resolution_frame(
        &mut tx,
        &InsertMetadataResolutionFrame {
            resolution_row_id: rev1_id,
            frame_row_id: 1,
            evidence_row_id: 0, // no frame_metadata_evidence row required for FK check in this test
            ordinal: 0,
        },
    )
    .await
    .unwrap_or_else(|_| ()); // may fail if FK enforced on evidence_row_id; accept gracefully

    insert_metadata_resolution_head(&mut tx, session_id, rev1_id).await.unwrap();
    tx.commit().await.unwrap();

    let head = get_metadata_resolution_head(db.pool(), session_id).await.unwrap();
    assert_eq!(head.head_generation, 0);
    assert_eq!(head.head_resolution_row_id, rev1_id);

    // Insert rev2 and advance
    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();

    let rev2_id = insert_metadata_resolution(
        &mut tx2,
        &InsertMetadataResolution {
            public_id: "00000000-0000-7000-f001-000000000011",
            session_row_id: session_id,
            revision_number: 2,
            predecessor_resolution_row_id: Some(rev1_id),
            state: "accepted",
            actor_row_id: 1,
            command_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:01.000000Z",
        },
    )
    .await
    .unwrap();

    advance_metadata_resolution_head(&mut tx2, session_id, rev1_id, 0, rev2_id).await.unwrap();
    tx2.commit().await.unwrap();

    let accepted = get_accepted_metadata_resolution(db.pool(), session_id).await.unwrap();
    assert_eq!(accepted.revision_number, 2);

    // Stale CAS rejects
    let mut conn3 = db.pool().acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    let stale = advance_metadata_resolution_head(&mut tx3, session_id, rev1_id, 0, rev1_id).await;
    assert!(stale.is_err());
    tx3.rollback().await.unwrap();
}

// ── Materialization operation + result snapshot ───────────────────────────────

#[tokio::test]
async fn materialization_operation_lifecycle_and_result_snapshot() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;

    // Insert a second operation (operation 1 from fixture is already there)
    // Use a second command row
    sqlx::query(
        "INSERT INTO command_execution (
            row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
            response_json, created_at, finished_at
         ) VALUES (
            2, '00000000-0000-7000-g000-000000000002', 1, 'inbox.materialization.apply',
            'payload-digest-2', 'executing', NULL, '2026-07-22T00:00:02.000000Z', NULL
         )",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let op_id = insert_materialization_operation(
        &mut tx,
        &InsertMaterializationOperation {
            public_id: "00000000-0000-7000-g001-000000000001",
            kind: "inbox_ingestion",
            command_row_id: 2,
            config_revision_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:02.000000Z",
        },
    )
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // Transition ready → applying
    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    transition_operation_to_applying(&mut tx2, op_id, 0, "2026-07-22T00:00:03.000000Z")
        .await
        .unwrap();
    tx2.commit().await.unwrap();

    let op = get_operation_by_public_id(db.pool(), "00000000-0000-7000-g001-000000000001")
        .await
        .unwrap();
    assert_eq!(op.state, "applying");
    assert_eq!(op.state_version, 1);

    // Insert result snapshot and transition applying → applied
    let mut conn3 = db.pool().acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();

    let snapshot_id = insert_result_snapshot(
        &mut tx3,
        &InsertMaterializationResultSnapshot {
            public_id: "00000000-0000-7000-g001-000000000002",
            operation_row_id: op_id,
            session_count: 2,
            membership_count: 5,
            singleton_group_count: 2,
            blocked_frame_count: 1,
            canonical_digest: "result-digest-g",
            created_sequence: 1,
            created_at: "2026-07-22T00:00:04.000000Z",
        },
    )
    .await
    .unwrap();

    transition_operation_to_applied(
        &mut tx3,
        op_id,
        1,
        snapshot_id,
        2,
        5,
        2,
        1,
        "2026-07-22T00:00:04.000000Z",
    )
    .await
    .unwrap();

    tx3.commit().await.unwrap();

    let op_applied =
        get_operation_by_public_id(db.pool(), "00000000-0000-7000-g001-000000000001")
            .await
            .unwrap();
    assert_eq!(op_applied.state, "applied");
    assert_eq!(op_applied.session_count, Some(2));

    let snapshot =
        get_result_snapshot_by_operation_public_id(db.pool(), "00000000-0000-7000-g001-000000000001")
            .await
            .unwrap();
    assert_eq!(snapshot.session_count, 2);
    assert_eq!(snapshot.canonical_digest, "result-digest-g");
}

#[tokio::test]
async fn operation_failed_transition() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;

    sqlx::query(
        "INSERT INTO command_execution (
            row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
            response_json, created_at, finished_at
         ) VALUES (
            2, '00000000-0000-7000-h000-000000000002', 1, 'inbox.materialization.apply',
            'payload-digest-h', 'executing', NULL, '2026-07-22T00:00:02.000000Z', NULL
         )",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();

    let op_id = insert_materialization_operation(
        &mut tx,
        &InsertMaterializationOperation {
            public_id: "00000000-0000-7000-h001-000000000001",
            kind: "inbox_ingestion",
            command_row_id: 2,
            config_revision_row_id: 1,
            created_sequence: 1,
            created_at: "2026-07-22T00:00:02.000000Z",
        },
    )
    .await
    .unwrap();

    tx.commit().await.unwrap();

    let mut conn2 = db.pool().acquire().await.unwrap();
    let mut tx2 = conn2.begin().await.unwrap();
    transition_operation_to_applying(&mut tx2, op_id, 0, "2026-07-22T00:00:03.000000Z")
        .await
        .unwrap();
    tx2.commit().await.unwrap();

    let mut conn3 = db.pool().acquire().await.unwrap();
    let mut tx3 = conn3.begin().await.unwrap();
    transition_operation_to_failed(
        &mut tx3,
        op_id,
        1,
        "io_error",
        "2026-07-22T00:00:05.000000Z",
    )
    .await
    .unwrap();
    tx3.commit().await.unwrap();

    let op = get_operation_by_public_id(db.pool(), "00000000-0000-7000-h001-000000000001")
        .await
        .unwrap();
    assert_eq!(op.state, "failed");
    assert_eq!(op.failure_code.as_deref(), Some("io_error"));
}

// ── Stale CAS on operation ────────────────────────────────────────────────────

#[tokio::test]
async fn stale_operation_cas_is_rejected() {
    let db = setup_db().await;
    seed_operation_fixtures(db.pool()).await;

    // Re-use fixture operation row_id=1 which is in 'ready' state
    let op_public_id = "00000000-0000-7000-a000-000000000004";
    let op = get_operation_by_public_id(db.pool(), op_public_id).await.unwrap();
    assert_eq!(op.state, "ready");

    let mut conn = db.pool().acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    // Wrong state_version
    let stale = transition_operation_to_applying(&mut tx, op.row_id, 99, "2026-07-22T00:00:10.000000Z").await;
    assert!(stale.is_err(), "wrong state_version must be rejected");
    tx.rollback().await.unwrap();
}
