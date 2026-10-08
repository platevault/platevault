// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing runs in the clean catalog (spec 066, amended D-W1..D-W74): a run
//! lives in one Project on one subject and one rig, fixed at creation; it
//! starts with every available candidate of the subject on its rig selected;
//! a Complete run refuses membership changes; a Review step reject leaves the
//! draft and un-rejecting restores it; Project members are the union of each
//! run's latest revision; a subject or rig any run uses is never removed.
//! Fixture files are real and only read.
#![cfg(unix)]

mod support;

use persistence_library::{Catalog, SessionQuery, SourceProbe};
use platevault_model::{
    Asset, AssociationState, CalibrationPolicy, DraftEdit, Equipment, LibraryError, MemberReason,
    MemberState, Membership, NewView, Project, ProjectInput, Provenance, Quality, RefreshItem,
    RefreshItemKind, RefreshReview, RefreshState, RejectScope, RejectionMark, ReviewMark, ScanFile,
    ScanObservation, ScanProgress, ScanState, SelectionReason, Session, SessionChoiceState,
    SubjectInput, TargetRecord, ViewCriteria, ViewRecord,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

const RC_HA_1: &str = "redcat/Ha_001.fits";
const RC_HA_2: &str = "redcat/Ha_002.fits";
const RC_OIII: &str = "redcat/OIII_001.fits";
const ES_HA: &str = "esprit/Ha_001.fits";
const RC_L: &str = "redcat/L_001.fits";
const RC_SII: &str = "redcat/SII_001.fits";

/// `(path, filter, camera)`: each filter/camera pair is one session.
const FRAMES: [(&str, &str, &str); 6] = [
    (RC_HA_1, "Ha", "ASI2600MM"),
    (RC_HA_2, "Ha", "ASI2600MM"),
    (RC_OIII, "OIII", "ASI2600MM"),
    (ES_HA, "Ha", "ASI533MC"),
    (RC_L, "L", "ASI2600MM"),
    (RC_SII, "SII", "ASI2600MM"),
];

struct World {
    fx: Fixture,
    catalog: Catalog,
    location: Uuid,
    ngc7000: TargetRecord,
    m81: TargetRecord,
    redcat: Equipment,
    esprit: Equipment,
}

fn rig(name: &str, camera: &str) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some(camera.into()),
        telescope: Some(name.into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

impl World {
    async fn asset(&self, path: &str) -> Asset {
        by_name(&self.catalog.location_assets(self.location).await.unwrap(), path).clone()
    }

    async fn session(&self, path: &str) -> Session {
        let asset = self.asset(path).await.id;
        let summaries = self.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    async fn confirm(&self, path: &str, target: Option<Uuid>, rig: Option<Uuid>) {
        let session = self.session(path).await;
        if let Some(target) = target {
            self.catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
        }
        if let Some(rig) = rig {
            let session = self.session(path).await;
            self.catalog.confirm_equipment(&[expected_session(&session)], rig).await.unwrap();
        }
    }

    async fn project(&self, rigs: &[Uuid], subjects: &[&TargetRecord]) -> Project {
        let input = ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            subjects: subjects
                .iter()
                .map(|target| SubjectInput {
                    target_id: target.candidate.id,
                    name: None,
                    mosaic: false,
                    panels: Vec::new(),
                })
                .collect(),
            rig_ids: rigs.to_vec(),
            goals: Vec::new(),
        };
        self.catalog.create_project(&input).await.unwrap()
    }

    async fn run(&self, project: &Project, rig: Uuid, name: &str) -> ViewRecord {
        let input = NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: rig,
            name: name.into(),
        };
        self.catalog.create_view(&input).await.unwrap()
    }
}

fn scan_file(fx: &Fixture, (path, filter, camera): (&str, &str, &str)) -> ScanFile {
    let mut file = fx.scan_file(path);
    file.metadata.filter = Some(filter.into());
    file.metadata.camera = Some(camera.into());
    file
}

/// Six real frames in five sessions; NGC 7000 is confirmed on the `RedCat` Ha
/// and OIII sessions and the `Esprit` Ha session, M 81 on `RedCat` L, and the
/// `RedCat` SII session has no Target.
async fn world() -> World {
    let fx = Fixture::new();
    for (path, ..) in FRAMES {
        fx.write(path, path.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let files: Vec<ScanFile> = FRAMES.iter().map(|frame| scan_file(&fx, *frame)).collect();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let count = files.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch = platevault_model::ScanBatch {
        files: files.clone(),
        issues: Vec::new(),
        progress: progress.clone(),
    };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        progress,
        state: ScanState::Completed,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    let ngc7000 = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let m81 = catalog.save_target(&target("M 81", "m 81"), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig("RedCat 51", "ASI2600MM"), None).await.unwrap();
    let esprit = catalog.save_equipment(&rig("Esprit 100", "ASI533MC"), None).await.unwrap();
    let world = World { fx, catalog, location: location.id, ngc7000, m81, redcat, esprit };
    let ngc = world.ngc7000.candidate.id;
    world.confirm(RC_HA_1, Some(ngc), Some(world.redcat.id)).await;
    world.confirm(RC_OIII, Some(ngc), Some(world.redcat.id)).await;
    world.confirm(ES_HA, Some(ngc), Some(world.esprit.id)).await;
    world.confirm(RC_L, Some(world.m81.candidate.id), Some(world.redcat.id)).await;
    world.confirm(RC_SII, None, Some(world.redcat.id)).await;
    world
}

fn selected(record_choices: &[platevault_model::SessionChoice]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = record_choices
        .iter()
        .filter(|choice| choice.state == SessionChoiceState::Selected)
        .map(|choice| choice.session_id)
        .collect();
    ids.sort_unstable();
    ids
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort_unstable();
    ids
}

async fn draft_choices(catalog: &Catalog, id: Uuid) -> Vec<platevault_model::SessionChoice> {
    let basis = catalog.view_membership(id, Membership::Draft).await.unwrap();
    basis.sessions.into_iter().map(|basis| basis.choice).collect()
}

fn refused(error: &LibraryError, needle: &str) {
    assert_eq!(kind(error), "invalid_input", "{error}");
    assert!(error.to_string().contains(needle), "{error} should name {needle}");
}

#[tokio::test]
async fn run_requires_project_subject_and_rig_fixed_after_create() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let other = world.project(&[world.esprit.id], &[&world.m81]).await;
    let run = world.run(&project, world.redcat.id, "HOO").await;
    assert_eq!(
        (run.view.project_id, run.view.subject_id, run.view.rig_id),
        (project.id, project.subjects[0].id, world.redcat.id)
    );
    let off_project_rig = NewView {
        project_id: project.id,
        subject_id: project.subjects[0].id,
        rig_id: world.esprit.id,
        name: "Esprit".into(),
    };
    refused(
        &world.catalog.create_view(&off_project_rig).await.unwrap_err(),
        "not one of the Project's rigs",
    );
    let foreign_subject = NewView { subject_id: other.subjects[0].id, ..off_project_rig };
    let error = world.catalog.create_view(&foreign_subject).await.unwrap_err();
    assert_eq!(kind(&error), "not_found", "{error}");
    let id = run.view.id;
    for statement in [
        format!("UPDATE views SET rig_id = '{}' WHERE id = '{id}'", world.esprit.id),
        format!("UPDATE views SET subject_id = '{}' WHERE id = '{id}'", other.subjects[0].id),
        format!("UPDATE views SET project_id = '{}' WHERE id = '{id}'", other.id),
    ] {
        let mut conn =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&world.fx.db))
                .await
                .unwrap();
        let error =
            sqlx::query(sqlx::AssertSqlSafe(statement)).execute(&mut conn).await.unwrap_err();
        assert!(error.to_string().contains("fixed"), "{error}");
        conn.close().await.unwrap();
    }
    assert_eq!(world.catalog.view(id).await.unwrap().view.rig_id, world.redcat.id);
}

#[tokio::test]
async fn picker_lists_only_subject_on_rig_all_preselected_with_reason() {
    let world = world().await;
    let project = world.project(&[world.redcat.id, world.esprit.id], &[&world.ngc7000]).await;
    let run = world.run(&project, world.redcat.id, "HOO").await;
    let ha = world.session(RC_HA_1).await.id;
    let oiii = world.session(RC_OIII).await.id;
    let basis = world.catalog.view_candidate_basis(run.view.id).await.unwrap();
    let listed: Vec<Uuid> = sorted(
        basis.sessions.iter().map(persistence_library::CandidateSession::session_id).collect(),
    );
    assert_eq!(listed, sorted(vec![ha, oiii]), "only NGC 7000 on RedCat");
    let choices = draft_choices(&world.catalog, run.view.id).await;
    assert_eq!(selected(&choices), sorted(vec![ha, oiii]), "every candidate starts selected");
    let reason = SelectionReason::Candidate {
        target_id: world.ngc7000.candidate.id,
        rig_id: world.redcat.id,
    };
    assert!(choices.iter().all(|choice| choice.reason == reason), "{choices:?}");
    let esprit = world.session(ES_HA).await;
    let edit = DraftEdit::SelectSessions { sessions: vec![expected_session(&esprit)] };
    let error = world.catalog.edit_view_draft(run.view.id, 1, &edit).await.unwrap_err();
    refused(&error, "not a candidate");
}

#[tokio::test]
async fn add_n_new_sessions_count() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let run = world.run(&project, world.redcat.id, "HOO").await;
    let id = run.view.id;
    world.catalog.save_view(id, 0, 1).await.unwrap();
    assert_eq!(world.catalog.view_new_candidate_count(id).await.unwrap(), 0);
    world.confirm(RC_SII, Some(world.ngc7000.candidate.id), None).await;
    assert_eq!(world.catalog.view_new_candidate_count(id).await.unwrap(), 1, "Add 1 new session");
    let committed = world.catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert_eq!(committed.sessions.len(), 2, "membership stays the same until accepted");
}

fn review(view: Uuid, base_revision: u64, items: Vec<RefreshItem>) -> RefreshReview {
    RefreshReview {
        id: Uuid::new_v4(),
        view_id: view,
        base_revision,
        criteria: ViewCriteria { target_id: Uuid::nil(), rig_id: Uuid::nil(), panel_id: None },
        items,
        state: RefreshState::Reviewed,
        created_at: String::new(),
        applied_at: None,
    }
}

fn session_item(kind: RefreshItemKind, session: &Session) -> RefreshItem {
    RefreshItem {
        id: Uuid::new_v4(),
        kind,
        session_id: session.id,
        session: Some(expected_session(session)),
        assessed: None,
        evidence: None,
        reason: None,
        member_keys: Vec::new(),
        successors: Vec::new(),
    }
}

#[tokio::test]
async fn complete_run_refuses_membership_change_until_reopen() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let id = world.run(&project, world.redcat.id, "HOO").await.view.id;
    world.catalog.save_view(id, 0, 1).await.unwrap();
    world.confirm(RC_SII, Some(world.ngc7000.candidate.id), None).await;
    world.catalog.complete_view(id, |_| async { Ok(Vec::new()) }).await.unwrap();
    assert_eq!(world.catalog.view_new_candidate_count(id).await.unwrap(), 1, "still offered");
    let rename = DraftEdit::Details { name: "HOO 2".into() };
    refused(&world.catalog.edit_view_draft(id, 0, &rename).await.unwrap_err(), "reopen");
    let sii = world.session(RC_SII).await;
    let error = world.catalog.record_refresh_review(&review(id, 1, Vec::new())).await.unwrap_err();
    refused(&error, "reopen");
    let committed = world.catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert_eq!(committed.sessions.len(), 2, "declining leaves the membership unchanged");
    world.catalog.reopen_view(id).await.unwrap();
    let mut item = session_item(RefreshItemKind::AddedSession, &sii);
    let assets = world.catalog.session(sii.id).await.unwrap().assets;
    item.assessed = Some(platevault_model::AssessedMembers {
        observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        observation_revisions: assets.iter().map(|a| (a.id, a.observation_revision)).collect(),
    });
    let item_id = item.id;
    let recorded = world.catalog.record_refresh_review(&review(id, 1, vec![item])).await.unwrap();
    world.catalog.apply_refresh(recorded.id, id, 1, 0, &[item_id], &[]).await.unwrap();
    let saved = world.catalog.save_view(id, 1, 1).await.unwrap();
    assert_eq!(saved.view.revision, 2, "after Reopen the accepted session saves a new revision");
    let revision = world.catalog.view_revision(id, 2).await.unwrap();
    assert!(selected(&revision.sessions).contains(&sii.id));
}

#[tokio::test]
async fn trashed_or_complete_run_refuses_discard() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    // Never saved: discarding its draft would delete the run itself.
    let trashed = world.run(&project, world.redcat.id, "HOO").await;
    let trashed_draft = trashed.draft.unwrap().draft_revision;
    let trashed = trashed.view.id;
    let complete = world.run(&project, world.redcat.id, "SHO").await.view.id;
    world.catalog.save_view(complete, 0, 1).await.unwrap();
    let rename = DraftEdit::Details { name: "SHO 2".into() };
    let edited = world.catalog.edit_view_draft(complete, 0, &rename).await.unwrap();
    let complete_draft = edited.draft.unwrap().draft_revision;
    world.catalog.trash_view(trashed, |_| async { Ok(Vec::new()) }).await.unwrap();
    world.catalog.complete_view(complete, |_| async { Ok(Vec::new()) }).await.unwrap();

    let error = world.catalog.discard_view_draft(trashed, trashed_draft).await.unwrap_err();
    refused(&error, "restore");
    let kept = world.catalog.view(trashed).await.unwrap();
    assert!(kept.draft.is_some(), "the run in the Trash keeps its draft");
    let error = world.catalog.discard_view_draft(complete, complete_draft).await.unwrap_err();
    refused(&error, "reopen");
    let kept = world.catalog.view(complete).await.unwrap();
    assert_eq!(kept.draft.map(|draft| draft.draft_revision), Some(complete_draft));
}

#[tokio::test]
async fn never_saved_run_with_calibration_policy_discards_without_orphans() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let run = world.run(&project, world.redcat.id, "HOO").await;
    let draft = run.draft.unwrap().draft_revision;
    let id = run.view.id;
    let plan =
        world.catalog.set_calibration_policy(id, 0, CalibrationPolicy::Manual).await.unwrap();
    assert_eq!(plan.revision, 1, "the policy write records the run's calibration plan");

    assert!(world.catalog.discard_view_draft(id, draft).await.unwrap().is_none());
    assert_eq!(kind(&world.catalog.view(id).await.unwrap_err()), "not_found");
    let mut conn =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&world.fx.db))
            .await
            .unwrap();
    for table in ["views", "view_revisions", "view_refresh_reviews", "calibration_plans"] {
        let column = if table == "views" { "id" } else { "view_id" };
        let statement = format!("SELECT COUNT(*) FROM {table} WHERE {column} = '{id}'");
        let (rows,): (i64,) =
            sqlx::query_as(sqlx::AssertSqlSafe(statement)).fetch_one(&mut conn).await.unwrap();
        assert_eq!(rows, 0, "{table} keeps no row of the discarded run");
    }
    let (decisions,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM calibration_decisions")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(decisions, 0);
    conn.close().await.unwrap();
}

#[tokio::test]
async fn member_no_longer_matching_subject_flagged_and_still_member() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let id = world.run(&project, world.redcat.id, "HOO").await.view.id;
    world.catalog.save_view(id, 0, 1).await.unwrap();
    world.confirm(RC_OIII, Some(world.m81.candidate.id), None).await;
    let oiii = world.session(RC_OIII).await;
    let basis = world.catalog.view_candidate_basis(id).await.unwrap();
    assert!(basis.sessions.iter().all(|s| s.session_id() != oiii.id), "no longer a candidate");
    let members = world.catalog.project_members(project.id).await.unwrap();
    assert!(members.iter().any(|m| m.session_id == oiii.id), "still a member");
    let item = session_item(RefreshItemKind::NoLongerMatchesSubject, &oiii);
    let item_id = item.id;
    let recorded = world.catalog.record_refresh_review(&review(id, 1, vec![item])).await.unwrap();
    world.catalog.apply_refresh(recorded.id, id, 1, 0, &[item_id], &[]).await.unwrap();
    let draft = draft_choices(&world.catalog, id).await;
    assert!(!selected(&draft).contains(&oiii.id), "leaves only when the removal is accepted");
    let committed = world.catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert!(committed.sessions.iter().any(|s| s.choice.session_id == oiii.id));
}

async fn mark(
    catalog: &Catalog,
    id: Uuid,
    draft: u64,
    mark: &ReviewMark,
) -> platevault_model::ReviewMarkOutcome {
    catalog.view_review_mark(id, draft, mark, DiskProbe).await.unwrap()
}

#[tokio::test]
async fn review_reject_removes_from_draft_with_reason_rejected_and_unreject_restores() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let id = world.run(&project, world.redcat.id, "HOO").await.view.id;
    world.catalog.save_view(id, 0, 1).await.unwrap();
    let ha = world.asset(RC_HA_1).await;
    let x = ReviewMark::Library { asset: expected(&ha), quality: Quality::Unusable };
    let outcome = mark(&world.catalog, id, 0, &x).await;
    assert_eq!(outcome.member.state, MemberState::Excluded);
    assert_eq!(outcome.member.reason, MemberReason::Rejected { scope: RejectScope::Library });
    let oiii = world.asset(RC_OIII).await;
    let reject = ReviewMark::Project {
        mark: RejectionMark {
            asset_id: oiii.id,
            fingerprint: oiii.fingerprint.clone(),
            expected_revision: 0,
            rejected: true,
        },
    };
    let outcome = mark(&world.catalog, id, 1, &reject).await;
    assert_eq!(outcome.member.reason, MemberReason::Rejected { scope: RejectScope::Project });
    let draft = world.catalog.view_membership(id, Membership::Draft).await.unwrap();
    let included = draft.members.iter().filter(|m| m.member.state == MemberState::Included).count();
    assert_eq!(included, 1, "the draft holds only RC_HA_2");
    let ha = world.asset(RC_HA_1).await;
    let u = ReviewMark::Library { asset: expected(&ha), quality: Quality::Unreviewed };
    let outcome = mark(&world.catalog, id, 2, &u).await;
    assert_eq!(
        (outcome.member.state, outcome.member.reason),
        (MemberState::Included, MemberReason::Restored)
    );
    let clear = ReviewMark::Project {
        mark: RejectionMark {
            asset_id: oiii.id,
            fingerprint: oiii.fingerprint.clone(),
            expected_revision: 1,
            rejected: false,
        },
    };
    let outcome = mark(&world.catalog, id, 3, &clear).await;
    assert_eq!(outcome.member.state, MemberState::Included, "withdrawing restores it");
}

#[tokio::test]
async fn saved_and_prepared_revisions_unchanged_by_reject() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let id = world.run(&project, world.redcat.id, "HOO").await.view.id;
    world.catalog.save_view(id, 0, 1).await.unwrap();
    let json = |value: &platevault_model::ViewRevision| serde_json::to_value(value).unwrap();
    let before = json(&world.catalog.view_revision(id, 1).await.unwrap());
    let ha = world.asset(RC_HA_1).await;
    let x = ReviewMark::Library { asset: expected(&ha), quality: Quality::Unusable };
    let outcome = mark(&world.catalog, id, 0, &x).await;
    assert_eq!(outcome.record.view.revision, 1, "no new revision until Save");
    assert_eq!(json(&world.catalog.view_revision(id, 1).await.unwrap()), before);
    let committed = world.catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert!(committed.members.iter().all(|m| m.member.state == MemberState::Included));
}

#[tokio::test]
async fn removing_rig_used_by_run_refused_naming_run() {
    let world = world().await;
    let project =
        world.project(&[world.redcat.id, world.esprit.id], &[&world.ngc7000, &world.m81]).await;
    let complete = world.run(&project, world.redcat.id, "Ha-only").await.view.id;
    world.run(&project, world.redcat.id, "HOO").await;
    world.catalog.complete_view(complete, |_| async { Ok(Vec::new()) }).await.unwrap();
    let project = world
        .catalog
        .set_project_rigs(project.id, project.revision, &[world.redcat.id])
        .await
        .unwrap();
    let only_ngc = vec![SubjectInput {
        target_id: world.ngc7000.candidate.id,
        name: None,
        mosaic: false,
        panels: Vec::new(),
    }];
    let project =
        world.catalog.set_project_subjects(project.id, project.revision, &only_ngc).await.unwrap();
    let error = world
        .catalog
        .set_project_rigs(project.id, project.revision, &[world.esprit.id])
        .await
        .unwrap_err();
    for needle in ["rig RedCat 51", "'Ha-only'", "'HOO'"] {
        refused(&error, needle);
    }
    let m81 = vec![SubjectInput { target_id: world.m81.candidate.id, ..only_ngc[0].clone() }];
    let error =
        world.catalog.set_project_subjects(project.id, project.revision, &m81).await.unwrap_err();
    for needle in ["subject NGC 7000", "'Ha-only'", "'HOO'"] {
        refused(&error, needle);
    }
    assert_eq!(world.catalog.project(project.id).await.unwrap().revision, project.revision);
}

#[tokio::test]
async fn project_members_union_of_latest_revisions() {
    let world = world().await;
    let project = world.project(&[world.redcat.id], &[&world.ngc7000]).await;
    let ha = world.session(RC_HA_1).await.id;
    let oiii = world.session(RC_OIII).await.id;
    let sii = world.session(RC_SII).await.id;
    let ha_only = world.run(&project, world.redcat.id, "Ha-only").await.view.id;
    let hoo = world.run(&project, world.redcat.id, "HOO").await.view.id;
    let drop_oiii = DraftEdit::DeselectSessions { session_ids: vec![oiii] };
    world.catalog.edit_view_draft(ha_only, 1, &drop_oiii).await.unwrap();
    world.catalog.save_view(ha_only, 0, 2).await.unwrap();
    world.catalog.save_view(hoo, 0, 1).await.unwrap();
    let drop_ha = DraftEdit::DeselectSessions { session_ids: vec![ha] };
    world.catalog.edit_view_draft(ha_only, 0, &drop_ha).await.unwrap();
    world.catalog.save_view(ha_only, 1, 1).await.unwrap();
    let members = world.catalog.project_members(project.id).await.unwrap();
    let held = |session: Uuid| {
        members.iter().find(|m| m.session_id == session).map(|m| m.view_ids.clone())
    };
    assert_eq!(held(ha), Some(vec![hoo]), "S1 stays a member through HOO");
    assert_eq!(held(oiii), Some(vec![hoo]));
    assert_eq!(held(sii), None, "a non-candidate is no member");
    let first = world.catalog.view_revision(ha_only, 1).await.unwrap();
    assert_eq!(selected(&first.sessions), vec![ha], "the earlier revision still shows S1");
}
