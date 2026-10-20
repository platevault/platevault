// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 greenfield schema (astro-plan-sb7v7; D-W94 to D-W116): a fresh
//! catalog records the new schema version and holds the Project, group,
//! membership, calibration-pin, snapshot, View, Apply, Output and operation
//! tables, and their constraints hold against real `SQLite`:
//! - duplicate guards: a session, a capture and a copy once per Project, a
//!   group name once, an Output path and a master digest once;
//! - one active operation per Project, and none on a Closed one;
//! - the admission rule: only a current, Ready, calibration-settled session
//!   on the group's rig joins, at its current basis, through the contract
//!   function and in SQL;
//! - Closed for good: no reopen, Close after its snapshot and Wrap up only,
//!   and a locked Project's inputs refuse every edit;
//! - the View and Apply journal: one building, installed and previous View,
//!   entries fixed once built, phases forward only, reviewed leftovers first;
//! - rig versions immutable and never rebound.
#![cfg(unix)]

#[path = "support/project_state.rs"]
mod project_state_support;
mod support;

use std::path::Path;

use persistence_library::Catalog;
use platevault_model::{
    counts_as_confirmed, AdmissionBasis, AdmissionBlocker, ApplyPhase, AssociationState,
    EvidenceItem, ExpectedAsset, InputKind, PinState, ProjectLifecycle, ProjectOperationKind,
    Quality, SessionReadiness,
};
use project_state_support::{ha_frames, world, World};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{expected, kind, DiskProbe};
use uuid::Uuid;

const AT: &str = "2026-10-16T08:00:00Z";
const SHA: &str = "a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";
const OPTICS: &str = r#"{"cameraId":null,"focalLengthMm":"250","reducer":null}"#;

const F4_TABLES: [&str; 22] = [
    "apply_foreign_items",
    "apply_operations",
    "cameras",
    "processing_master_offers",
    "project_capture_copies",
    "project_captures",
    "project_entry_names",
    "project_groups",
    "project_operations",
    "project_outputs",
    "project_sessions",
    "project_snapshots",
    "project_wrap_up_steps",
    "rig_versions",
    "session_calibration",
    "session_calibration_kinds",
    "session_cameras",
    "session_reviews",
    "session_rig_versions",
    "view_manifest_entries",
    "view_manifests",
    "view_previous_items",
];

async fn raw(db: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await.unwrap()
}

/// Run `sql` with text binds; the database's refusal message on failure.
async fn run(conn: &mut SqliteConnection, sql: &'static str, binds: &[&str]) -> Result<(), String> {
    let mut query = sqlx::query(sql);
    for bind in binds {
        query = query.bind(*bind);
    }
    query.execute(&mut *conn).await.map(|_| ()).map_err(|error| error.to_string())
}

async fn ok(conn: &mut SqliteConnection, sql: &'static str, binds: &[&str]) {
    if let Err(error) = run(conn, sql, binds).await {
        panic!("{sql}: {error}");
    }
}

async fn refused(conn: &mut SqliteConnection, sql: &'static str, binds: &[&str], reason: &str) {
    match run(conn, sql, binds).await {
        Ok(()) => panic!("accepted: {sql} {binds:?}"),
        Err(error) => assert!(error.contains(reason), "{sql}: {error} (expected {reason})"),
    }
}

/// The F4 state of one Project on the world's one session.
struct F4 {
    world: World,
    conn: SqliteConnection,
    project: String,
    group: String,
    session: String,
    rig: String,
}

impl F4 {
    async fn new() -> Self {
        let world = world().await;
        let goals = vec![ha_frames(world.ngc.candidate.id, 10)];
        let project = world.project("NGC 7000", goals).await.id.to_string();
        let session = world.session().await.id.to_string();
        let rig = world.redcat.id.to_string();
        let mut conn = raw(&world.fx.db).await;
        let group = Uuid::new_v4().to_string();
        add_group(&mut conn, &project, &group, &rig, "RedCat", 0).await;
        Self { world, conn, project, group, session, rig }
    }

    /// Every frame Usable, the review finished at the session's revision and
    /// every calibration kind declined: the session can join.
    async fn admissible(&mut self) {
        let detail = self.world.catalog.session(self.session.parse().unwrap()).await.unwrap();
        let assets: Vec<ExpectedAsset> = detail.assets.iter().map(expected).collect();
        self.world.catalog.set_quality(&assets, Quality::Usable, DiskProbe).await.unwrap();
        self.finish_review().await;
        self.settle().await;
    }

    async fn finish_review(&mut self) {
        ok(
            &mut self.conn,
            "INSERT INTO session_reviews (session_id, grouping_revision, finished_at) \
             SELECT id, grouping_revision, ?2 FROM sessions WHERE id = ?1",
            &[&self.session, AT],
        )
        .await;
    }

    async fn settle(&mut self) {
        // Ingestion recorded the light session's calibration (CAL); the test
        // settles it by hand.
        ok(
            &mut self.conn,
            "INSERT INTO session_calibration (session_id, generation, matching_pending, updated_at) \
             VALUES (?1, 1, 0, ?2) ON CONFLICT (session_id) DO UPDATE SET matching_pending = 0",
            &[&self.session, AT],
        )
        .await;
        ok(
            &mut self.conn,
            "UPDATE session_calibration_kinds SET state = 'declined', \
             pin = '{\"state\":\"declined\",\"origin\":\"user\"}' WHERE session_id = ?1",
            &[&self.session],
        )
        .await;
    }

    async fn add_session(&mut self) -> Result<(), String> {
        run(
            &mut self.conn,
            "INSERT INTO project_sessions (project_id, session_id, group_id, placement, \
             target_id, grouping_revision, calibration_generation, added_at) \
             SELECT ?1, s.id, ?3, 'framing', (SELECT target_id FROM associations \
             WHERE session_id = s.id AND kind = 'target'), s.grouping_revision, \
             coalesce(c.generation, 1), ?4 FROM sessions s \
             LEFT JOIN session_calibration c ON c.session_id = s.id WHERE s.id = ?2",
            &[&self.project, &self.session, &self.group, AT],
        )
        .await
    }

    async fn reserve(&mut self, kind: &str) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        run(
            &mut self.conn,
            "INSERT INTO project_operations (id, project_id, kind, state, reserved_at) \
             VALUES (?1, ?2, ?3, 'active', ?4)",
            &[&id, &self.project, kind, AT],
        )
        .await
        .map(|()| id)
    }

    async fn settle_operation(&mut self, id: &str) {
        ok(
            &mut self.conn,
            "UPDATE project_operations SET state = 'settled', settled_at = ?2 WHERE id = ?1",
            &[id, AT],
        )
        .await;
    }

    async fn close(&mut self, lifecycle: &str) -> Result<(), String> {
        run(
            &mut self.conn,
            "UPDATE projects SET lifecycle = ?2, closed_at = ?3 WHERE id = ?1",
            &[&self.project, lifecycle, AT],
        )
        .await
    }

    async fn snapshot(&mut self) {
        ok(
            &mut self.conn,
            "INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) \
             VALUES (?1, NULL, json_object('projectId', ?1, 'appliedGeneration', NULL), ?2)",
            &[&self.project, AT],
        )
        .await;
    }

    async fn wrap_up(&mut self, step: &str, outcome: &str) -> Result<(), String> {
        run(
            &mut self.conn,
            "INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) \
             VALUES (?1, ?2, ?3, ?4)",
            &[&self.project, step, outcome, AT],
        )
        .await
    }

    /// A building manifest of generation `n` for the active Apply `operation`.
    async fn building(&mut self, operation: &str, n: &str, mode: &str) -> Result<(), String> {
        run(
            &mut self.conn,
            "INSERT INTO view_manifests (project_id, generation, state, operation_id, \
             desired_revision, mode, basis, created_at) \
             VALUES (?1, CAST(?2 AS INTEGER), 'building', ?3, 1, ?4, json_object('mode', ?4), ?5)",
            &[&self.project, n, operation, mode, AT],
        )
        .await
    }

    async fn manifest_state(&mut self, n: &str, state: &str) -> Result<(), String> {
        run(
            &mut self.conn,
            "UPDATE view_manifests SET state = ?3, installed_at = CASE WHEN ?3 IN \
             ('installed', 'previous', 'retired') THEN coalesce(installed_at, ?4) END \
             WHERE project_id = ?1 AND generation = CAST(?2 AS INTEGER)",
            &[&self.project, n, state, AT],
        )
        .await
    }

    async fn entry(&mut self, n: &str, seq: &str, placement: &str) -> Result<(), String> {
        let asset = self.first_asset().await;
        run(
            &mut self.conn,
            "INSERT INTO view_manifest_entries (project_id, generation, seq, path_key, input, \
             placement, capture_key, asset_id, source_sha256, entry) \
             VALUES (?1, CAST(?2 AS INTEGER), CAST(?3 AS INTEGER), CAST(?3 AS BLOB), 'light', ?4, \
             ?5, ?5, ?6, json_object('seq', CAST(?3 AS INTEGER), \
             'sourceSha256', ?6, 'placement', json_object('kind', ?4)))",
            &[&self.project, n, seq, placement, &asset, SHA],
        )
        .await
    }

    /// A copy entry carrying a header patch (PREP-FR-03).
    async fn patched_entry(&mut self, n: &str, seq: &str) -> Result<(), String> {
        let asset = self.first_asset().await;
        run(
            &mut self.conn,
            "INSERT INTO view_manifest_entries (project_id, generation, seq, path_key, input, \
             placement, capture_key, asset_id, source_sha256, entry) \
             VALUES (?1, CAST(?2 AS INTEGER), CAST(?3 AS INTEGER), CAST(?3 AS BLOB), 'light', \
             'copy', ?4, ?4, ?5, json_object('seq', CAST(?3 AS INTEGER), \
             'sourceSha256', ?5, 'placement', json_object('kind', 'copy'), \
             'headerPatch', json_array(json_object('field', 'object'))))",
            &[&self.project, n, seq, &asset, SHA],
        )
        .await
    }

    async fn first_asset(&mut self) -> String {
        sqlx::query_scalar(
            "SELECT asset_id FROM session_members WHERE session_id = ?1 ORDER BY asset_id",
        )
        .bind(&self.session)
        .fetch_one(&mut self.conn)
        .await
        .unwrap()
    }
}

async fn add_group(
    conn: &mut SqliteConnection,
    project: &str,
    group: &str,
    rig: &str,
    name: &str,
    panel: i64,
) {
    let key = name.to_lowercase();
    let panel = panel.to_string();
    ok(
        conn,
        "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
         optics, framing, position, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, CAST(?6 AS INTEGER), 'framing', ?7, NULL, 0, ?8)",
        &[group, project, rig, name, &key, &panel, OPTICS, AT],
    )
    .await;
}

// ── Greenfield schema ────────────────────────────────────────────────────────

/// D-W115: a fresh catalog installs the F4 schema at its own version. There
/// is no migration: an earlier catalog is refused before any DDL (catalog.rs
/// `schema_version_mismatch_is_refused`).
#[tokio::test]
async fn a_fresh_catalog_records_the_f4_schema_version_and_tables() {
    let fx = support::Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    let mut conn = raw(&fx.db).await;
    let version: i64 =
        sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
            .fetch_one(&mut conn)
            .await
            .unwrap();
    assert_eq!(version, 19);
    assert_eq!(persistence_library::SCHEMA_VERSION, 19);
    let tables: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    for table in F4_TABLES {
        assert!(tables.iter().any(|name| name == table), "{table} missing from {tables:?}");
    }
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('projects')")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    for column in ["lifecycle", "closed_at", "view_mode", "group_keyword", "panel_keyword"] {
        assert!(columns.iter().any(|name| name == column), "projects.{column}");
    }
}

// ── Admission ────────────────────────────────────────────────────────────────

/// PRJ-FR-08/09, LIB-FR-20/23, D-W105: the contract function names every
/// blocker, and only a Ready, settled session on the group's rig is admitted,
/// at its current basis.
#[tokio::test]
async fn the_admission_contract_reports_readiness_calibration_and_basis() {
    let mut f4 = F4::new().await;
    let session: Uuid = f4.session.parse().unwrap();
    let project: Uuid = f4.project.parse().unwrap();
    let group: Uuid = f4.group.parse().unwrap();
    let catalog = &f4.world.catalog;

    let admission = catalog.session_admission(session).await.unwrap();
    assert_eq!(admission.intake.readiness(), SessionReadiness::NeedsReview);
    assert_eq!(admission.intake.unreviewed_frames, 2);
    assert_eq!(admission.calibration.generation, 1, "ingestion recorded it, every kind unresolved");
    assert_eq!(
        admission.blockers,
        [
            AdmissionBlocker::NotReady { readiness: SessionReadiness::NeedsReview },
            AdmissionBlocker::CalibrationUnsettled {
                kinds: vec![InputKind::Bias, InputKind::Dark, InputKind::Flat]
            },
        ]
    );
    let error = catalog.check_admission(project, group, session, None).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");

    f4.admissible().await;
    let catalog = &f4.world.catalog;
    let admission = catalog.session_admission(session).await.unwrap();
    assert_eq!(admission.blockers, Vec::<AdmissionBlocker>::new());
    assert!(matches!(admission.calibration.bias, PinState::Declined { .. }));
    let basis = catalog.check_admission(project, group, session, None).await.unwrap();
    assert_eq!(
        basis.calibration_generation, 5,
        "the pending flag and every kind change advanced the generation"
    );
    let same = catalog.check_admission(project, group, session, Some(&basis)).await.unwrap();
    assert_eq!(same, basis);
    let stale = AdmissionBasis { calibration_generation: 1, ..basis };
    let error = catalog.check_admission(project, group, session, Some(&stale)).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");

    let other = Uuid::new_v4().to_string();
    let mut rig = f4.world.redcat.clone();
    rig.id = Uuid::new_v4();
    rig.name = "Other".into();
    let rig = f4.world.catalog.save_equipment(&rig, None).await.unwrap();
    add_group(&mut f4.conn, &f4.project, &other, &rig.id.to_string(), "Other", 0).await;
    let error = f4
        .world
        .catalog
        .check_admission(project, other.parse().unwrap(), session, None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("rig"), "{error}");
}

/// The same rule in SQL: each refusal while one condition is missing, then
/// the admitted row, once.
#[tokio::test]
async fn sql_admits_only_ready_settled_sessions_at_their_current_basis_once() {
    let mut f4 = F4::new().await;
    let detail = f4.world.catalog.session(f4.session.parse().unwrap()).await.unwrap();
    let assets: Vec<ExpectedAsset> = detail.assets.iter().map(expected).collect();
    f4.world.catalog.set_quality(&assets, Quality::Usable, DiskProbe).await.unwrap();
    f4.settle().await;
    let error = f4.add_session().await.unwrap_err();
    assert!(error.contains("only a Ready session"), "{error}");
    f4.finish_review().await;
    ok(
        &mut f4.conn,
        "UPDATE session_calibration_kinds SET state = 'unresolved', pin = '{\"state\":\"unresolved\"}' \
         WHERE session_id = ?1 AND kind = 'flat'",
        &[&f4.session],
    )
    .await;
    let error = f4.add_session().await.unwrap_err();
    assert!(error.contains("settled calibration"), "{error}");
    ok(
        &mut f4.conn,
        "UPDATE session_calibration_kinds SET state = 'declined', \
         pin = '{\"state\":\"declined\",\"origin\":\"user\"}' WHERE session_id = ?1 AND kind = 'flat'",
        &[&f4.session],
    )
    .await;
    refused(
        &mut f4.conn,
        "INSERT INTO project_sessions (project_id, session_id, group_id, placement, target_id, \
         grouping_revision, calibration_generation, added_at) \
         SELECT ?1, s.id, ?3, 'framing', (SELECT target_id FROM associations \
         WHERE session_id = s.id AND kind = 'target'), s.grouping_revision, 1, ?4 \
         FROM sessions s WHERE s.id = ?2",
        &[&f4.project, &f4.session, &f4.group, AT],
        "admission basis is stale",
    )
    .await;
    f4.add_session().await.unwrap();
    let error = f4.add_session().await.unwrap_err();
    assert!(error.contains("UNIQUE"), "a session joins a Project once: {error}");
}

/// D-W124, LIB-FR-05, LIB-FR-20: a Target associated by agreeing evidence
/// counts as confirmed. Every evidence combination gets one answer from the
/// Rust rule, from the admission contract's readiness and from the SQL
/// trigger that restates the rule: confirmed; Suggested with an agreeing
/// alias, qualified geometry and no conflict; and each condition missing.
#[tokio::test]
async fn an_associated_target_counts_as_confirmed_alike_in_rust_and_sql() {
    let mut f4 = F4::new().await;
    f4.admissible().await;
    let session: Uuid = f4.session.parse().unwrap();
    let alias = EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true };
    let other_alias = EvidenceItem::Alias { normalized: "ic 5070".into(), agrees: false };
    let pointing = EvidenceItem::Coordinates { ra_deg: 314.7, dec_deg: 44.3, qualified: true };
    let wide = EvidenceItem::Coordinates { ra_deg: 300.0, dec_deg: 10.0, qualified: false };
    let footprint = EvidenceItem::Footprint { overlap: 1.0, qualified: true };
    let conflict =
        EvidenceItem::Conflict { field: "object".into(), values: vec!["NGC 7000".into()] };
    let cases = [
        ("confirmed", AssociationState::Confirmed, vec![], true),
        ("agreeing", AssociationState::Suggested, vec![alias.clone(), pointing.clone()], true),
        ("by footprint", AssociationState::Suggested, vec![alias.clone(), footprint], true),
        ("no alias", AssociationState::Suggested, vec![pointing.clone()], false),
        ("other alias", AssociationState::Suggested, vec![other_alias, pointing.clone()], false),
        ("no geometry", AssociationState::Suggested, vec![alias.clone()], false),
        ("unqualified", AssociationState::Suggested, vec![alias.clone(), wide], false),
        (
            "conflict",
            AssociationState::Suggested,
            vec![alias.clone(), pointing.clone(), conflict],
            false,
        ),
        (
            "needs review",
            AssociationState::NeedsReview,
            vec![alias.clone(), pointing.clone()],
            false,
        ),
        ("unresolved", AssociationState::Unresolved, vec![alias, pointing], false),
    ];
    for (case, state, evidence, counts) in cases {
        assert_eq!(counts_as_confirmed(&state, &evidence), counts, "{case}: the Rust rule");
        let state_text = serde_json::to_value(&state).unwrap();
        let evidence_text = serde_json::to_string(&evidence).unwrap();
        ok(
            &mut f4.conn,
            "UPDATE associations SET state = ?2, evidence = ?3 \
             WHERE session_id = ?1 AND kind = 'target'",
            &[&f4.session, state_text.as_str().unwrap(), &evidence_text],
        )
        .await;
        let readiness =
            f4.world.catalog.session_admission(session).await.unwrap().intake.readiness();
        let expected = if counts { SessionReadiness::Ready } else { SessionReadiness::NeedsTarget };
        assert_eq!(readiness, expected, "{case}: the admission contract");
        let added = f4.add_session().await;
        if counts {
            assert_eq!(added, Ok(()), "{case}: the trigger admits it");
            ok(
                &mut f4.conn,
                "DELETE FROM project_sessions WHERE project_id = ?1 AND session_id = ?2",
                &[&f4.project, &f4.session],
            )
            .await;
        } else {
            let error = added.unwrap_err();
            assert!(error.contains("only a Ready session"), "{case}: the trigger refuses: {error}");
        }
    }
}

// ── Duplicate guards ─────────────────────────────────────────────────────────

/// One allocation per capture and copy per Project, one name per group.
#[tokio::test]
async fn captures_copies_and_group_names_are_held_once_per_project() {
    let mut f4 = F4::new().await;
    f4.admissible().await;
    f4.add_session().await.unwrap();
    let asset = f4.first_asset().await;
    let insert_capture = "INSERT INTO project_captures (project_id, capture_key, session_id, \
         inclusion, basis, quality_when_added, updated_at) \
         VALUES (?1, ?2, ?3, 'included', 'usable', '\"usable\"', ?4)";
    ok(&mut f4.conn, insert_capture, &[&f4.project, &asset, &f4.session, AT]).await;
    refused(&mut f4.conn, insert_capture, &[&f4.project, &asset, &f4.session, AT], "UNIQUE").await;
    let insert_copy = "INSERT INTO project_capture_copies (project_id, capture_key, asset_id, \
         decision_revision, fingerprint) VALUES (?1, ?2, ?3, 1, '{}')";
    ok(&mut f4.conn, insert_copy, &[&f4.project, &asset, &asset]).await;
    refused(&mut f4.conn, insert_copy, &[&f4.project, &asset, &asset], "UNIQUE").await;
    refused(
        &mut f4.conn,
        "INSERT INTO project_captures (project_id, capture_key, session_id, inclusion, basis, \
         quality_when_added, updated_at) VALUES (?1, ?2, ?3, 'included', 'user', '\"usable\"', ?4)",
        &[&f4.project, &Uuid::new_v4().to_string(), &f4.session, AT],
        "CHECK",
    )
    .await;
    refused(
        &mut f4.conn,
        "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
         optics, position, created_at) VALUES (?1, ?2, ?3, 'Redcat', 'redcat', 0, 'user', ?4, 1, ?5)",
        &[&Uuid::new_v4().to_string(), &f4.project, &f4.rig, OPTICS, AT],
        "UNIQUE",
    )
    .await;
    // Removing the session from the Project takes its captures with it.
    ok(
        &mut f4.conn,
        "DELETE FROM project_sessions WHERE project_id = ?1 AND session_id = ?2",
        &[&f4.project, &f4.session],
    )
    .await;
    let held: i64 = sqlx::query_scalar("SELECT count(*) FROM project_capture_copies")
        .fetch_one(&mut f4.conn)
        .await
        .unwrap();
    assert_eq!(held, 0);
}

// ── Operations ───────────────────────────────────────────────────────────────

/// PREP-FR-19: one `PlateVault` operation per Project at a time; a Closing
/// Project only runs its archive transfer, a Closed one none.
#[tokio::test]
async fn one_active_operation_per_project_and_none_once_closed() {
    let mut f4 = F4::new().await;
    for kind in [
        ProjectOperationKind::Apply,
        ProjectOperationKind::CopyToOutput,
        ProjectOperationKind::CleanUp,
        ProjectOperationKind::Trash,
        ProjectOperationKind::Archive,
    ] {
        let name = serde_json::to_value(kind).unwrap().as_str().unwrap().to_owned();
        let id = f4.reserve(&name).await.unwrap();
        let error = f4.reserve("copy_to_output").await.unwrap_err();
        assert!(error.contains("UNIQUE"), "{error}");
        f4.settle_operation(&id).await;
    }
    let id = f4.reserve("apply").await.unwrap();
    f4.settle_operation(&id).await;
    refused(
        &mut f4.conn,
        "UPDATE project_operations SET state = 'active', settled_at = NULL WHERE id = ?1",
        &[&id],
        "settles once",
    )
    .await;

    for step in ["clean_up", "trash"] {
        f4.wrap_up(step, "skipped").await.unwrap();
    }
    f4.wrap_up("archive", "finished").await.unwrap();
    let error = f4.close("closing").await.unwrap_err();
    assert!(error.contains("snapshot"), "Close records its snapshot first: {error}");
    f4.snapshot().await;
    f4.close("closing").await.unwrap();
    let error = f4.reserve("apply").await.unwrap_err();
    assert!(error.contains("Closed Project takes no operation"), "{error}");
    let archive = f4.reserve("archive").await.unwrap();
    f4.settle_operation(&archive).await;
    f4.close("archived").await.unwrap();
    let error = f4.reserve("archive").await.unwrap_err();
    assert!(error.contains("Closed Project takes no operation"), "{error}");
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/// PRJ-FR-14/25, D-W97: Close records its snapshot after every Wrap up step,
/// the closing states only move forward, and a locked Project refuses edits.
/// Whether a Closed Project may reopen is the model's provisional
/// `ClosePolicy` alone (decision record section 2), which refuses it today.
#[tokio::test]
async fn close_needs_its_snapshot_and_wrap_up_and_a_closed_project_is_locked() {
    let mut f4 = F4::new().await;
    f4.admissible().await;
    f4.add_session().await.unwrap();
    let error = f4.wrap_up("trash", "skipped").await.unwrap_err();
    assert!(error.contains("Wrap up runs Clean up, Trash, then Archive"), "{error}");
    f4.wrap_up("clean_up", "finished").await.unwrap();
    f4.wrap_up("trash", "skipped").await.unwrap();
    f4.snapshot().await;
    let error = f4.close("closed").await.unwrap_err();
    assert!(error.contains("after every Wrap up step"), "{error}");
    f4.wrap_up("archive", "skipped").await.unwrap();
    let error = f4.close("closing").await.unwrap_err();
    assert!(error.contains("archive transfer"), "Closing runs an archive: {error}");
    f4.close("closed").await.unwrap();

    let error = f4.close("closing").await.unwrap_err();
    assert!(error.contains("closes forward"), "{error}");
    assert!(!ProjectLifecycle::Closed.can_become(ProjectLifecycle::Open), "no Reopen today");
    refused(
        &mut f4.conn,
        "UPDATE projects SET name = 'Renamed' WHERE id = ?1",
        &[&f4.project],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "DELETE FROM project_sessions WHERE project_id = ?1",
        &[&f4.project],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE project_groups SET name = 'Renamed', name_key = 'renamed' WHERE project_id = ?1",
        &[&f4.project],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "DELETE FROM project_goals WHERE project_id = ?1",
        &[&f4.project],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "INSERT INTO project_hidden_goals (id, project_id, target_id, kind, channel, \
         goal_frames, position) \
         VALUES ('hidden', ?1, ?2, 'frame_count', 'Ha', 10, 0)",
        &[&f4.project, &f4.world.ngc.candidate.id.to_string()],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "DELETE FROM project_wrap_up_steps WHERE project_id = ?1 AND step = 'archive'",
        &[&f4.project],
        "Closed Project is locked",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE project_snapshots SET taken_at = 'later' WHERE project_id = ?1",
        &[&f4.project],
        "snapshot is immutable",
    )
    .await;
    let lifecycle: String = sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
        .bind(&f4.project)
        .fetch_one(&mut f4.conn)
        .await
        .unwrap();
    let parsed: ProjectLifecycle = serde_json::from_value(lifecycle.into()).unwrap();
    assert_eq!(parsed, ProjectLifecycle::Closed);
}

// ── View and Apply ───────────────────────────────────────────────────────────

/// PREP-FR-06/09, STO-FR-10, D-W81, D-W100, D-W110: one building, installed
/// and previous View per Project; entries are fixed once installed; links
/// only in Symlinks mode and never a hard link, so each Copies entry is its
/// own file; the journal moves forward; unreviewed leftovers hold the next
/// Apply.
#[tokio::test]
async fn manifests_entries_and_the_apply_journal_hold_their_invariants() {
    let mut f4 = F4::new().await;
    let apply = f4.reserve("apply").await.unwrap();
    f4.building(&apply, "1", "copies").await.unwrap();
    let error = f4.building(&apply, "2", "copies").await.unwrap_err();
    assert!(error.contains("UNIQUE"), "one building View: {error}");
    f4.entry("1", "0", "copy").await.unwrap();
    f4.entry("1", "1", "clone").await.unwrap();
    let error = f4.entry("1", "2", "symlink").await.unwrap_err();
    assert!(error.contains("Symlinks mode"), "{error}");
    let error = f4.entry("1", "3", "hardlink").await.unwrap_err();
    assert!(error.contains("placement IN ('symlink', 'copy', 'clone')"), "{error}");
    let linking: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM pragma_table_info('view_manifest_entries') \
         WHERE name = 'linked_seq') + (SELECT count(*) FROM sqlite_master \
         WHERE type = 'trigger' AND sql LIKE '%hard link%')",
    )
    .fetch_one(&mut f4.conn)
    .await
    .unwrap();
    assert_eq!(linking, 0, "no column or trigger places a hard link");

    let insert_journal = "INSERT INTO apply_operations (operation_id, project_id, generation, \
         phase, expected, updated_at) VALUES (?1, ?2, 1, 'reserved', '{}', ?3)";
    ok(&mut f4.conn, insert_journal, &[&apply, &f4.project, AT]).await;
    for phase in ApplyPhase::ORDER.iter().skip(1).take(7) {
        let name = serde_json::to_value(phase).unwrap().as_str().unwrap().to_owned();
        ok(
            &mut f4.conn,
            "UPDATE apply_operations SET phase = ?2 WHERE operation_id = ?1",
            &[&apply, &name],
        )
        .await;
    }
    refused(
        &mut f4.conn,
        "UPDATE apply_operations SET phase = 'building' WHERE operation_id = ?1",
        &[&apply],
        "moves forward",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE project_operations SET state = 'settled', settled_at = ?2 WHERE id = ?1",
        &[&apply, AT],
        "settles its journal first",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE apply_operations SET phase = 'settled', outcome = 'canceled', \
         settled_from = phase WHERE operation_id = ?1",
        &[&apply],
        "CHECK",
    )
    .await;
    f4.manifest_state("1", "installed").await.unwrap();
    let error = f4.entry("1", "4", "copy").await.unwrap_err();
    assert!(error.contains("fixed once built"), "{error}");
    ok(
        &mut f4.conn,
        "UPDATE apply_operations SET phase = 'settled', outcome = 'applied', \
         settled_from = phase WHERE operation_id = ?1",
        &[&apply],
    )
    .await;
    f4.settle_operation(&apply).await;

    ok(
        &mut f4.conn,
        "INSERT INTO view_previous_items (project_id, path_key, reason, evidence, review, \
         operation_id, recorded_at) VALUES (?1, X'01', 'unticked_file', '{}', 'pending', ?2, ?3)",
        &[&f4.project, &apply, AT],
    )
    .await;
    let error = f4.reserve("apply").await.unwrap_err();
    assert!(error.contains("View (previous)/"), "{error}");
    let other = f4.reserve("copy_to_output").await.unwrap();
    f4.settle_operation(&other).await;
    ok(
        &mut f4.conn,
        "UPDATE view_previous_items SET review = 'kept', reviewed_at = ?2 WHERE project_id = ?1",
        &[&f4.project, AT],
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE view_previous_items SET review = 'pending', reviewed_at = NULL WHERE project_id = ?1",
        &[&f4.project],
        "not asked about again",
    )
    .await;
    let second = f4.reserve("apply").await.unwrap();
    let error = f4.building(&second, "1", "symlinks").await.unwrap_err();
    assert!(error.contains("generation"), "generations only grow: {error}");
    f4.building(&second, "2", "symlinks").await.unwrap();
    f4.manifest_state("1", "previous").await.unwrap();
    f4.manifest_state("2", "installed").await.unwrap();
    let error = f4.manifest_state("1", "installed").await.unwrap_err();
    assert!(error.contains("View state"), "{error}");
}

/// PREP-FR-03/04: a Symlinks View places links and, for a corrected frame,
/// its isolated patched copy, never a plain copy or a clone.
#[tokio::test]
async fn a_symlinks_view_holds_links_and_patched_copies_only() {
    let mut f4 = F4::new().await;
    let apply = f4.reserve("apply").await.unwrap();
    f4.building(&apply, "1", "symlinks").await.unwrap();
    f4.entry("1", "0", "symlink").await.unwrap();
    let error = f4.entry("1", "1", "copy").await.unwrap_err();
    assert!(error.contains("patched copies"), "a plain copy in Symlinks mode: {error}");
    let error = f4.entry("1", "2", "clone").await.unwrap_err();
    assert!(error.contains("patched copies"), "a clone in Symlinks mode: {error}");
    f4.patched_entry("1", "3").await.unwrap();
}

/// PREP-FR-19, D-W114: an entry's name is fixed for life.
#[tokio::test]
async fn entry_names_are_reserved_for_life() {
    let mut f4 = F4::new().await;
    let insert = "INSERT INTO project_entry_names (project_id, input, input_id, basename, \
         reserved_at) VALUES (?1, 'capture', ?2, ?3, ?4)";
    let input = Uuid::new_v4().to_string();
    ok(&mut f4.conn, insert, &[&f4.project, &input, "Ha_001.fits", AT]).await;
    refused(&mut f4.conn, insert, &[&f4.project, &input, "Ha_001-2.fits", AT], "UNIQUE").await;
    refused(&mut f4.conn, insert, &[&f4.project, &Uuid::new_v4().to_string(), "a/b", AT], "CHECK")
        .await;
    refused(
        &mut f4.conn,
        "UPDATE project_entry_names SET basename = 'other.fits' WHERE project_id = ?1",
        &[&f4.project],
        "fixed for life",
    )
    .await;
    refused(
        &mut f4.conn,
        "DELETE FROM project_entry_names WHERE project_id = ?1",
        &[&f4.project],
        "fixed for life",
    )
    .await;
}

// ── Calibration pins ─────────────────────────────────────────────────────────

/// LIB-FR-23, D-W105, D-W113: a calibration record holds every kind, a pin
/// names its input in columns and JSON alike, and every kind change advances
/// the generation a CAS compares.
#[tokio::test]
async fn a_calibration_record_holds_every_kind_and_pins_agree_with_their_columns() {
    let mut f4 = F4::new().await;
    // Ingestion recorded the light session with matching pending (CAL).
    let recorded: (i64, i64) = sqlx::query_as(
        "SELECT generation, matching_pending FROM session_calibration WHERE session_id = ?1",
    )
    .bind(&f4.session)
    .fetch_one(&mut f4.conn)
    .await
    .unwrap();
    assert_eq!(recorded, (1, 1));
    let kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM session_calibration_kinds WHERE session_id = ?1 AND state = 'unresolved' \
         ORDER BY kind",
    )
    .bind(&f4.session)
    .fetch_all(&mut f4.conn)
    .await
    .unwrap();
    assert_eq!(kinds, ["bias", "dark", "flat"]);
    refused(
        &mut f4.conn,
        "DELETE FROM session_calibration_kinds WHERE session_id = ?1 AND kind = 'dark'",
        &[&f4.session],
        "every calibration kind",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE session_calibration_kinds SET state = 'pinned', \
         pin = '{\"state\":\"pinned\"}' WHERE session_id = ?1 AND kind = 'dark'",
        &[&f4.session],
        "CHECK",
    )
    .await;
    let raw = Uuid::new_v4().to_string();
    refused(
        &mut f4.conn,
        "UPDATE session_calibration_kinds SET state = 'pinned', input_session_id = ?2, \
         input_revision = 3, pin = json_object('state', 'pinned', 'target', json_object('input', \
         json_object('form', 'raw_set', 'sessionId', ?3, 'groupingRevision', 3))) \
         WHERE session_id = ?1 AND kind = 'flat'",
        &[&f4.session, &f4.session, &raw],
        "CHECK",
    )
    .await;
    ok(
        &mut f4.conn,
        "UPDATE session_calibration SET matching_pending = 0 WHERE session_id = ?1",
        &[&f4.session],
    )
    .await;
    ok(
        &mut f4.conn,
        "UPDATE session_calibration_kinds SET state = 'declined', \
         pin = '{\"state\":\"declined\",\"origin\":\"camera_default\"}' \
         WHERE session_id = ?1 AND kind = 'bias'",
        &[&f4.session],
    )
    .await;
    let generation: i64 =
        sqlx::query_scalar("SELECT generation FROM session_calibration WHERE session_id = ?1")
            .bind(&f4.session)
            .fetch_one(&mut f4.conn)
            .await
            .unwrap();
    assert_eq!(generation, 3, "the pending flag and the kind change each advanced it");
    let admission = f4.world.catalog.session_admission(f4.session.parse().unwrap()).await.unwrap();
    assert_eq!(admission.calibration.generation, 3);
    assert!(matches!(admission.calibration.bias, PinState::Declined { .. }));
    assert_eq!(admission.calibration.unsettled_kinds(), [InputKind::Dark, InputKind::Flat]);
}

// ── Rig versions ─────────────────────────────────────────────────────────────

/// LIB-FR-26, D-W104: rig versions are immutable and dated; a session keeps
/// the version of its confirmed rig it was captured with.
#[tokio::test]
async fn rig_versions_are_immutable_and_a_session_keeps_its_version() {
    let mut f4 = F4::new().await;
    let insert = "INSERT INTO rig_versions (id, equipment_id, valid_from, camera_id, optics, \
         rotator, created_at) VALUES (?1, ?2, ?3, NULL, ?4, 'absent', ?5)";
    let first = Uuid::new_v4().to_string();
    let second = Uuid::new_v4().to_string();
    ok(&mut f4.conn, insert, &[&first, &f4.rig, "2026-01-01", OPTICS, AT]).await;
    ok(&mut f4.conn, insert, &[&second, &f4.rig, "2026-06-01", OPTICS, AT]).await;
    refused(
        &mut f4.conn,
        insert,
        &[&Uuid::new_v4().to_string(), &f4.rig, "2026-06-01", OPTICS, AT],
        "UNIQUE",
    )
    .await;
    refused(
        &mut f4.conn,
        insert,
        &[&Uuid::new_v4().to_string(), &f4.rig, "June", OPTICS, AT],
        "CHECK",
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE rig_versions SET rotator = 'present' WHERE id = ?1",
        &[&first],
        "rig version is immutable",
    )
    .await;
    ok(
        &mut f4.conn,
        "INSERT INTO session_rig_versions (session_id, rig_version_id, recorded_at) VALUES (?1, ?2, ?3)",
        &[&f4.session, &first, AT],
    )
    .await;
    refused(
        &mut f4.conn,
        "UPDATE session_rig_versions SET rig_version_id = ?2 WHERE session_id = ?1",
        &[&f4.session, &second],
        "keeps the rig version it was captured with",
    )
    .await;
    let camera = Uuid::new_v4().to_string();
    let insert_camera = "INSERT INTO cameras (id, model, model_key, alias, alias_key, no_darks, \
         no_bias, revision, updated_at) VALUES (?1, 'ASI2600MM', 'asi2600mm', ?2, ?3, 0, 1, 1, ?4)";
    ok(&mut f4.conn, insert_camera, &[&camera, "Mono A", "mono a", AT]).await;
    refused(
        &mut f4.conn,
        insert_camera,
        &[&Uuid::new_v4().to_string(), "MONO A", "mono a", AT],
        "UNIQUE",
    )
    .await;
}

// ── Output ───────────────────────────────────────────────────────────────────

/// RES-FR-01/02/08/11: an Output path once per Project, a panel only of a
/// panel group, Copy to Output with its digest, a master digest offered once.
#[tokio::test]
async fn output_paths_panels_and_master_offers_hold_once() {
    let mut f4 = F4::new().await;
    let panel = Uuid::new_v4().to_string();
    add_group(&mut f4.conn, &f4.project, &panel, &f4.rig, "Panel 1", 1).await;
    let insert = "INSERT INTO project_outputs (project_id, path_key, observation, state, origin, \
         panel_group_id, sha256, first_seen_at, last_observed_at) \
         VALUES (?1, CAST(?2 AS BLOB), json_object('state', 'settled', 'origin', ?3, \
         'panelGroupId', nullif(?4, ''), 'sha256', nullif(?5, '')), 'settled', ?3, \
         nullif(?4, ''), nullif(?5, ''), ?6, ?6)";
    ok(&mut f4.conn, insert, &[&f4.project, "Panels/Panel-1/a.xisf", "observed", &panel, "", AT])
        .await;
    refused(
        &mut f4.conn,
        insert,
        &[&f4.project, "Panels/Panel-1/a.xisf", "observed", &panel, "", AT],
        "UNIQUE",
    )
    .await;
    let error = run(&mut f4.conn, insert, &[&f4.project, "b.xisf", "observed", &f4.group, "", AT])
        .await
        .unwrap_err();
    assert!(error.contains("panel group"), "{error}");
    refused(&mut f4.conn, insert, &[&f4.project, "c.xisf", "copied", "", "", AT], "CHECK").await;
    ok(&mut f4.conn, insert, &[&f4.project, "c.xisf", "copied", "", SHA, AT]).await;

    let offer = "INSERT INTO processing_master_offers (id, project_id, path_key, sha256, kind, \
         offer, state, offered_at) VALUES (?1, ?2, CAST(?3 AS BLOB), ?4, 'flat', '{}', 'offered', ?5)";
    ok(&mut f4.conn, offer, &[&Uuid::new_v4().to_string(), &f4.project, "WBPP/a.xisf", SHA, AT])
        .await;
    refused(
        &mut f4.conn,
        offer,
        &[&Uuid::new_v4().to_string(), &f4.project, "WBPP/b.xisf", SHA, AT],
        "UNIQUE",
    )
    .await;
}
