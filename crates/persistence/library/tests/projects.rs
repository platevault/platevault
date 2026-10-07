// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects in the clean catalog (spec 065, amended D-W1..D-W74): subjects, rigs,
//! goals, goal templates, derived candidates and the Project-only reject. Every
//! Project write is checked against the Project revision and the records it
//! names, and changes no library row or source file; a Project-only reject
//! checks only its own asset's decision. Fixture files are real and only read.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use persistence_library::{Catalog, SessionQuery, SourceProbe, SuggestedAssociation};
use platevault_model::{
    Asset, AssociationKind, AssociationState, Availability, Equipment, EvidenceItem, GoalInput,
    GoalSpec, GoalTemplate, GoalTemplateInput, LibraryError, Location, PanelInput, Project,
    ProjectCandidate, ProjectInput, ProjectQuery, ProjectState, Provenance, Quality,
    QualityCriterion, RejectionMark, Revision, ScanFile, ScanObservation, ScanProgress, ScanState,
    Session, SubjectInput, TargetRecord,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

/// One real frame and the header values its scan records. The fixture groups
/// frames by filter and camera, so each filter/camera pair is one session.
struct Frame {
    path: &'static str,
    filter: &'static str,
    camera: &'static str,
    object: Option<&'static str>,
}

const RC_HA_1: &str = "redcat/Ha_001.fits";
const RC_HA_2: &str = "redcat/Ha_002.fits";
const ES_HA: &str = "esprit/Ha_001.fits";
const RC_OIII: &str = "redcat/OIII_001.fits";
const RC_L: &str = "redcat/L_001.fits";
const RC_SII: &str = "redcat/SII_001.fits";

/// Sessions: `RedCat` Ha (two frames, NGC 7000 on `RedCat`), `Esprit` Ha (NGC 7000
/// on `Esprit`), `RedCat` OIII (OBJECT NGC 7000, only suggested, on `RedCat`),
/// `RedCat` L (M 81 on `RedCat`) and `RedCat` SII (NGC 7000, no rig confirmed).
const FRAMES: [Frame; 6] = [
    Frame { path: RC_HA_1, filter: "Ha", camera: "ASI2600MM", object: None },
    Frame { path: RC_HA_2, filter: "Ha", camera: "ASI2600MM", object: None },
    Frame { path: ES_HA, filter: "Ha", camera: "ASI533MC", object: None },
    Frame { path: RC_OIII, filter: "OIII", camera: "ASI2600MM", object: Some("NGC 7000") },
    Frame { path: RC_L, filter: "L", camera: "ASI2600MM", object: None },
    Frame { path: RC_SII, filter: "SII", camera: "ASI2600MM", object: None },
];

/// Library rows no Project write may touch, membership included.
const LIBRARY_TABLES: [&str; 9] = [
    "assets",
    "quality_decisions",
    "sessions",
    "session_members",
    "session_lineage",
    "associations",
    "corrections",
    "targets",
    "equipment",
];

/// Project tables, children first.
const PROJECT_TABLES: [&str; 7] = [
    "project_rejections",
    "project_goals",
    "subject_panels",
    "project_subjects",
    "project_rigs",
    "goal_templates",
    "projects",
];

struct World {
    fx: Fixture,
    catalog: Catalog,
    location: Location,
    ngc7000: TargetRecord,
    m81: TargetRecord,
    redcat: Equipment,
    esprit: Equipment,
    before: BTreeMap<PathBuf, (u64, String)>,
}

impl World {
    async fn asset(&self, path: &str) -> Asset {
        by_name(&self.catalog.location_assets(self.location.id).await.unwrap(), path).clone()
    }

    async fn session(&self, path: &str) -> Session {
        let asset = self.asset(path).await.id;
        let summaries = self.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        summaries
            .into_iter()
            .map(|summary| summary.session)
            .find(|s| s.asset_ids.contains(&asset))
            .unwrap()
    }

    /// Store the model's Trashed encoding directly: no catalog write trashes a
    /// frame yet (STO owns that), exactly as the `live_assets` test does.
    async fn trash(mut self, paths: &[&str]) -> Self {
        let mut ids = Vec::new();
        for path in paths {
            ids.push(self.asset(path).await.id);
        }
        self.catalog.close().await.unwrap();
        let encoding = serde_json::to_value(Availability::Trashed).unwrap();
        let mut conn = raw(&self.fx.db).await;
        for id in ids {
            sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
                .bind(encoding.as_str().unwrap())
                .bind(id.to_string())
                .execute(&mut conn)
                .await
                .unwrap();
        }
        conn.close().await.unwrap();
        self.catalog = Catalog::open(&self.fx.db).await.unwrap();
        self
    }
}

fn rig(name: &str, camera: &str) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some(camera.into()),
        telescope: Some(name.into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn scan_file(fx: &Fixture, frame: &Frame) -> ScanFile {
    let mut file = fx.scan_file(frame.path);
    file.metadata.filter = Some(frame.filter.into());
    file.metadata.camera = Some(frame.camera.into());
    file.metadata.object = frame.object.map(Into::into);
    file
}

/// One completed scan of `files`, with the headers each frame names.
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

/// Six real frames in five sessions, two saved Targets, two saved rigs and the
/// session associations named on [`FRAMES`].
async fn world() -> World {
    let fx = Fixture::new();
    for frame in &FRAMES {
        fx.write(frame.path, frame.path.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan_frames(&catalog, &fx, &location).await;
    let ngc7000 = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let m81 = catalog.save_target(&target("M 81", "m 81"), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig("RedCat 51", "ASI2600MM"), None).await.unwrap();
    let esprit = catalog.save_equipment(&rig("Esprit 100", "ASI533MC"), None).await.unwrap();
    let world = World { fx, catalog, location, ngc7000, m81, redcat, esprit, before };
    let ngc = world.ngc7000.candidate.id;
    for (path, target, equipment) in [
        (RC_HA_1, Some(ngc), Some(world.redcat.id)),
        (ES_HA, Some(ngc), Some(world.esprit.id)),
        (RC_OIII, None, Some(world.redcat.id)),
        (RC_L, Some(world.m81.candidate.id), Some(world.redcat.id)),
        (RC_SII, Some(ngc), None),
    ] {
        if let Some(target) = target {
            let session = world.session(path).await;
            world.catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
        }
        if let Some(equipment) = equipment {
            let session = world.session(path).await;
            world
                .catalog
                .confirm_equipment(&[expected_session(&session)], equipment)
                .await
                .unwrap();
        }
    }
    // The OIII session's OBJECT header names NGC 7000: an automatic suggestion,
    // never a confirmation.
    let session = world.session(RC_OIII).await;
    let assets = world.catalog.session(session.id).await.unwrap().assets;
    let suggestion = SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(ngc),
        state: AssociationState::Suggested,
        evidence: vec![EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true }],
        provenance: Provenance::Inferred { rule: "object-header".into() },
        expected_observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        expected_decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        expected_observation_revisions: assets
            .iter()
            .map(|a| (a.id, a.observation_revision))
            .collect(),
    };
    world.catalog.record_suggestions(&[suggestion]).await.unwrap();
    world
}

fn subject(target: &TargetRecord) -> SubjectInput {
    SubjectInput { target_id: target.candidate.id, name: None, mosaic: false, panels: Vec::new() }
}

fn hoo(world: &World) -> ProjectInput {
    ProjectInput {
        name: "NGC 7000 HOO".into(),
        notes: Some("Bicolor".into()),
        subjects: vec![subject(&world.ngc7000)],
        rig_ids: vec![world.redcat.id],
        goals: Vec::new(),
    }
}

fn integration(
    target: &TargetRecord,
    panel: Option<u32>,
    channel: &str,
    seconds: u64,
) -> GoalInput {
    GoalInput {
        target_id: target.candidate.id,
        panel,
        goal: GoalSpec::Integration { channel: Some(channel.into()), goal_seconds: seconds },
    }
}

fn panel(number: u32, ra_deg: f64, dec_deg: f64, rotation_deg: Option<f64>) -> PanelInput {
    PanelInput { number, ra_deg, dec_deg, rotation_deg }
}

fn mark(asset: &Asset, expected_revision: Revision, rejected: bool) -> RejectionMark {
    RejectionMark {
        asset_id: asset.id,
        fingerprint: asset.fingerprint.clone(),
        expected_revision,
        rejected,
    }
}

/// `(session, subject, rig)` of every candidate, in candidate order.
fn reasons(candidates: &[ProjectCandidate]) -> Vec<(Uuid, Uuid, Uuid)> {
    candidates.iter().map(|c| (c.session_id, c.subject_id, c.rig_id)).collect()
}

/// The goals of `project` as `(channel, seconds)` of its integration goals.
fn integration_goals(project: &Project) -> Vec<(Option<String>, u64)> {
    project
        .goals
        .iter()
        .filter_map(|goal| match &goal.goal {
            GoalSpec::Integration { channel, goal_seconds } => {
                Some((channel.clone(), *goal_seconds))
            }
            _ => None,
        })
        .collect()
}

/// A Conflict naming `id` at its `current` revision.
fn conflict_at(error: &LibraryError, id: Uuid, current: Revision) {
    let response = error.response(None, None);
    assert_eq!(
        (response.kind.as_str(), response.identity, response.current_revision),
        ("conflict", Some(id), Some(current)),
        "{error}"
    );
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

/// PRJ-FR-09, PRJ-AC-09, SC-PRJ-04: candidates are exactly the sessions whose
/// confirmed Target is a subject and whose confirmed rig is a Project rig; each
/// names its subject and rig. A confirmed Target on another rig, a session with
/// no confirmed rig and another Target stay out.
#[tokio::test]
async fn candidates_require_confirmed_target_and_project_rig() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let ngc = project.subjects[0].id;
    let redcat_ha = world.session(RC_HA_1).await;

    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(reasons(&candidates), vec![(redcat_ha.id, ngc, world.redcat.id)]);
    let mut frames = vec![world.asset(RC_HA_1).await.id, world.asset(RC_HA_2).await.id];
    frames.sort_unstable();
    assert_eq!(candidates[0].asset_ids, frames, "the candidate names its frames");
    assert_eq!(
        (candidates[0].grouping_revision, candidates[0].decision_revision),
        (redcat_ha.grouping_revision, redcat_ha.decision_revision),
        "the session record as it reads now"
    );
    for (path, why) in [
        (ES_HA, "a confirmed subject Target on a rig the Project does not list"),
        (RC_SII, "a confirmed subject Target with no confirmed rig"),
        (RC_L, "another Target"),
    ] {
        let session = world.session(path).await.id;
        assert!(candidates.iter().all(|c| c.session_id != session), "{why} is no candidate");
    }

    // A second subject far away: its own confirmed sessions on the same rig.
    let subjects = vec![subject(&world.ngc7000), subject(&world.m81)];
    let project = catalog.set_project_subjects(project.id, 1, &subjects).await.unwrap();
    assert_eq!(project.revision, 2);
    let m81 = project.subjects[1].id;
    assert_eq!(project.subjects[0].id, ngc, "a kept subject keeps its identity");
    assert_eq!(project.subjects[1].designation, "M 81");
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    let redcat_l = world.session(RC_L).await.id;
    assert_eq!(
        reasons(&candidates),
        vec![(redcat_ha.id, ngc, world.redcat.id), (redcat_l, m81, world.redcat.id)]
    );
    let detail = catalog.project_detail(project.id).await.unwrap();
    assert_eq!(detail.project, project);
    assert_eq!(reasons(&detail.candidates), reasons(&candidates), "detail reads the same set");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-09 and its edge case: an OBJECT header and the automatic suggestion
/// it raises confirm no Target, so that session is never a candidate. The user's
/// confirmation makes it one, with nothing changed on the Project.
#[tokio::test]
async fn object_header_alone_is_never_candidate() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let oiii = world.session(RC_OIII).await;
    assert_eq!(world.asset(RC_OIII).await.effective.object.as_deref(), Some("NGC 7000"));
    let associations = catalog.associations(oiii.id).await.unwrap();
    let target = associations.iter().find(|a| a.kind == AssociationKind::Target).unwrap();
    assert_eq!(
        (&target.state, target.subject_id),
        (&AssociationState::Suggested, Some(world.ngc7000.candidate.id))
    );
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.iter().all(|c| c.session_id != oiii.id), "OBJECT alone is no candidate");

    catalog.associate_target(&[expected_session(&oiii)], world.ngc7000.candidate.id).await.unwrap();
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    let confirmed = candidates.iter().find(|c| c.session_id == oiii.id).expect("now a candidate");
    assert_eq!((confirmed.subject_id, confirmed.rig_id), (project.subjects[0].id, world.redcat.id));
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "the Project is unchanged");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-02, PRJ-AC-09, PRJ-AC-25 (without runs): adding a rig adds its
/// confirmed sessions as candidates and removing it takes them out again; the
/// rig list writes only Project rows.
#[tokio::test]
async fn adding_rig_adds_its_sessions_as_candidates() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let ngc = project.subjects[0].id;
    let redcat_ha = world.session(RC_HA_1).await.id;
    let esprit_ha = world.session(ES_HA).await.id;
    let library = dump(&world.fx.db, &LIBRARY_TABLES).await;

    let both = catalog.set_project_rigs(project.id, 1, &[world.redcat.id, world.esprit.id]).await;
    let project = both.unwrap();
    assert_eq!(
        (project.revision, project.rig_ids.clone()),
        (2, vec![world.redcat.id, world.esprit.id])
    );
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(
        reasons(&candidates),
        vec![(redcat_ha, ngc, world.redcat.id), (esprit_ha, ngc, world.esprit.id)],
        "the added rig's confirmed session joins, in rig order"
    );

    let project = catalog.set_project_rigs(project.id, 2, &[world.esprit.id]).await.unwrap();
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(reasons(&candidates), vec![(esprit_ha, ngc, world.esprit.id)], "removed rig leaves");

    // Removing a subject no run uses takes its sessions out of the candidates too.
    let subjects = vec![subject(&world.m81)];
    let project = catalog.set_project_subjects(project.id, 3, &subjects).await.unwrap();
    assert!(catalog.project_candidates(project.id).await.unwrap().is_empty(), "M 81 is on RedCat");

    // Refusals write nothing.
    for (error, current) in [
        (catalog.set_project_rigs(project.id, 3, &[world.redcat.id]).await.unwrap_err(), 4),
        (catalog.set_project_rigs(project.id, 4, &[]).await.unwrap_err(), 0),
        (
            catalog
                .set_project_rigs(project.id, 4, &[world.esprit.id, world.esprit.id])
                .await
                .unwrap_err(),
            0,
        ),
        (catalog.set_project_rigs(project.id, 4, &[Uuid::new_v4()]).await.unwrap_err(), 0),
    ] {
        if current > 0 {
            conflict_at(&error, project.id, current);
        } else {
            assert!(["invalid_input", "not_found"].contains(&kind(&error).as_str()), "{error}");
        }
    }
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "refusals wrote nothing");
    assert_eq!(dump(&world.fx.db, &LIBRARY_TABLES).await, library, "no library row changed");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-09, PRJ-FR-16: Trashed frames are never candidates and a session whose
/// frames are all Trashed is none; a Trashed frame takes no Project-only reject.
#[tokio::test]
async fn trashed_frames_never_in_candidates() {
    let world = world().await;
    let project = world.catalog.create_project(&hoo(&world)).await.unwrap();
    let kept = world.asset(RC_HA_1).await;
    let world = world.trash(&[RC_HA_2]).await;

    let candidates = world.catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].asset_ids, vec![kept.id], "the Trashed frame is left out");
    let detail = world.catalog.project_detail(project.id).await.unwrap();
    assert_eq!(detail.candidates[0].asset_ids, vec![kept.id]);

    let trashed = world.asset(RC_HA_2).await;
    assert_eq!(trashed.availability, Availability::Trashed);
    let error = world.catalog.set_project_rejection(project.id, &[mark(&trashed, 0, true)]).await;
    assert_eq!(kind(&error.unwrap_err()), "invalid_input", "a Trashed frame takes no reject");
    assert!(world.catalog.project_detail(project.id).await.unwrap().rejections.is_empty());

    let world = world.trash(&[RC_HA_1]).await;
    let candidates = world.catalog.project_candidates(project.id).await.unwrap();
    assert!(candidates.is_empty(), "a session with only Trashed frames is no candidate");
    world.catalog.close().await.unwrap();
}

/// The built-in templates and their values, in display order (D-W47).
fn assert_builtin_values(templates: &[GoalTemplate]) {
    let builtins: Vec<(String, Vec<(Option<String>, u64)>)> = templates
        .iter()
        .filter(|template| template.builtin)
        .map(|template| {
            let goals = template
                .goals
                .iter()
                .map(|goal| match goal {
                    GoalSpec::Integration { channel, goal_seconds } => {
                        (channel.clone(), *goal_seconds)
                    }
                    other => panic!("built-in templates hold integration goals: {other:?}"),
                })
                .collect();
            (template.name.clone(), goals)
        })
        .collect();
    let hours = |channel: Option<&str>, hours: u64| (channel.map(str::to_owned), hours * 3600);
    assert_eq!(
        builtins,
        vec![
            ("HOO".into(), vec![hours(Some("Ha"), 10), hours(Some("OIII"), 10)]),
            (
                "SHO".into(),
                vec![hours(Some("Ha"), 10), hours(Some("OIII"), 10), hours(Some("SII"), 10)]
            ),
            (
                "LRGB".into(),
                vec![
                    hours(Some("L"), 6),
                    hours(Some("R"), 2),
                    hours(Some("G"), 2),
                    hours(Some("B"), 2)
                ]
            ),
            ("OSC broadband".into(), vec![hours(None, 10)]),
            ("OSC dual-band".into(), vec![hours(None, 15)]),
        ]
    );
}

/// PRJ-FR-12, PRJ-AC-14, D-W47: the built-in templates and values; applying HOO
/// copies Ha 10h and OIII 10h into the Project as editable goals; a later edit
/// of a template changes no Project; the list never depends on the rig.
#[tokio::test]
async fn hoo_template_copies_goals_editable_and_rig_independent() {
    let world = world().await;
    let catalog = &world.catalog;
    let templates = catalog.goal_templates().await.unwrap();
    assert_builtin_values(&templates);
    let hoo_template = templates.iter().find(|template| template.name == "HOO").unwrap().id;

    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let ngc = world.ngc7000.candidate.id;
    let project =
        catalog.apply_goal_template(project.id, 1, hoo_template, ngc, None).await.unwrap();
    assert_eq!(project.revision, 2);
    assert_eq!(
        integration_goals(&project),
        vec![(Some("Ha".into()), 36_000), (Some("OIII".into()), 36_000)]
    );
    assert!(project.goals.iter().all(|goal| goal.subject_id == project.subjects[0].id));

    // The copied goals stay editable; the template does not follow.
    let edited = vec![
        integration(&world.ngc7000, None, "Ha", 36_000),
        integration(&world.ngc7000, None, "OIII", 43_200),
    ];
    let project = catalog.set_project_goals(project.id, 2, &edited).await.unwrap();
    assert_eq!(
        integration_goals(&project),
        vec![(Some("Ha".into()), 36_000), (Some("OIII".into()), 43_200)]
    );
    assert_eq!(catalog.goal_templates().await.unwrap(), templates, "HOO still reads OIII 10h");

    // A user template: applying copies it, and editing it later changes no Project.
    let mine = GoalTemplateInput {
        id: None,
        name: "My Ha".into(),
        goals: vec![GoalSpec::Integration { channel: Some("Ha".into()), goal_seconds: 18_000 }],
    };
    let saved = catalog.save_goal_template(&mine, None).await.unwrap();
    assert_eq!((saved.revision, saved.builtin), (1, false));
    let other =
        catalog.create_project(&ProjectInput { name: "Ha only".into(), ..hoo(&world) }).await;
    let other = other.unwrap();
    let other = catalog.apply_goal_template(other.id, 1, saved.id, ngc, None).await.unwrap();
    let changed = GoalTemplateInput {
        id: Some(saved.id),
        goals: vec![GoalSpec::Integration { channel: Some("Ha".into()), goal_seconds: 28_800 }],
        ..mine.clone()
    };
    conflict_at(&catalog.save_goal_template(&changed, Some(2)).await.unwrap_err(), saved.id, 1);
    assert_eq!(catalog.save_goal_template(&changed, Some(1)).await.unwrap().revision, 2);
    assert_eq!(
        catalog.project(other.id).await.unwrap(),
        other,
        "the template edit changes no Project"
    );
    conflict_at(&catalog.delete_goal_template(saved.id, 1).await.unwrap_err(), saved.id, 2);
    catalog.delete_goal_template(saved.id, 2).await.unwrap();
    assert_eq!(catalog.project(other.id).await.unwrap(), other, "nor does deleting it");
    assert_eq!(catalog.goal_templates().await.unwrap(), templates, "only the built-ins remain");

    // Built-ins are read-only.
    let builtin = GoalTemplateInput { id: Some(hoo_template), ..mine };
    assert_eq!(
        kind(&catalog.save_goal_template(&builtin, Some(1)).await.unwrap_err()),
        "invalid_input"
    );
    assert_eq!(
        kind(&catalog.delete_goal_template(hoo_template, 1).await.unwrap_err()),
        "invalid_input"
    );

    // The template list is the same whatever rig a Project uses.
    catalog.set_project_rigs(project.id, 3, &[world.esprit.id]).await.unwrap();
    assert_eq!(
        catalog.goal_templates().await.unwrap(),
        templates,
        "templates are never filtered by rig"
    );
    let unknown = catalog.apply_goal_template(project.id, 4, Uuid::new_v4(), ngc, None).await;
    assert_eq!(kind(&unknown.unwrap_err()), "not_found");
    world.catalog.close().await.unwrap();
}

/// Goals of the mosaic NGC 7000 subject (panels 1 and 2) that are refused.
async fn assert_goal_scope_refusals(world: &World, project: Uuid) {
    for (goals, expected, why) in [
        (
            vec![integration(&world.ngc7000, None, "Ha", 3600)],
            "invalid_input",
            "no panel on a mosaic",
        ),
        (vec![integration(&world.ngc7000, Some(3), "Ha", 3600)], "not_found", "an unknown panel"),
        (vec![integration(&world.m81, None, "Ha", 3600)], "not_found", "not a subject"),
        (vec![integration(&world.ngc7000, Some(1), "Ha", 0)], "invalid_input", "a zero goal"),
        (vec![integration(&world.ngc7000, Some(1), " ", 3600)], "invalid_input", "a blank channel"),
        (
            vec![
                integration(&world.ngc7000, Some(1), "Ha", 3600),
                integration(&world.ngc7000, Some(1), "Ha", 7200),
            ],
            "invalid_input",
            "the same goal twice",
        ),
    ] {
        let error = world.catalog.set_project_goals(project, 1, &goals).await.unwrap_err();
        assert_eq!(kind(&error), expected, "{why}: {error}");
    }
}

/// PRJ-FR-01, PRJ-FR-03, PRJ-AC-13: a mosaic subject defines its panels by ICRS
/// centre and rotation, an unknown rotation stays unknown (never zero), each
/// panel takes its own goals, and an edit keeps each panel by its number.
#[tokio::test]
async fn mosaic_subject_panels_by_centre_and_rotation_unknown_rotation_allowed() {
    let world = world().await;
    let catalog = &world.catalog;
    let mosaic = |panels: Vec<PanelInput>| SubjectInput {
        target_id: world.ngc7000.candidate.id,
        name: Some("North America mosaic".into()),
        mosaic: true,
        panels,
    };
    let two = vec![panel(1, 314.2, 44.1, Some(90.0)), panel(2, 315.6, 44.6, None)];
    let input = ProjectInput {
        subjects: vec![mosaic(two.clone())],
        goals: vec![
            integration(&world.ngc7000, Some(1), "Ha", 18_000),
            integration(&world.ngc7000, Some(2), "Ha", 18_000),
            GoalInput {
                target_id: world.ngc7000.candidate.id,
                panel: None,
                goal: GoalSpec::QualityBar {
                    criterion: QualityCriterion::MaxFwhmMedian { max_px: 3.5 },
                },
            },
        ],
        ..hoo(&world)
    };
    let project = catalog.create_project(&input).await.unwrap();
    let stored = &project.subjects[0];
    assert!(stored.mosaic);
    assert_eq!(stored.designation, "NGC 7000");
    assert_eq!(stored.name.as_deref(), Some("North America mosaic"));
    let geometry: Vec<_> =
        stored.panels.iter().map(|p| (p.number, p.ra_deg, p.dec_deg, p.rotation_deg)).collect();
    assert_eq!(geometry, vec![(1, 314.2, 44.1, Some(90.0)), (2, 315.6, 44.6, None)]);
    let panel_of = |number: u32| stored.panels.iter().find(|p| p.number == number).unwrap().id;
    let goal_panels: Vec<_> = project.goals.iter().map(|goal| goal.panel_id).collect();
    assert_eq!(goal_panels, vec![Some(panel_of(1)), Some(panel_of(2)), None]);
    let candidates = catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(
        reasons(&candidates),
        vec![(world.session(RC_HA_1).await.id, stored.id, world.redcat.id)],
        "a mosaic's candidates follow its Target and rig; panels come from pointing (VSEL)"
    );

    // Refused geometry and goal scope write nothing.
    let refusals: Vec<(Vec<SubjectInput>, &str)> = vec![
        (vec![mosaic(vec![panel(1, 360.0, 44.0, None)])], "raDeg 360"),
        (vec![mosaic(vec![panel(1, 314.0, 90.5, None)])], "decDeg above 90"),
        (vec![mosaic(vec![panel(1, f64::NAN, 44.0, None)])], "raDeg NaN"),
        (vec![mosaic(vec![panel(1, 314.0, 44.0, Some(360.0))])], "rotation 360"),
        (vec![mosaic(vec![panel(1, 314.0, 44.0, Some(-1.0))])], "negative rotation"),
        (vec![mosaic(vec![panel(0, 314.0, 44.0, None)])], "panel 0"),
        (
            vec![mosaic(vec![panel(1, 314.0, 44.0, None), panel(1, 315.0, 44.0, None)])],
            "panel 1 twice",
        ),
        (vec![mosaic(Vec::new())], "a mosaic without panels"),
        (
            vec![SubjectInput { mosaic: false, ..mosaic(vec![panel(1, 314.0, 44.0, None)]) }],
            "panels on a single-Target subject",
        ),
        (vec![subject(&world.ngc7000), subject(&world.ngc7000)], "one Target twice"),
        (Vec::new(), "no subject"),
        (vec![SubjectInput { name: Some("  ".into()), ..mosaic(two.clone()) }], "a blank name"),
    ];
    for (subjects, why) in refusals {
        let error = catalog.set_project_subjects(project.id, 1, &subjects).await.unwrap_err();
        assert_eq!(kind(&error), "invalid_input", "{why}: {error}");
    }
    let unsaved = SubjectInput { target_id: Uuid::new_v4(), ..subject(&world.m81) };
    let error = catalog.set_project_subjects(project.id, 1, &[unsaved]).await.unwrap_err();
    assert_eq!(kind(&error), "not_found", "an unsaved Target");
    assert_goal_scope_refusals(&world, project.id).await;
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "refusals wrote nothing");

    // An edit keeps panel 2 by its number with its new centre and rotation,
    // removes panel 1 with its goal and adds panel 3.
    let edited = vec![mosaic(vec![panel(2, 315.7, 44.7, Some(12.5)), panel(3, 316.9, 45.0, None)])];
    let project = catalog.set_project_subjects(project.id, 1, &edited).await.unwrap();
    let edited_subject = &project.subjects[0];
    let kept = edited_subject.panels.iter().find(|p| p.number == 2).unwrap();
    assert_eq!((kept.id, kept.ra_deg, kept.rotation_deg), (panel_of(2), 315.7, Some(12.5)));
    assert_eq!(edited_subject.panels.iter().map(|p| p.number).collect::<Vec<_>>(), vec![2, 3]);
    let goal_panels: Vec<_> = project.goals.iter().map(|goal| goal.panel_id).collect();
    assert_eq!(goal_panels, vec![Some(panel_of(2)), None], "panel 1's goal left with it");

    // A single-Target subject takes goals without a panel.
    let single = vec![subject(&world.ngc7000)];
    let project = catalog.set_project_subjects(project.id, 2, &single).await.unwrap();
    assert!(project.subjects[0].panels.is_empty());
    assert_eq!(project.goals.len(), 1, "only the subject-wide quality bar still fits");
    let goals = vec![integration(&world.ngc7000, Some(1), "Ha", 3600)];
    let error = catalog.set_project_goals(project.id, 3, &goals).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "no panel on a single-Target subject");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-05, PRJ-FR-08, PRJ-AC-02: every Project write, refused or committed,
/// changes no source file, no library quality decision and no session record
/// or membership; refusals write no Project row either.
#[tokio::test]
async fn project_write_changes_no_file_quality_or_membership() {
    let world = world().await;
    let catalog = &world.catalog;
    let decided = world.asset(RC_HA_1).await;
    catalog.set_quality(&[expected(&decided)], Quality::Usable, DiskProbe).await.unwrap();
    let library = dump(&world.fx.db, &LIBRARY_TABLES).await;

    let mut input = hoo(&world);
    input.goals = vec![integration(&world.ngc7000, None, "Ha", 36_000)];
    let project = catalog.create_project(&input).await.unwrap();
    assert_eq!(
        (project.revision, project.state, project.done_at.clone()),
        (1, ProjectState::Open, None)
    );
    let project = catalog.update_project(project.id, 1, "NGC 7000 bicolor", None).await.unwrap();
    assert_eq!((project.name.as_str(), project.notes.clone()), ("NGC 7000 bicolor", None));
    let subjects = vec![subject(&world.ngc7000), subject(&world.m81)];
    let project = catalog.set_project_subjects(project.id, 2, &subjects).await.unwrap();
    let project =
        catalog.set_project_rigs(project.id, 3, &[world.redcat.id, world.esprit.id]).await;
    let project = project.unwrap();
    let goals = vec![
        integration(&world.ngc7000, None, "Ha", 36_000),
        GoalInput {
            target_id: world.m81.candidate.id,
            panel: None,
            goal: GoalSpec::FrameCount { channel: Some("L".into()), goal_frames: 120 },
        },
        GoalInput {
            target_id: world.m81.candidate.id,
            panel: None,
            goal: GoalSpec::QualityBar { criterion: QualityCriterion::UsableOnly },
        },
    ];
    let project = catalog.set_project_goals(project.id, 4, &goals).await.unwrap();
    let hoo_template = catalog.goal_templates().await.unwrap()[0].id;
    let ngc = world.ngc7000.candidate.id;
    let project =
        catalog.apply_goal_template(project.id, 5, hoo_template, ngc, None).await.unwrap();
    assert_eq!(project.revision, 6, "each write adds exactly one revision");
    let decisions = catalog.set_project_rejection(project.id, &[mark(&decided, 0, true)]).await;
    catalog
        .set_project_rejection(project.id, &[mark(&decided, decisions.unwrap()[0].revision, false)])
        .await
        .unwrap();
    let template = GoalTemplateInput {
        id: None,
        name: "Mine".into(),
        goals: vec![GoalSpec::QualityBar { criterion: QualityCriterion::UsableOnly }],
    };
    let saved = catalog.save_goal_template(&template, None).await.unwrap();
    catalog.delete_goal_template(saved.id, 1).await.unwrap();

    let projects = dump(&world.fx.db, &PROJECT_TABLES).await;
    for error in [
        catalog.update_project(project.id, 5, "stale", None).await.unwrap_err(),
        catalog.set_project_subjects(project.id, 5, &subjects).await.unwrap_err(),
        catalog.set_project_rigs(project.id, 5, &[world.redcat.id]).await.unwrap_err(),
        catalog.set_project_goals(project.id, 5, &goals).await.unwrap_err(),
        catalog.apply_goal_template(project.id, 5, hoo_template, ngc, None).await.unwrap_err(),
    ] {
        conflict_at(&error, project.id, 6);
    }
    for error in [
        catalog.update_project(project.id, 6, " ", None).await.unwrap_err(),
        catalog.update_project(Uuid::new_v4(), 1, "x", None).await.unwrap_err(),
        catalog
            .create_project(&ProjectInput { rig_ids: Vec::new(), ..hoo(&world) })
            .await
            .unwrap_err(),
        catalog
            .create_project(&ProjectInput { subjects: Vec::new(), ..hoo(&world) })
            .await
            .unwrap_err(),
    ] {
        assert!(["invalid_input", "not_found"].contains(&kind(&error).as_str()), "{error}");
    }
    assert_eq!(dump(&world.fx.db, &PROJECT_TABLES).await, projects, "refusals wrote nothing");

    assert_eq!(dump(&world.fx.db, &LIBRARY_TABLES).await, library, "library rows unchanged");
    assert_eq!(catalog.asset(decided.id).await.unwrap().quality, Quality::Usable);
    assert_eq!(tree(&world.fx.root), world.before, "no file changed");
    let listed = catalog.list_projects(&ProjectQuery::default()).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (
            listed[0].id,
            listed[0].revision,
            listed[0].subjects.clone(),
            listed[0].rig_count,
            listed[0].goal_count
        ),
        (project.id, 6, vec!["NGC 7000".to_owned(), "M 81".to_owned()], 2, 4)
    );
    let m81_only =
        ProjectQuery { target_id: Some(world.m81.candidate.id), ..ProjectQuery::default() };
    assert_eq!(catalog.list_projects(&m81_only).await.unwrap().len(), 1);
    let none = ProjectQuery { target_id: Some(Uuid::new_v4()), ..ProjectQuery::default() };
    assert!(catalog.list_projects(&none).await.unwrap().is_empty());
    world.catalog.close().await.unwrap();

    // Every Project record survives a restart unchanged.
    let reopened = Catalog::open(&world.fx.db).await.unwrap();
    assert_eq!(reopened.project(project.id).await.unwrap(), project);
    reopened.close().await.unwrap();
}

/// PRJ-FR-13, PRJ-AC-08: a Project-only reject leaves library quality, the
/// candidates ("captured"), other Projects and the Project revision unchanged.
/// Each mark checks only its own asset's latest decision, so rapid marks on
/// different frames never conflict; decisions are append-only.
#[tokio::test]
async fn project_only_reject_keeps_library_quality() {
    let world = world().await;
    let catalog = &world.catalog;
    let first = world.asset(RC_HA_1).await;
    let second = world.asset(RC_HA_2).await;
    let usable =
        catalog.set_quality(&[expected(&first)], Quality::Usable, DiskProbe).await.unwrap();
    let first = usable[0].clone();
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let other = catalog.create_project(&ProjectInput { name: "Other".into(), ..hoo(&world) }).await;
    let other = other.unwrap();
    let candidates = catalog.project_candidates(project.id).await.unwrap();

    let decided =
        catalog.set_project_rejection(project.id, &[mark(&first, 0, true)]).await.unwrap();
    assert_eq!(
        (decided[0].asset_id, decided[0].revision, decided[0].rejected),
        (first.id, 1, true)
    );
    assert_eq!(decided[0].fingerprint, first.fingerprint);
    // A rapid second mark on another frame needs no fresh Project revision.
    let decided =
        catalog.set_project_rejection(project.id, &[mark(&second, 0, true)]).await.unwrap();
    assert_eq!(decided[0].revision, 1);

    let library = catalog.asset(first.id).await.unwrap();
    assert_eq!(
        (library.quality, library.decision_revision),
        (Quality::Usable, first.decision_revision),
        "library quality is untouched"
    );
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "the Project revision stays");
    assert_eq!(
        reasons(&catalog.project_candidates(project.id).await.unwrap()),
        reasons(&candidates),
        "captured is unchanged"
    );
    assert_eq!(catalog.project_candidates(project.id).await.unwrap()[0].asset_ids.len(), 2);
    assert!(catalog.project_detail(other.id).await.unwrap().rejections.is_empty(), "other Project");

    // The per-asset CAS: a stale mark is refused naming the asset's decision.
    let stale = catalog.set_project_rejection(project.id, &[mark(&first, 0, false)]).await;
    conflict_at(&stale.unwrap_err(), first.id, 1);
    let withdrawn = catalog.set_project_rejection(project.id, &[mark(&first, 1, false)]).await;
    let withdrawn = withdrawn.unwrap();
    assert_eq!((withdrawn[0].revision, withdrawn[0].rejected), (2, false));
    // All or nothing: one stale mark refuses the batch.
    let batch = [mark(&second, 1, false), mark(&first, 1, true)];
    conflict_at(&catalog.set_project_rejection(project.id, &batch).await.unwrap_err(), first.id, 2);
    // The bytes the user saw changed: refused.
    let mut changed = mark(&second, 1, false);
    changed.fingerprint.size_bytes += 1;
    let error = catalog.set_project_rejection(project.id, &[changed]).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");
    for (marks, expected) in [
        (Vec::new(), "invalid_input"),
        (vec![mark(&second, 1, false), mark(&second, 1, true)], "invalid_input"),
        (vec![RejectionMark { asset_id: Uuid::new_v4(), ..mark(&second, 0, true) }], "not_found"),
    ] {
        let error = catalog.set_project_rejection(project.id, &marks).await.unwrap_err();
        assert_eq!(kind(&error), expected, "{error}");
    }
    let unknown = catalog.set_project_rejection(Uuid::new_v4(), &[mark(&second, 1, false)]).await;
    assert_eq!(kind(&unknown.unwrap_err()), "not_found");

    let detail = catalog.project_detail(project.id).await.unwrap();
    let mut latest: Vec<_> =
        detail.rejections.iter().map(|r| (r.asset_id, r.revision, r.rejected)).collect();
    latest.sort_unstable();
    let mut expected_latest = vec![(first.id, 2, false), (second.id, 1, true)];
    expected_latest.sort_unstable();
    assert_eq!(latest, expected_latest, "the latest decision of each asset");
    let mut conn = raw(&world.fx.db).await;
    let history: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT revision, rejected FROM project_rejections WHERE project_id = ?1 AND asset_id = ?2 \
         ORDER BY id",
    )
    .bind(project.id.to_string())
    .bind(first.id.to_string())
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert_eq!(history, vec![(1, 1), (2, 0)], "append-only decisions; the latest is effective");

    // Retire review reads the Project through its effective rejections only.
    let asked: BTreeSet<Uuid> = [first.id, second.id].into();
    let references = catalog.project_references(&asked).await.unwrap();
    assert_eq!(references.len(), 1);
    assert_eq!(
        (references[0].id, references[0].name.as_str(), references[0].asset_ids.clone()),
        (project.id, "NGC 7000 HOO", vec![second.id])
    );
    assert_eq!(tree(&world.fx.root), world.before, "no file changed");
    world.catalog.close().await.unwrap();
}
