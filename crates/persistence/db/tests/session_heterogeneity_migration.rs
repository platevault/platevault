// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Migration 0082 integration tests for the normalized Spec 062 schema.

use persistence_db::Database;
use sqlx::{Acquire, Executor, SqlitePool};

async fn fresh_database() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().expect("temporary database directory");
    let path = dir.path().join("session-heterogeneity.db");
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let db = Database::connect(&url).await.expect("connect fresh database");
    db.migrate_uncached().await.expect("run complete migration chain");
    let foreign_keys: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
        .fetch_one(db.pool())
        .await
        .expect("read foreign_keys pragma");
    assert_eq!(foreign_keys.0, 1, "migration connection must restore foreign key enforcement");
    (dir, db)
}

async fn seed_session(pool: &SqlitePool) {
    let mut connection = pool.acquire().await.expect("acquire seed connection");
    let mut tx = connection.begin().await.expect("begin seed transaction");
    tx.execute("INSERT INTO spec062_actor VALUES (1, '00000000-0000-7000-8000-000000000001', '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute("INSERT INTO spec062_config_revision VALUES (1, '00000000-0000-7000-8000-000000000002', 1, 'config-digest', '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute("INSERT INTO repository_change(command_row_id, created_at) VALUES (NULL, '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute(
        "INSERT INTO command_execution (
            row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
            response_json, created_at, finished_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000003', 1, 'inbox.materialization.apply',
            'payload-digest', 'applied', '{}', '2026-07-22T00:00:00.000000Z',
            '2026-07-22T00:00:01.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO session_materialization_operation (
            row_id, public_id, kind, command_row_id, config_revision_row_id, state,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000004', 'inbox_ingestion', 1, 1,
            'ready', 1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO session (
            row_id, public_id, materialization_operation_row_id, kind,
            ordinal_in_operation, identity_digest, observing_night_date,
            night_derivation, created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000005', 1, 'dark', 0,
            'session-digest', '2026-07-21', 'reviewed_local_fallback', 1,
            '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.execute("INSERT INTO spec062_file_identity VALUES (1, '00000000-0000-7000-8000-000000000006', NULL, '2026-07-22T00:00:00.000000Z')")
        .await
        .unwrap();
    tx.execute(
        "INSERT INTO frame_record (
            row_id, public_id, file_row_id, byte_size, captured_metadata_digest,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000007', 1, 4096, 'frame-digest',
            1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .await
    .unwrap();
    tx.commit().await.expect("commit seed data");
}

#[tokio::test]
async fn full_chain_has_normalized_integer_relationships_and_no_relationship_json() {
    let (_dir, db) = fresh_database().await;

    let foreign_key_violations: Vec<(String, i64, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(db.pool())
            .await
            .expect("foreign key check");
    assert!(
        foreign_key_violations.is_empty(),
        "foreign key violations: {foreign_key_violations:?}"
    );

    let relationship_columns: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT m.name, p.name, p.type
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS p
         WHERE m.type = 'table'
           AND (m.name LIKE 'session_%' OR m.name LIKE 'panel_%'
                OR m.name LIKE 'mosaic_%' OR m.name LIKE 'project_%')
           AND (p.name LIKE '%_row_id' OR p.name IN ('row_id', 'sequence'))",
    )
    .fetch_all(db.pool())
    .await
    .expect("inspect relationship columns");
    assert!(!relationship_columns.is_empty());
    assert!(relationship_columns.iter().all(|(_, _, ty)| ty == "INTEGER"));

    let forbidden_json_columns: Vec<(String, String)> = sqlx::query_as(
        "SELECT m.name, p.name
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS p
         WHERE m.type = 'table'
           AND (m.name LIKE 'session_%' OR m.name LIKE 'panel_%'
                OR m.name LIKE 'mosaic_%' OR m.name LIKE 'project_%')
           AND p.name LIKE '%json%'",
    )
    .fetch_all(db.pool())
    .await
    .expect("inspect canonical relationship storage");
    assert!(
        forbidden_json_columns.is_empty(),
        "relationship JSON remains: {forbidden_json_columns:?}"
    );
}

#[tokio::test]
async fn accepted_session_membership_is_append_only_and_exact_cardinality_is_queryable() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    let violations: Vec<(String, i64)> = sqlx::query_as(
        "SELECT invariant, owner_row_id FROM spec062_invariant_violation
         WHERE invariant = 'session_membership_cardinality'",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(violations, vec![("session_membership_cardinality".to_owned(), 1)]);

    sqlx::query(
        "INSERT INTO session_frame (
            session_row_id, frame_row_id, materialization_operation_row_id,
            ordinal, is_representative, created_sequence
         ) VALUES (1, 1, 1, 0, 1, 1)",
    )
    .execute(db.pool())
    .await
    .expect("insert complete immutable membership");

    let remaining: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'session_membership_cardinality'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(remaining.0, 0);

    assert!(sqlx::query("UPDATE session_frame SET ordinal = 2 WHERE session_row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("DELETE FROM session_frame WHERE session_row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("UPDATE session SET identity_digest = 'changed' WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn footprint_rtree_preserves_outward_i32_bounds() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    // Exact bounds straddle quantization cells. The writer's floor(min*1e9) and
    // ceil(max*1e9) produce these conservative integers.
    let (min_x, max_x): (i64, i64) = sqlx::query_as(
        "SELECT CAST(? * 1000000000.0 AS INTEGER)
                    - (? * 1000000000.0 < CAST(? * 1000000000.0 AS INTEGER)),
                CAST(? * 1000000000.0 AS INTEGER)
                    + (? * 1000000000.0 > CAST(? * 1000000000.0 AS INTEGER))",
    )
    .bind(-0.100_000_000_1_f64)
    .bind(-0.100_000_000_1_f64)
    .bind(-0.100_000_000_1_f64)
    .bind(0.100_000_000_1_f64)
    .bind(0.100_000_000_1_f64)
    .bind(0.100_000_000_1_f64)
    .fetch_one(db.pool())
    .await
    .expect("quantize exact bounds outwards");
    assert_eq!((min_x, max_x), (-100_000_001, 100_000_001));

    sqlx::query(
        "INSERT INTO frame_metadata_evidence (
            row_id, public_id, frame_row_id, revision_number, detected_kind,
            offset_state, binning_state, readout_state, footprint_wkb, footprint_digest,
            centre_ra_udeg, centre_dec_udeg,
            bbox_min_x_ppb, bbox_max_x_ppb, bbox_min_y_ppb, bbox_max_y_ppb,
            bbox_min_z_ppb, bbox_max_z_ppb, geometry_solver_version, actor_row_id,
            command_row_id, created_sequence, recorded_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000008', 1, 1, 'dark',
            'absent', 'absent', 'absent', X'01', 'footprint-digest', 0, 90000000, ?, ?,
            -1, 1, -1000000000, 1000000000, 'solver-v1', 1, 1, 1,
            '2026-07-22T00:00:00.000000Z'
         )",
    )
    .bind(min_x)
    .bind(max_x)
    .execute(db.pool())
    .await
    .expect("insert footprint evidence");

    let bounds: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT min_x_ppb, max_x_ppb, min_y_ppb, max_y_ppb, min_z_ppb, max_z_ppb
         FROM frame_footprint_rtree WHERE evidence_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .expect("rtree row inserted atomically with evidence");
    assert_eq!(bounds, (min_x, max_x, -1, 1, -1_000_000_000, 1_000_000_000));

    // Exercise all axes and spherical extrema, including RA zero and both poles.
    for (offset, (min_x, max_x, min_y, max_y, min_z, max_z, ra, dec)) in [
        (2_i64, (-1_000_000_000, -999_999_999, -20, 20, -30, 30, 0, -90_000_000)),
        (3, (-400, 400, -1_000_000_000, -999_999_999, -50, 50, 180_000_000, 0)),
        (4, (-600, 600, -70, 70, 999_999_999, 1_000_000_000, 359_999_999, 90_000_000)),
        (5, (-800, 800, -90, 90, -100, 100, 12_345_678, 45_000_000)),
    ] {
        sqlx::query(
            "INSERT INTO spec062_file_identity VALUES (?, ?, NULL, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("file-{offset}"))
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO frame_record
             (row_id, public_id, file_row_id, byte_size, captured_metadata_digest,
              created_sequence, created_at)
             VALUES (?, ?, ?, 1, ?, 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("frame-{offset}"))
        .bind(offset)
        .bind(format!("digest-{offset}"))
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO frame_metadata_evidence
             (row_id, public_id, frame_row_id, revision_number, detected_kind,
              offset_state, binning_state, readout_state, footprint_wkb, footprint_digest,
              centre_ra_udeg, centre_dec_udeg,
              bbox_min_x_ppb, bbox_max_x_ppb, bbox_min_y_ppb, bbox_max_y_ppb,
              bbox_min_z_ppb, bbox_max_z_ppb, geometry_solver_version,
              actor_row_id, command_row_id, created_sequence, recorded_at)
             VALUES (?, ?, ?, 1, 'dark', 'absent', 'absent', 'absent', X'01', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     'solver-v1', 1, 1, 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("evidence-{offset}"))
        .bind(offset)
        .bind(format!("footprint-{offset}"))
        .bind(ra)
        .bind(dec)
        .bind(min_x)
        .bind(max_x)
        .bind(min_y)
        .bind(max_y)
        .bind(min_z)
        .bind(max_z)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let mut seed = 0x9e37_79b9_u64;
    for offset in 6_i64..=21 {
        // A deterministic pseudo-random corpus keeps this regression test stable
        // while exercising quantization cells across all three axes.
        let next = |state: &mut u64| {
            *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            (*state >> 16).cast_signed()
        };
        let min_x = next(&mut seed) % 1_000_000_000;
        let min_y = next(&mut seed) % 1_000_000_000;
        let min_z = next(&mut seed) % 1_000_000_000;
        let max_x = min_x + (next(&mut seed) % (1_000_000_000 - min_x));
        let max_y = min_y + (next(&mut seed) % (1_000_000_000 - min_y));
        let max_z = min_z + (next(&mut seed) % (1_000_000_000 - min_z));
        sqlx::query(
            "INSERT INTO spec062_file_identity VALUES (?, ?, NULL, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("random-file-{offset}"))
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO frame_record
             (row_id, public_id, file_row_id, byte_size, captured_metadata_digest,
              created_sequence, created_at)
             VALUES (?, ?, ?, 1, ?, 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("random-frame-{offset}"))
        .bind(offset)
        .bind(format!("random-digest-{offset}"))
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO frame_metadata_evidence
             (row_id, public_id, frame_row_id, revision_number, detected_kind,
              offset_state, binning_state, readout_state, footprint_wkb, footprint_digest,
              bbox_min_x_ppb, bbox_max_x_ppb, bbox_min_y_ppb, bbox_max_y_ppb,
              bbox_min_z_ppb, bbox_max_z_ppb, actor_row_id, command_row_id,
              created_sequence, recorded_at)
             VALUES (?, ?, ?, 1, 'dark', 'absent', 'absent', 'absent', X'01', ?, ?, ?, ?, ?, ?, ?, 1, 1, 1,
                     '2026-07-22T00:00:00.000000Z')",
        )
        .bind(offset)
        .bind(format!("random-evidence-{offset}"))
        .bind(offset)
        .bind(format!("random-footprint-{offset}"))
        .bind(min_x)
        .bind(max_x)
        .bind(min_y)
        .bind(max_y)
        .bind(min_z)
        .bind(max_z)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let corpus_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM frame_footprint_rtree")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(corpus_count.0, 21);

    // The RTree is a conservative bounding-box shortlist. For representative
    // query windows, every exact box intersection must remain in the shortlist.
    for (min_x, max_x, min_y, max_y, min_z, max_z) in [
        (
            -1_000_000_000_i64,
            1_000_000_000,
            -1_000_000_000,
            1_000_000_000,
            -1_000_000_000,
            1_000_000_000,
        ),
        (-700, 700, -100, 100, -100, 100),
        (-1_000_000_000, -999_999_999, -100, 100, -100, 100),
        (-900_000_000, 900_000_000, -900_000_000, 900_000_000, -900_000_000, 900_000_000),
    ] {
        let exact: Vec<(i64,)> = sqlx::query_as(
            "SELECT row_id
             FROM frame_metadata_evidence
             WHERE bbox_max_x_ppb >= ? AND bbox_min_x_ppb <= ?
               AND bbox_max_y_ppb >= ? AND bbox_min_y_ppb <= ?
               AND bbox_max_z_ppb >= ? AND bbox_min_z_ppb <= ?
             ORDER BY row_id",
        )
        .bind(min_x)
        .bind(max_x)
        .bind(min_y)
        .bind(max_y)
        .bind(min_z)
        .bind(max_z)
        .fetch_all(db.pool())
        .await
        .unwrap();
        let shortlist: Vec<(i64,)> = sqlx::query_as(
            "SELECT evidence_row_id
             FROM frame_footprint_rtree
             WHERE max_x_ppb >= ? AND min_x_ppb <= ?
               AND max_y_ppb >= ? AND min_y_ppb <= ?
               AND max_z_ppb >= ? AND min_z_ppb <= ?
             ORDER BY evidence_row_id",
        )
        .bind(min_x)
        .bind(max_x)
        .bind(min_y)
        .bind(max_y)
        .bind(min_z)
        .bind(max_z)
        .fetch_all(db.pool())
        .await
        .unwrap();
        assert!(
            exact.iter().all(|candidate| shortlist.contains(candidate)),
            "RTree shortlist omitted an exact intersecting candidate for query bounds ({min_x}, {max_x}, {min_y}, {max_y}, {min_z}, {max_z})"
        );
    }
    let extrema: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT min_x_ppb, max_x_ppb, min_y_ppb, max_y_ppb, min_z_ppb, max_z_ppb
         FROM frame_footprint_rtree WHERE evidence_row_id = 4",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(extrema, (-600, 600, -70, 70, 999_999_999, 1_000_000_000));

    assert!(sqlx::query("UPDATE frame_metadata_evidence SET bbox_min_x_ppb = 0 WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
async fn normalized_result_counts_and_visibility_history_are_enforced() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    sqlx::query(
        "INSERT INTO spec062_inbox_materialization_plan
         (row_id, public_id, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000009',
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO inbox_materialization_plan_result_snapshot
         (row_id, public_id, plan_row_id, plan_revision, config_revision_row_id,
          input_evidence_revision, proposed_session_count, frame_count,
          blocked_frame_count, canonical_digest, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000010', 1, 1, 1, 1,
                 0, 1, 0, 'inbox-result', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let inbox_frame_mismatch: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'inbox_frame_count' AND owner_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(inbox_frame_mismatch.0, 1);

    sqlx::query(
        "INSERT INTO session_materialization_result_snapshot (
            row_id, public_id, operation_row_id, session_count, membership_count,
            singleton_group_count, blocked_frame_count, canonical_digest,
            created_sequence, created_at
         ) VALUES (
            1, '00000000-0000-7000-8000-000000000009', 1, 1, 0, 0, 0,
            'result-digest', 1, '2026-07-22T00:00:00.000000Z'
         )",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let mismatch: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'operation_session_count' AND owner_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(mismatch.0, 1);

    sqlx::query(
        "INSERT INTO session_materialization_result_session
         (snapshot_row_id, session_row_id, ordinal) VALUES (1, 1, 0)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let mismatch: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM spec062_invariant_violation
         WHERE invariant = 'operation_session_count' AND owner_row_id = 1",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(mismatch.0, 0);

    let history_tables: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
            'panel_group_head_history', 'mosaic_head_history',
            'project_membership_head_history', 'project_materialization_head_history'
         )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(history_tables.0, 4, "every mutable domain head needs watermark history");
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn every_approved_data_model_family_has_normalized_storage() {
    let (_dir, db) = fresh_database().await;
    let expected = [
        "acquisition_site_resolution_revision",
        "inbox_materialization_plan_result_snapshot",
        "inbox_plan_result_proposed_session_frame",
        "session_materialization_operation",
        "session_materialization_result_snapshot",
        "frame_metadata_evidence",
        "session_metadata_resolution",
        "session_frame",
        "camera_regulation_decision",
        "equipment_alias_evidence",
        "session_equipment_resolution",
        "capture_profile_version",
        "capture_field_mapping",
        "calibration_family",
        "dark_recipe_identity",
        "bias_recipe_identity",
        "flat_family_identity",
        "spec062_calibration_session",
        "dark_thermal_evidence",
        "calibration_reuse_decision",
        "calibration_handoff_snapshot",
        "calibration_handoff_candidate_evidence",
        "calibration_handoff_selection",
        "calibration_handoff_frame",
        "reclassification_plan_revision",
        "reclassification_plan_input",
        "reclassification_plan_output_frame",
        "reclassification_plan_result_snapshot",
        "reclassification_apply_result_snapshot",
        "session_supersession",
        "cross_target_association_target",
        "panel_group_revision",
        "panel_revision_session",
        "panel_group_lineage",
        "mosaic_edge_evidence",
        "mosaic_edge_invalidation",
        "mosaic_revision_panel",
        "mosaic_revision_edge",
        "mosaic_lineage",
        "mosaic_object_evidence",
        "proposal_session_input",
        "proposal_panel_revision_input",
        "proposal_mosaic_revision_input",
        "proposal_project_revision_input",
        "proposal_panel_membership",
        "proposal_mosaic_membership",
        "proposal_mosaic_edge",
        "proposal_panel_lineage",
        "proposal_mosaic_lineage",
        "proposal_measurement",
        "relation_decision_snapshot",
        "relation_decision_panel_revision",
        "relation_decision_mosaic_revision",
        "relation_rejection",
        "project_membership_revision",
        "project_membership_revision_session",
        "group_action_session_snapshot",
        "project_materialization_snapshot",
        "project_materialization_snapshot_session",
        "materialized_entry",
        "project_manifest",
        "project_manifest_entry",
        "project_manifest_overlay",
        "correction_overlay",
        "correction_overlay_mapping",
        "materialization_update_plan",
        "materialization_update_plan_session",
        "materialization_plan_entry",
        "materialization_install_intent",
        "materialization_item_journal",
        "source_availability_rollup",
        "matching_settings_revision",
        "matching_settings_camera_policy",
        "audit_event",
        "outbox_event",
    ];

    for table in expected {
        let exists: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
        )
        .bind(table)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(exists.0, 1, "missing normalized Spec 062 family table `{table}`");
    }

    let frame_columns: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info('frame_metadata_evidence') ORDER BY cid",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    for column in [
        "classification_source",
        "classification_confidence",
        "canonical_time_source",
        "local_exposure_text",
        "local_time_parse_state",
        "gain_text",
        "crop_state",
        "crop_payload",
        "cooling_setpoint_state",
        "cooling_setpoint_millic",
        "sensor_temperature_state",
        "sensor_temperature_millic",
        "camera_reported",
        "telescope_reported",
        "focal_length_reported_um",
        "focal_length_calculated_um",
        "filter_state",
        "filter_reported",
        "physical_rotator_state",
        "physical_rotator_udeg",
        "physical_rotator_field_id",
        "sky_orientation_state",
        "sky_orientation_udeg",
        "centre_ra_udeg",
        "centre_dec_udeg",
        "capture_profile_version_row_id",
    ] {
        assert!(
            frame_columns.iter().any(|actual| actual == column),
            "missing typed frame field `{column}`"
        );
    }
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn owner_scoped_heads_and_parent_chains_reject_cross_owner_references() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    sqlx::query("INSERT INTO spec062_target VALUES (1, '00000000-0000-7000-8000-000000000010', '2026-07-22T00:00:00.000000Z')")
        .execute(db.pool()).await.unwrap();
    sqlx::query(
        "INSERT INTO session
         (row_id, public_id, materialization_operation_row_id, kind,
          ordinal_in_operation, identity_digest, observing_night_date,
          night_derivation, canonical_target_row_id, created_sequence, created_at)
         VALUES (2, '00000000-0000-7000-8000-000000000013', 1, 'light', 1,
                 'light-session', '2026-07-21', 'reviewed_local_fallback', 1, 1,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    for (id, public_id) in [
        (1_i64, "00000000-0000-7000-8000-000000000011"),
        (2_i64, "00000000-0000-7000-8000-000000000012"),
    ] {
        sqlx::query(
            "INSERT INTO panel_group
             (row_id, public_id, canonical_target_row_id, status, created_sequence, created_at)
             VALUES (?, ?, 1, 'active', 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(id)
        .bind(public_id)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO panel_group_revision
             (row_id, public_id, panel_group_row_id, revision_number,
              representative_session_row_id, config_revision_row_id, actor_row_id,
              reason_code, created_sequence, created_at)
             VALUES (?, ?, ?, 1, 2, 1, 1, 'initial', 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(id)
        .bind(format!("00000000-0000-7000-8000-00000000002{id}"))
        .bind(id)
        .execute(db.pool())
        .await
        .unwrap();
    }

    sqlx::query(
        "INSERT INTO repository_change(command_row_id, created_at)
         VALUES (NULL, '2026-07-22T00:00:02.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO panel_group_head_history
         (panel_group_row_id, generation, head_revision_row_id, accepted_sequence)
         VALUES (1, 0, 1, 1)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE panel_group_head_history SET retired_sequence = 2
         WHERE panel_group_row_id = 1 AND generation = 0",
    )
    .execute(db.pool())
    .await
    .expect("current head may be retired exactly once");
    assert!(sqlx::query(
        "UPDATE panel_group_head_history SET retired_sequence = 3
         WHERE panel_group_row_id = 1 AND generation = 0",
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query(
        "UPDATE panel_group_head_history SET accepted_sequence = 2
         WHERE panel_group_row_id = 1 AND generation = 0",
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query("UPDATE panel_group SET head_revision_row_id = 2 WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query(
        "INSERT INTO panel_revision_session
         (panel_revision_row_id, session_row_id, ordinal) VALUES (1, 1, 0)",
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query(
        "INSERT INTO panel_group_revision
         (row_id, public_id, panel_group_row_id, revision_number, parent_revision_row_id,
          representative_session_row_id, config_revision_row_id, actor_row_id,
          reason_code, created_sequence, created_at)
         VALUES (3, '00000000-0000-7000-8000-000000000023', 1, 2, 2, 2, 1, 1,
                 'cross-owner', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());

    sqlx::query(
        "INSERT INTO relation_proposal
         (row_id, public_id, proposal_revision, kind, basis_digest, evidence_digest,
          config_revision_row_id, state, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000030', 1, 'mosaic_create',
                 'basis', 'evidence', 1, 'pending', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    for id in [1_i64, 2] {
        sqlx::query(
            "INSERT INTO mosaic
             (row_id, public_id, canonical_target_row_id, status, created_sequence, created_at)
             VALUES (?, ?, 1, 'active', 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(id)
        .bind(format!("00000000-0000-7000-8000-00000000003{id}"))
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO mosaic_revision
             (row_id, public_id, mosaic_row_id, revision_number, proposal_row_id,
              config_revision_row_id, actor_row_id, reason_code, created_sequence, created_at)
             VALUES (?, ?, ?, 1, 1, 1, 1, 'initial', 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(id)
        .bind(format!("00000000-0000-7000-8000-00000000004{id}"))
        .bind(id)
        .execute(db.pool())
        .await
        .unwrap();
    }
    assert!(sqlx::query("UPDATE mosaic SET head_revision_row_id = 2 WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query(
        "INSERT INTO mosaic_revision
         (row_id, public_id, mosaic_row_id, revision_number, parent_revision_row_id,
          proposal_row_id, config_revision_row_id, actor_row_id, reason_code,
          created_sequence, created_at)
         VALUES (3, '00000000-0000-7000-8000-000000000043', 1, 2, 2, 1, 1, 1,
                 'cross-owner', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());

    for id in [1_i64, 2] {
        sqlx::query("INSERT INTO spec062_project (row_id, public_id, created_at) VALUES (?, ?, '2026-07-22T00:00:00.000000Z')")
            .bind(id).bind(format!("00000000-0000-7000-8000-00000000005{id}"))
            .execute(db.pool()).await.unwrap();
        sqlx::query(
            "INSERT INTO project_membership_revision
             (row_id, public_id, project_row_id, revision_number, actor_row_id,
              created_sequence, created_at)
             VALUES (?, ?, ?, 1, 1, 1, '2026-07-22T00:00:00.000000Z')",
        )
        .bind(id)
        .bind(format!("00000000-0000-7000-8000-00000000006{id}"))
        .bind(id)
        .execute(db.pool())
        .await
        .unwrap();
    }
    assert!(sqlx::query(
        "UPDATE spec062_project SET membership_head_revision_row_id = 2 WHERE row_id = 1"
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query(
        "INSERT INTO project_membership_revision
         (row_id, public_id, project_row_id, revision_number, parent_revision_row_id,
          actor_row_id, created_sequence, created_at)
         VALUES (3, '00000000-0000-7000-8000-000000000063', 1, 2, 2, 1, 1,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());

    sqlx::query("INSERT INTO spec062_file_identity VALUES (2, '00000000-0000-7000-8000-000000000070', NULL, '2026-07-22T00:00:00.000000Z')")
        .execute(db.pool()).await.unwrap();
    sqlx::query("INSERT INTO frame_record (row_id, public_id, file_row_id, byte_size, captured_metadata_digest, created_sequence, created_at) VALUES (2, '00000000-0000-7000-8000-000000000071', 2, 1, 'f2', 1, '2026-07-22T00:00:00.000000Z')")
        .execute(db.pool()).await.unwrap();
    sqlx::query("INSERT INTO frame_metadata_evidence (row_id, public_id, frame_row_id, revision_number, detected_kind, offset_state, binning_state, readout_state, actor_row_id, command_row_id, created_sequence, recorded_at) VALUES (2, '00000000-0000-7000-8000-000000000072', 2, 1, 'dark', 'absent', 'absent', 'absent', 1, 1, 1, '2026-07-22T00:00:00.000000Z')")
        .execute(db.pool()).await.unwrap();
    assert!(sqlx::query("INSERT INTO frame_metadata_evidence_head VALUES (1, 2, 0)")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn typed_references_idempotency_and_fencing_fail_closed() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    for removed in [
        "relation_decision_revision",
        "relation_decision_retired_group",
        "relation_decision_lineage",
    ] {
        let exists: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE name = ?")
            .bind(removed)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(exists.0, 0, "unbound polymorphic table `{removed}` must not exist");
    }

    sqlx::query(
        "INSERT INTO relation_proposal
         (row_id, public_id, proposal_revision, kind, basis_digest, evidence_digest,
          config_revision_row_id, state, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000080', 1, 'panel_add',
                 'b', 'e', 1, 'pending', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE relation_proposal
         SET state = 'accepted', actor_row_id = 1, reason_code = 'approved',
             decided_sequence = 1, decided_at = '2026-07-22T00:00:01.000000Z'
         WHERE row_id = 1",
    )
    .execute(db.pool())
    .await
    .expect("pending proposals may transition once to a decided state");
    assert!(sqlx::query("UPDATE relation_proposal SET reason_code = 'rewritten' WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("INSERT INTO proposal_panel_revision_input VALUES (1, 999, 'source', 0)")
        .execute(db.pool())
        .await
        .is_err());

    sqlx::query(
        "INSERT INTO spec062_project (row_id, public_id, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000083',
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO project_membership_revision
         (row_id, public_id, project_row_id, revision_number, actor_row_id,
          created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000084', 1, 1, 1, 1,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO spec062_destination_root
         VALUES (1, '00000000-0000-7000-8000-000000000085', 1,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO materialization_update_plan
         (row_id, public_id, project_row_id, target_membership_revision_row_id,
          state, content_digest, session_count, item_count, source_frame_count,
          source_byte_count, remaining_session_count, actor_row_id, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000086', 1, 1, 'approved',
                 'plan', 1, 1, 1, 4096, 0, 1, 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // The journal fence must match the live command lease, not merely repeat
    // the ownership values stored in the install intent.
    sqlx::query(
        "UPDATE command_execution
         SET state = 'executing', state_version = 1, lease_owner = 'worker-a',
             lease_generation = 7, lease_expires_at = '2026-07-22T00:05:00.000000Z',
             heartbeat_at = '2026-07-22T00:00:00.000000Z', finished_at = NULL
         WHERE row_id = 1",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO project_materialization_snapshot
         (row_id, public_id, project_row_id, membership_revision_row_id,
          applied_plan_row_id, entry_count, session_count, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000087', 1, 1, 1, 1, 1,
                 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO materialized_entry
         (row_id, public_id, project_row_id, first_snapshot_row_id,
          source_session_row_id, source_frame_row_id, destination_root_row_id,
          relative_path, content_fingerprint, created_by_plan_row_id,
          created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000088', 1, 1, 1, 1, 1,
                 'dark/frame.fit', 'sha256:abc', 1, 1,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO materialization_plan_entry
         (row_id, public_id, plan_row_id, session_row_id, frame_row_id,
          destination_root_row_id, relative_path, approved_fingerprint,
          collision_state, ordinal)
         VALUES (1, '00000000-0000-7000-8000-000000000089', 1, 1, 1, 1,
                 'dark/frame.fit', 'sha256:abc', 'clear', 0)",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO materialization_install_intent
         (plan_item_row_id, plan_row_id, collision_key, canonical_destination,
          approved_fingerprint, ownership_token, command_row_id, lease_owner,
          lease_generation, state, updated_at)
         VALUES (1, 1, 'root:dark/frame.fit:mismatch', '/project/dark/frame.fit.mismatch',
                 'sha256:abc', 'owner-token-mismatch', 1, 'worker-b', 7, 'prepared',
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .expect_err("install intent must match the live command lease owner");
    sqlx::query(
        "INSERT INTO materialization_install_intent
         (plan_item_row_id, plan_row_id, collision_key, canonical_destination,
          approved_fingerprint, ownership_token, command_row_id, lease_owner,
          lease_generation, state, updated_at)
         VALUES (1, 1, 'root:dark/frame.fit', '/project/dark/frame.fit',
                 'sha256:abc', 'owner-token', 1, 'worker-a', 7, 'installed',
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    assert!(sqlx::query(
        "INSERT INTO materialization_item_journal
         (plan_item_row_id, plan_row_id, operation_command_row_id,
          resulting_entry_row_id, destination_root_row_id, relative_path,
          content_fingerprint, lease_owner, lease_generation, completed_at)
         VALUES (1, 1, 1, 1, 1, 'dark/frame.fit', 'sha256:abc', 'worker-a', 8,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());
    sqlx::query(
        "INSERT INTO materialization_item_journal
         (plan_item_row_id, plan_row_id, operation_command_row_id,
          resulting_entry_row_id, destination_root_row_id, relative_path,
          content_fingerprint, lease_owner, lease_generation, completed_at)
         VALUES (1, 1, 1, 1, 1, 'dark/frame.fit', 'sha256:abc', 'worker-a', 7,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    assert!(sqlx::query(
        "INSERT INTO materialization_item_journal
         (plan_item_row_id, plan_row_id, operation_command_row_id,
          resulting_entry_row_id, destination_root_row_id, relative_path,
          content_fingerprint, lease_owner, lease_generation, completed_at)
         VALUES (1, 1, 1, 1, 1, 'dark/frame.fit', 'sha256:abc', 'worker-a', 7,
                 '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());

    sqlx::query(
        "INSERT INTO outbox_event
         (row_id, public_id, command_row_id, event_ordinal, session_row_id, event_type,
          payload_json, created_sequence, occurred_at)
         VALUES (1, '00000000-0000-7000-8000-000000000081', 1, 0, 1,
                 'session.created', '{}', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    assert!(sqlx::query(
        "INSERT INTO outbox_event
         (row_id, public_id, command_row_id, event_ordinal, session_row_id, event_type,
          payload_json, created_sequence, occurred_at)
         VALUES (2, '00000000-0000-7000-8000-000000000082', 1, 0, 1,
                 'session.created', '{}', 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query("UPDATE outbox_event SET event_type = 'tampered' WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
    assert!(sqlx::query("DELETE FROM outbox_event WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());
}

#[tokio::test]
async fn accepted_snapshots_and_visibility_records_reject_update_and_delete() {
    let (_dir, db) = fresh_database().await;
    seed_session(db.pool()).await;

    sqlx::query(
        "INSERT INTO session_materialization_result_snapshot
         (row_id, public_id, operation_row_id, session_count, membership_count,
          singleton_group_count, blocked_frame_count, canonical_digest, created_sequence, created_at)
         VALUES (1, '00000000-0000-7000-8000-000000000090', 1, 0, 0, 0, 0,
                 'snapshot', 1, '2026-07-22T00:00:00.000000Z')",
    ).execute(db.pool()).await.unwrap();
    assert!(sqlx::query("UPDATE session_materialization_result_snapshot SET canonical_digest = 'changed' WHERE row_id = 1")
        .execute(db.pool()).await.is_err());
    assert!(sqlx::query("DELETE FROM session_materialization_result_snapshot WHERE row_id = 1")
        .execute(db.pool())
        .await
        .is_err());

    sqlx::query("INSERT INTO session_visibility_history VALUES (1, 1, NULL, 'created')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO repository_change(command_row_id, created_at) VALUES (1, '2026-07-22T00:00:02.000000Z')")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query(
        "UPDATE session_visibility_history SET hidden_sequence = 2
         WHERE session_row_id = 1 AND visible_sequence = 1",
    )
    .execute(db.pool())
    .await
    .expect("the one documented visibility closure transition is allowed");
    let visible_at_one: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM session_visibility_history
         WHERE session_row_id = 1 AND visible_sequence <= 1
           AND (hidden_sequence IS NULL OR hidden_sequence > 1)",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    let visible_at_two: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM session_visibility_history
         WHERE session_row_id = 1 AND visible_sequence <= 2
           AND (hidden_sequence IS NULL OR hidden_sequence > 2)",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(visible_at_one.0, 1);
    assert_eq!(visible_at_two.0, 0);
    assert!(sqlx::query(
        "UPDATE session_visibility_history SET reason_code = 'changed' WHERE session_row_id = 1"
    )
    .execute(db.pool())
    .await
    .is_err());
    assert!(sqlx::query("DELETE FROM session_visibility_history WHERE session_row_id = 1")
        .execute(db.pool())
        .await
        .is_err());

    assert!(sqlx::query(
        "INSERT INTO frame_metadata_evidence
         (row_id, public_id, frame_row_id, revision_number, detected_kind, offset_state,
          binning_state, readout_state, footprint_wkb, footprint_digest,
          bbox_min_x_ppb, bbox_max_x_ppb, bbox_min_y_ppb, bbox_max_y_ppb,
          bbox_min_z_ppb, bbox_max_z_ppb, actor_row_id, command_row_id,
          created_sequence, recorded_at)
         VALUES (2, '00000000-0000-7000-8000-000000000091', 1, 2, 'dark',
                 'absent', 'absent', 'absent', X'01', 'outside', -1000000001,
                 1000000000, -1, 1, -1, 1, 1, 1, 1, '2026-07-22T00:00:00.000000Z')",
    )
    .execute(db.pool())
    .await
    .is_err());
}
