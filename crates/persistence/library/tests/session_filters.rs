// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Sessions filters "Needs a Target" and "Not in any Project" with their
//! counts, Create Project prefill and Add to Project (LIB-FR-17, LIB-AC-18,
//! PRJ-FR-19, PRJ-AC-20, D-W59). The filters derive from current associations,
//! Project subjects and rigs, and run memberships, and assign nothing to a run.
//! Fixture files are real and only read.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use persistence_library::{
    Catalog, SessionFilter, SessionQuery, SourceProbe, SuggestedAssociation,
};
use platevault_model::{
    AssociationKind, AssociationState, Equipment, EvidenceItem, Location, Membership, NewView,
    Project, ProjectInput, ProjectQuery, Provenance, ScanFile, ScanObservation, ScanProgress,
    ScanState, Session, SessionFilterCounts, SubjectInput, TargetRecord,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

/// One real frame and its headers; each filter/camera pair is one session.
struct Frame {
    path: &'static str,
    filter: &'static str,
    camera: &'static str,
}

const RC_HA: &str = "redcat/Ha_001.fits";
const ES_HA: &str = "esprit/Ha_001.fits";
const RC_OIII: &str = "redcat/OIII_001.fits";
const RC_L: &str = "redcat/L_001.fits";
const RC_SII: &str = "redcat/SII_001.fits";
const RC_HB: &str = "redcat/Hb_001.fits";
const RC_R: &str = "redcat/R_001.fits";
const RC_G: &str = "redcat/G_001.fits";

const FRAMES: [Frame; 8] = [
    Frame { path: RC_HA, filter: "Ha", camera: "ASI2600MM" },
    Frame { path: ES_HA, filter: "Ha", camera: "ASI533MC" },
    Frame { path: RC_OIII, filter: "OIII", camera: "ASI2600MM" },
    Frame { path: RC_L, filter: "L", camera: "ASI2600MM" },
    Frame { path: RC_SII, filter: "SII", camera: "ASI2600MM" },
    Frame { path: RC_HB, filter: "Hb", camera: "ASI2600MM" },
    Frame { path: RC_R, filter: "R", camera: "ASI2600MM" },
    Frame { path: RC_G, filter: "G", camera: "ASI2600MM" },
];

/// Every run table, in creation order.
const RUN_TABLES: [&str; 6] = [
    "views",
    "view_refresh_reviews",
    "view_revisions",
    "view_session_choices",
    "view_members",
    "view_member_copies",
];

struct World {
    fx: Fixture,
    catalog: Catalog,
    location: Location,
    ngc7000: TargetRecord,
    m81: TargetRecord,
    redcat: Equipment,
    esprit: Equipment,
}

impl World {
    async fn session(&self, path: &str) -> Session {
        let assets = self.catalog.location_assets(self.location.id).await.unwrap();
        let asset = by_name(&assets, path).id;
        let summaries = self.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    async fn id(&self, path: &str) -> Uuid {
        self.session(path).await.id
    }

    async fn listed(&self, filter: SessionFilter) -> BTreeSet<Uuid> {
        let query = SessionQuery { filter: Some(filter), ..SessionQuery::default() };
        let listed = self.catalog.list_sessions(&query).await.unwrap();
        listed.into_iter().map(|summary| summary.session.id).collect()
    }

    async fn ids(&self, paths: &[&str]) -> BTreeSet<Uuid> {
        let mut ids = BTreeSet::new();
        for path in paths {
            ids.insert(self.id(path).await);
        }
        ids
    }

    async fn confirm(&self, path: &str, target: Option<Uuid>, rig: Option<Uuid>) {
        if let Some(target) = target {
            let session = self.session(path).await;
            self.catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
        }
        if let Some(rig) = rig {
            let session = self.session(path).await;
            self.catalog.confirm_equipment(&[expected_session(&session)], rig).await.unwrap();
        }
    }

    /// An automatic Target row in `state` naming no Target.
    async fn suggest(&self, path: &str, state: AssociationState) {
        let session = self.session(path).await;
        let assets = self.catalog.session(session.id).await.unwrap().assets;
        let suggestion = SuggestedAssociation {
            session_id: session.id,
            grouping_revision: session.grouping_revision,
            kind: AssociationKind::Target,
            subject_id: None,
            state,
            evidence: vec![EvidenceItem::Unknown { field: "object".into() }],
            provenance: Provenance::Inferred { rule: "object-header".into() },
            expected_observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
            expected_decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
            expected_observation_revisions: assets
                .iter()
                .map(|a| (a.id, a.observation_revision))
                .collect(),
        };
        self.catalog.record_suggestions(&[suggestion]).await.unwrap();
    }

    async fn project(&self, name: &str, targets: &[&TargetRecord], rigs: &[Uuid]) -> Project {
        let input = ProjectInput {
            name: name.into(),
            notes: None,
            subjects: targets.iter().map(|target| subject(target)).collect(),
            rig_ids: rigs.to_vec(),
            goals: Vec::new(),
        };
        self.catalog.create_project(&input).await.unwrap()
    }

    /// A run on the Project's first subject and `rig`, saved as revision 1
    /// with every candidate selected.
    async fn saved_run(&self, project: &Project, rig: Uuid) -> Uuid {
        let input = NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: rig,
            name: "HOO".into(),
        };
        let id = self.catalog.create_view(&input).await.unwrap().view.id;
        self.catalog.save_view(id, 0, 1).await.unwrap();
        id
    }

    async fn counts(&self) -> SessionFilterCounts {
        self.catalog.session_filter_counts().await.unwrap()
    }
}

fn subject(target: &TargetRecord) -> SubjectInput {
    SubjectInput { target_id: target.candidate.id, name: None, mosaic: false, panels: Vec::new() }
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

fn scan_file(fx: &Fixture, frame: &Frame) -> ScanFile {
    let mut file = fx.scan_file(frame.path);
    file.metadata.filter = Some(frame.filter.into());
    file.metadata.camera = Some(frame.camera.into());
    file.metadata.object = None;
    file
}

async fn scan_frames(catalog: &Catalog, fx: &Fixture, location: &Location) {
    let files: Vec<ScanFile> = FRAMES.iter().map(|frame| scan_file(fx, frame)).collect();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(location).unwrap();
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
}

/// Eight sessions:
/// - `RedCat` Ha: NGC 7000 on `RedCat`.
/// - `Esprit` Ha: NGC 7000 on `Esprit`.
/// - `RedCat` L: M 81 on `RedCat`.
/// - `RedCat` SII: NGC 7000, no rig confirmed.
/// - `RedCat` OIII: Target only suggested; `RedCat` Hb: Needs review;
///   `RedCat` R: unresolved; `RedCat` G: no Target row at all. Each on `RedCat`.
async fn world() -> World {
    let fx = Fixture::new();
    for frame in &FRAMES {
        fx.write(frame.path, frame.path.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan_frames(&catalog, &fx, &location).await;
    let ngc7000 = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let m81 = catalog.save_target(&target("M 81", "m 81"), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig("RedCat 51", "ASI2600MM"), None).await.unwrap();
    let esprit = catalog.save_equipment(&rig("Esprit 100", "ASI533MC"), None).await.unwrap();
    let world = World { fx, catalog, location, ngc7000, m81, redcat, esprit };
    let ngc = world.ngc7000.candidate.id;
    world.confirm(RC_HA, Some(ngc), Some(world.redcat.id)).await;
    world.confirm(ES_HA, Some(ngc), Some(world.esprit.id)).await;
    world.confirm(RC_L, Some(world.m81.candidate.id), Some(world.redcat.id)).await;
    world.confirm(RC_SII, Some(ngc), None).await;
    for path in [RC_OIII, RC_HB, RC_R, RC_G] {
        world.confirm(path, None, Some(world.redcat.id)).await;
    }
    world.suggest(RC_OIII, AssociationState::Suggested).await;
    world.suggest(RC_HB, AssociationState::NeedsReview).await;
    world.suggest(RC_R, AssociationState::Unresolved).await;
    world
}

async fn raw(db: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await.unwrap()
}

/// Every row of `tables` in rowid order, each value quoted by SQLite.
async fn dump(db: &Path, tables: &[&str]) -> BTreeMap<String, Vec<String>> {
    let mut conn = raw(db).await;
    let mut rows = BTreeMap::new();
    for table in tables {
        let columns: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT name FROM pragma_table_info('{table}')"
        )))
        .fetch_all(&mut conn)
        .await
        .unwrap();
        let quoted =
            columns.iter().map(|column| format!("quote(\"{column}\")")).collect::<Vec<_>>();
        let values: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {} FROM {table} ORDER BY rowid",
            quoted.join(" || '|' || ")
        )))
        .fetch_all(&mut conn)
        .await
        .unwrap();
        rows.insert((*table).to_owned(), values);
    }
    conn.close().await.unwrap();
    rows
}

/// LIB-FR-17, LIB-AC-18, PRJ-FR-19: "Needs a Target" lists every session with
/// no confirmed Target, whatever its automatic row says (Suggested, Needs
/// review, Unresolved or none), and confirming a Target moves it out.
#[tokio::test]
async fn needs_target_lists_unconfirmed_incl_needs_review() {
    let world = world().await;
    let unconfirmed = world.ids(&[RC_OIII, RC_HB, RC_R, RC_G]).await;
    assert_eq!(world.listed(SessionFilter::NeedsTarget).await, unconfirmed);
    assert_eq!(world.counts().await.needs_target, 4);

    let hb = world.session(RC_HB).await;
    let state = world.catalog.session(hb.id).await.unwrap().associations;
    let target = state.iter().find(|a| a.kind == AssociationKind::Target).unwrap();
    assert_eq!(target.state, AssociationState::NeedsReview, "the fixture holds Needs review");

    world.confirm(RC_HB, Some(world.m81.candidate.id), None).await;
    let listed = world.listed(SessionFilter::NeedsTarget).await;
    assert_eq!(listed, world.ids(&[RC_OIII, RC_R, RC_G]).await, "confirming moves it out");
    assert_eq!(world.counts().await.needs_target, 3);
    world.catalog.close().await.unwrap();
}

/// LIB-FR-17, LIB-AC-18, PRJ-AC-20: "Not in any Project" lists confirmed-Target
/// sessions that are no Project's candidate and no run's member. A member stays
/// out after its rig changes and it stops being a candidate.
#[tokio::test]
async fn not_in_any_project_excludes_candidates_and_members() {
    let world = world().await;
    let confirmed = world.ids(&[RC_HA, ES_HA, RC_L, RC_SII]).await;
    assert_eq!(world.listed(SessionFilter::NotInAnyProject).await, confirmed);
    assert_eq!(
        world.counts().await,
        SessionFilterCounts { needs_target: 4, not_in_any_project: 4 },
        "the counts are the filters' list lengths"
    );

    // NGC 7000 on RedCat: only the RedCat Ha session is a candidate. The SII
    // session has the Target but no confirmed rig, so it stays out.
    let project = world.project("NGC 7000", &[&world.ngc7000], &[world.redcat.id]).await;
    let outside = world.ids(&[ES_HA, RC_L, RC_SII]).await;
    assert_eq!(world.listed(SessionFilter::NotInAnyProject).await, outside);
    assert_eq!(world.counts().await.not_in_any_project, 3);

    // The candidate becomes a run member, then its rig changes: no longer a
    // candidate (Esprit is not a Project rig), but a member, so still in.
    world.saved_run(&project, world.redcat.id).await;
    world.confirm(RC_HA, None, Some(world.esprit.id)).await;
    let ha = world.id(RC_HA).await;
    assert!(
        world.catalog.project_candidates(project.id).await.unwrap().is_empty(),
        "the member is no candidate on its new rig"
    );
    let members = world.catalog.project_members(project.id).await.unwrap();
    assert_eq!(members.iter().map(|m| m.session_id).collect::<Vec<_>>(), vec![ha]);
    assert_eq!(world.listed(SessionFilter::NotInAnyProject).await, outside, "members stay out");

    // A rig-matching Project of another Target makes nothing a candidate.
    world.project("M 81 on Esprit", &[&world.m81], &[world.esprit.id]).await;
    assert_eq!(world.listed(SessionFilter::NotInAnyProject).await, outside);
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-19, LIB-FR-17, D-W59: Add to Project adds the session's Target as a
/// subject and, when the Project lacks it, the session's rig. The preview names
/// the rig it adds before anything is saved; the write checks the Project and
/// session it was previewed against.
#[tokio::test]
async fn add_to_project_adds_subject_and_missing_rig_with_note() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = world.project("NGC 7000", &[&world.ngc7000], &[world.redcat.id]).await;

    // Esprit Ha: the Target is a subject, the rig is missing.
    let esprit_ha = world.session(ES_HA).await;
    let preview = catalog.preview_project_addition(esprit_ha.id, project.id).await.unwrap();
    assert_eq!(preview.project_revision, 1);
    assert_eq!(preview.target_id, world.ngc7000.candidate.id);
    assert!(!preview.adds_subject, "NGC 7000 is already a subject");
    let added = preview.added_rig.clone().expect("the Project lacks Esprit");
    assert_eq!((added.id, added.name.as_str()), (world.esprit.id, "Esprit 100"));
    let note = preview.note.clone().expect("adding a rig shows a note");
    assert!(note.contains("Esprit 100"), "{note}");
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "a preview saves nothing");

    let stale = catalog.add_session_to_project(&preview.session, project.id, 0).await;
    assert_eq!(kind(&stale.unwrap_err()), "conflict", "a stale Project revision is refused");
    let outcome = catalog.add_session_to_project(&preview.session, project.id, 1).await.unwrap();
    assert_eq!(outcome.project.revision, 2);
    assert_eq!(outcome.project.rig_ids, vec![world.redcat.id, world.esprit.id]);
    assert_eq!(outcome.addition.note, preview.note, "the saved note is the previewed one");
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.iter().any(|c| c.session_id == esprit_ha.id), "now a candidate");
    assert!(!world.listed(SessionFilter::NotInAnyProject).await.contains(&esprit_ha.id));

    // RedCat L: the rig is on the Project, the Target is not: no note.
    let l = world.session(RC_L).await;
    let preview = catalog.preview_project_addition(l.id, project.id).await.unwrap();
    assert!(preview.adds_subject);
    assert!(preview.added_rig.is_none() && preview.note.is_none(), "{preview:?}");
    let outcome = catalog.add_session_to_project(&preview.session, project.id, 2).await.unwrap();
    let targets: Vec<Uuid> = outcome.project.subjects.iter().map(|s| s.target_id).collect();
    assert_eq!(targets, vec![world.ngc7000.candidate.id, world.m81.candidate.id]);
    assert_eq!(outcome.project.rig_ids, vec![world.redcat.id, world.esprit.id]);

    // A Project lacking both gains both in one revision.
    let other = world.project("M 81", &[&world.m81], &[world.esprit.id]).await;
    let ha = world.session(RC_HA).await;
    let preview = catalog.preview_project_addition(ha.id, other.id).await.unwrap();
    assert!(preview.adds_subject);
    assert_eq!(preview.added_rig.as_ref().map(|r| r.id), Some(world.redcat.id));
    let outcome = catalog.add_session_to_project(&preview.session, other.id, 1).await.unwrap();
    assert_eq!(outcome.project.revision, 2);
    assert_eq!(outcome.project.rig_ids, vec![world.esprit.id, world.redcat.id]);
    assert_eq!(outcome.project.subjects.len(), 2);

    // A session whose association changed since its preview is refused.
    let sii = world.session(RC_SII).await;
    let preview = catalog.preview_project_addition(sii.id, other.id).await.unwrap();
    assert!(preview.added_rig.is_none(), "no confirmed rig, so none to add");
    world.confirm(RC_SII, None, Some(world.redcat.id)).await;
    let stale = catalog.add_session_to_project(&preview.session, other.id, 2).await;
    assert_eq!(kind(&stale.unwrap_err()), "conflict", "a changed session is refused");

    // No confirmed Target: nothing to add.
    let oiii = world.id(RC_OIII).await;
    let error = catalog.preview_project_addition(oiii, other.id).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    world.catalog.close().await.unwrap();
}

/// LIB-FR-17, PRJ-FR-19: Create Project from a "Not in any Project" row is
/// prefilled with the session's Target as its subject and its rig.
#[tokio::test]
async fn create_project_prefills_target_and_rig() {
    let world = world().await;
    let catalog = &world.catalog;
    let esprit_ha = world.id(ES_HA).await;
    let prefill = catalog.project_prefill(esprit_ha).await.unwrap();
    assert_eq!(prefill.name, "NGC 7000");
    assert_eq!(prefill.subjects.len(), 1);
    assert_eq!(prefill.subjects[0].target_id, world.ngc7000.candidate.id);
    assert!(!prefill.subjects[0].mosaic && prefill.subjects[0].panels.is_empty());
    assert_eq!(prefill.rig_ids, vec![world.esprit.id]);
    assert!(prefill.goals.is_empty());
    let saved = catalog.list_projects(&ProjectQuery::default()).await.unwrap();
    assert!(saved.is_empty(), "a prefill saves nothing");

    let project = catalog.create_project(&prefill).await.unwrap();
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(candidates.iter().map(|c| c.session_id).collect::<Vec<_>>(), vec![esprit_ha]);

    let sii = catalog.project_prefill(world.id(RC_SII).await).await.unwrap();
    assert!(sii.rig_ids.is_empty(), "no confirmed rig, so none prefilled");
    let error = catalog.project_prefill(world.id(RC_G).await).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "no confirmed Target: {error}");
    world.catalog.close().await.unwrap();
}

/// LIB-FR-17, LIB-AC-18: listing, counting, previewing and Add to Project write
/// no run row; a session Add to Project makes a candidate joins no run.
#[tokio::test]
async fn filters_assign_nothing_to_runs() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = world.project("NGC 7000", &[&world.ngc7000], &[world.redcat.id]).await;
    let run = world.saved_run(&project, world.redcat.id).await;
    let runs = dump(&world.fx.db, &RUN_TABLES).await;
    let membership = catalog.view_membership(run, Membership::Committed).await.unwrap();

    for filter in [SessionFilter::NeedsTarget, SessionFilter::NotInAnyProject] {
        world.listed(filter).await;
    }
    world.counts().await;
    let esprit_ha = world.id(ES_HA).await;
    catalog.project_prefill(esprit_ha).await.unwrap();
    let preview = catalog.preview_project_addition(esprit_ha, project.id).await.unwrap();
    catalog.add_session_to_project(&preview.session, project.id, 1).await.unwrap();
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.iter().any(|c| c.session_id == esprit_ha), "a candidate now");

    assert_eq!(dump(&world.fx.db, &RUN_TABLES).await, runs, "no run row changed");
    let after = catalog.view_membership(run, Membership::Committed).await.unwrap();
    let ids = |m: &persistence_library::MembershipBasis| {
        m.sessions.iter().map(|s| s.choice.session_id).collect::<Vec<_>>()
    };
    assert_eq!(ids(&after), ids(&membership), "the run's membership is unchanged");
    let members = catalog.project_members(project.id).await.unwrap();
    assert!(members.iter().all(|m| m.session_id != esprit_ha), "and it is no member");
    world.catalog.close().await.unwrap();
}
