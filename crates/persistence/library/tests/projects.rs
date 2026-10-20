// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects in the clean catalog (spec 065, amended D-W1..D-W74): subjects,
//! rigs, goals on subjects and mosaic panel groups, goal templates and derived
//! candidates. Every Project write is checked against the Project revision and
//! the records it names, and changes no library row or source file. Fixture
//! files are real and only read.
#![cfg(unix)]

#[path = "support/membership.rs"]
mod membership_support;
mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use membership_support::{hold, remove};
use persistence_library::{Catalog, NewGroup, SessionQuery, SourceProbe, SuggestedAssociation};
use platevault_model::{
    Asset, AssociationKind, AssociationState, Availability, Equipment, EvidenceItem, GoalInput,
    GoalSpec, GoalTemplate, GoalTemplateInput, GroupName, GroupOrigin, LibraryError, Location,
    OpticsSignature, Project, ProjectCandidate, ProjectInput, ProjectLifecycle, ProjectQuery,
    ProjectSummary, Provenance, Quality, QualityCriterion, ReferenceKind, Revision, ScanFile,
    ScanObservation, ScanProgress, ScanState, Session, SubjectInput, TargetRecord,
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
const PROJECT_TABLES: [&str; 6] = [
    "project_hidden_goals",
    "project_goals",
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
    SubjectInput { target_id: target.candidate.id, name: None }
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
    group: Option<Uuid>,
    channel: &str,
    seconds: u64,
) -> GoalInput {
    GoalInput {
        target_id: target.candidate.id,
        group_id: group,
        goal: GoalSpec::Integration { channel: Some(channel.into()), goal_seconds: seconds },
    }
}

/// An `InvalidInput` refusal whose message names each of `needles`.
fn refused(error: &LibraryError, needles: &[&str]) {
    assert_eq!(kind(error), "invalid_input", "{error}");
    let message = error.to_string();
    for needle in needles {
        assert!(message.contains(needle), "{needle:?} in {message}");
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
        (response.code.as_str(), response.identity, response.current_revision),
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

    // Removing a subject no held session joined on takes its sessions out of
    // the candidates too.
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
/// frames are all Trashed is none.
#[tokio::test]
async fn trashed_frames_never_in_candidates() {
    let world = world().await;
    let project = world.catalog.create_project(&hoo(&world)).await.unwrap();
    let kept = world.asset(RC_HA_1).await;
    let world = world.trash(&[RC_HA_2]).await;

    let candidates = world.catalog.project_candidates(project.id).await.unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].asset_ids, vec![kept.id], "the Trashed frame is left out");
    let trashed = world.asset(RC_HA_2).await;
    assert_eq!(trashed.availability, Availability::Trashed);

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

/// Goals of the NGC 7000 subject that are refused in `project`, which has the
/// mosaic panel group `panel` and the plain group `plain`.
async fn assert_goal_scope_refusals(world: &World, project: Uuid, panel: Uuid, plain: Uuid) {
    let revision = world.catalog.project(project).await.unwrap().revision;
    let ngc = &world.ngc7000;
    for (goals, expected, why) in [
        (vec![integration(ngc, Some(plain), "Ha", 3600)], "invalid_input", "a plain group"),
        (vec![integration(ngc, Some(Uuid::new_v4()), "Ha", 3600)], "not_found", "an unknown group"),
        (vec![integration(&world.m81, Some(panel), "Ha", 3600)], "not_found", "not a subject"),
        (vec![integration(ngc, Some(panel), "Ha", 0)], "invalid_input", "a zero goal"),
        (vec![integration(ngc, Some(panel), " ", 3600)], "invalid_input", "a blank channel"),
        (
            vec![
                integration(ngc, Some(panel), "Ha", 3600),
                integration(ngc, Some(panel), "Ha", 7200),
            ],
            "invalid_input",
            "the same goal twice",
        ),
    ] {
        let error = world.catalog.set_project_goals(project, revision, &goals).await.unwrap_err();
        assert_eq!(kind(&error), expected, "{why}: {error}");
    }
}

/// PRJ-FR-03, PRJ-FR-29, record §2 (mosaic is a panel group, not a subject
/// mode): a group marked a mosaic panel takes its own goals beside the
/// subject's; a goal on a plain or unknown group, or an invalid or repeated
/// one, is refused and writes nothing; a template copies into a panel group
/// only; a panel group with goals stays a panel.
#[tokio::test]
async fn panel_groups_take_their_own_goals() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let ha = world.session(RC_HA_1).await.id;
    let desired = hold(catalog, project.id, ha, world.redcat.id).await;
    let panel = desired.groups[0].id;
    let name = GroupName::new("Panel 1").unwrap();
    let desired = catalog
        .set_project_group_panel(project.id, desired.revision, panel, true, Some(&name))
        .await
        .unwrap();
    let plain = NewGroup {
        id: Uuid::new_v4(),
        rig_id: world.redcat.id,
        name: GroupName::new("RedCat 51 · 2").unwrap(),
        origin: GroupOrigin::User,
        optics: OpticsSignature::new(None, Some(250.0), None).unwrap(),
        framing: None,
    };
    let desired =
        catalog.create_project_group(project.id, desired.revision, &plain, &[]).await.unwrap();
    let groups: Vec<_> = desired.groups.iter().map(|group| (group.id, group.panel)).collect();
    assert_eq!(groups, vec![(panel, true), (plain.id, false)]);

    let ngc = &world.ngc7000;
    let goals = vec![
        integration(ngc, Some(panel), "Ha", 18_000),
        GoalInput {
            target_id: ngc.candidate.id,
            group_id: None,
            goal: GoalSpec::QualityBar {
                criterion: QualityCriterion::MaxFwhmMedian { max_arcsec: 3.5 },
            },
        },
    ];
    let project = catalog.set_project_goals(project.id, desired.revision, &goals).await.unwrap();
    let subject = project.subjects[0].id;
    let scopes: Vec<_> =
        project.goals.iter().map(|goal| (goal.subject_id, goal.group_id)).collect();
    assert_eq!(scopes, vec![(subject, Some(panel)), (subject, None)]);

    assert_goal_scope_refusals(&world, project.id, panel, plain.id).await;
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "refusals wrote nothing");

    // A template copies into a panel group, never into a plain or unknown one.
    let templates = catalog.goal_templates().await.unwrap();
    let hoo_template = templates.iter().find(|template| template.name == "HOO").unwrap().id;
    let revision = project.revision;
    for (group, expected) in [(plain.id, "invalid_input"), (Uuid::new_v4(), "not_found")] {
        let error = catalog
            .apply_goal_template(project.id, revision, hoo_template, ngc.candidate.id, Some(group))
            .await
            .unwrap_err();
        assert_eq!(kind(&error), expected, "{error}");
    }
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "refusals wrote nothing");
    let project = catalog
        .apply_goal_template(project.id, revision, hoo_template, ngc.candidate.id, Some(panel))
        .await
        .unwrap();
    assert_eq!(
        integration_goals(&project),
        vec![(Some("Ha".into()), 36_000), (Some("OIII".into()), 36_000)],
        "HOO replaces the panel's Ha goal and adds OIII"
    );
    let panel_goals = project.goals.iter().filter(|goal| goal.group_id == Some(panel)).count();
    assert_eq!(panel_goals, 2, "both copied goals belong to the panel");

    let error = catalog
        .set_project_group_panel(project.id, project.revision, panel, false, None)
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "a panel group with goals stays a panel: {error}");
    world.catalog.close().await.unwrap();
}

/// PRJ-AC-26, PRJ-FR-31 (the F4 form of D-W65): a subject a held session joined
/// on, or a rig a group of the Project is on, is never removed; the refusal
/// names it and writes nothing. Unused ones go, and so do these once the
/// session leaves and its framing group with it.
#[tokio::test]
async fn removing_subject_or_rig_the_project_holds_is_refused_naming_it() {
    let world = world().await;
    let catalog = &world.catalog;
    let input = ProjectInput {
        subjects: vec![subject(&world.ngc7000), subject(&world.m81)],
        rig_ids: vec![world.redcat.id, world.esprit.id],
        ..hoo(&world)
    };
    let project = catalog.create_project(&input).await.unwrap();
    let ha = world.session(RC_HA_1).await.id;
    let desired = hold(catalog, project.id, ha, world.redcat.id).await;
    let project =
        catalog.set_project_rigs(project.id, desired.revision, &[world.redcat.id]).await.unwrap();
    let only_ngc = vec![subject(&world.ngc7000)];
    let project =
        catalog.set_project_subjects(project.id, project.revision, &only_ngc).await.unwrap();

    let error = catalog.set_project_rigs(project.id, project.revision, &[world.esprit.id]).await;
    refused(&error.unwrap_err(), &["rig RedCat 51", "Rig 1"]);
    let m81 = vec![subject(&world.m81)];
    let error = catalog.set_project_subjects(project.id, project.revision, &m81).await;
    refused(&error.unwrap_err(), &["subject NGC 7000", "holds 1 session"]);
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "refusals wrote nothing");

    let desired = remove(catalog, project.id, ha).await;
    assert!(desired.groups.is_empty(), "the emptied framing group is dropped");
    let project = catalog.set_project_subjects(project.id, desired.revision, &m81).await.unwrap();
    let project =
        catalog.set_project_rigs(project.id, project.revision, &[world.esprit.id]).await.unwrap();
    assert_eq!(
        (project.subjects[0].target_id, project.rig_ids.clone()),
        (world.m81.candidate.id, vec![world.esprit.id])
    );
    world.catalog.close().await.unwrap();
}

/// `(id, group, goal)` of the goals of `target`'s subject, in goal order.
fn subject_goals(project: &Project, target: &TargetRecord) -> Vec<(Uuid, Option<Uuid>, GoalSpec)> {
    let Some(subject) = project.subjects.iter().find(|s| s.target_id == target.candidate.id) else {
        return Vec::new();
    };
    project
        .goals
        .iter()
        .filter(|goal| goal.subject_id == subject.id)
        .map(|goal| (goal.id, goal.group_id, goal.goal.clone()))
        .collect()
}

/// D-W128, PRJ-FR-02/03: removing a subject keeps its goals hidden. They leave
/// the Project and its goal count while the subject is out, and the Project's
/// sessions stay. Adding the Target back, as a subject or through one of its
/// sessions, restores the same goals with their ids and edited values, not a
/// template's. A panel goal whose group is no longer a panel stays out.
#[tokio::test]
#[allow(clippy::too_many_lines, reason = "one scenario over removal and both re-adds")]
async fn removed_subject_goals_stay_hidden_and_return_when_added_back() {
    let world = world().await;
    let catalog = &world.catalog;
    let (ngc, m81) = (&world.ngc7000, &world.m81);
    let both = vec![subject(ngc), subject(m81)];
    let input = ProjectInput { subjects: both.clone(), ..hoo(&world) };
    let project = catalog.create_project(&input).await.unwrap();
    let ha = world.session(RC_HA_1).await.id;
    let desired = hold(catalog, project.id, ha, world.redcat.id).await;
    let panel = desired.groups[0].id;
    let name = GroupName::new("Panel 1").unwrap();
    let desired = catalog
        .set_project_group_panel(project.id, desired.revision, panel, true, Some(&name))
        .await
        .unwrap();
    let templates = catalog.goal_templates().await.unwrap();
    let hoo_template = templates.iter().find(|template| template.name == "HOO").unwrap().id;
    let project = catalog
        .apply_goal_template(project.id, desired.revision, hoo_template, m81.candidate.id, None)
        .await
        .unwrap();
    let goals = vec![
        integration(ngc, None, "Ha", 36_000),
        integration(m81, None, "Ha", 7_200),
        integration(m81, None, "OIII", 36_000),
        integration(m81, Some(panel), "Ha", 3_600),
    ];
    let project = catalog.set_project_goals(project.id, project.revision, &goals).await.unwrap();
    let kept = subject_goals(&project, m81);
    assert_eq!(kept.len(), 3, "{:#?}", project.goals);
    assert_eq!(kept[0].2, goals[1].goal, "M 81's Ha goal is edited from the template's 10 h");
    let ngc_goals = subject_goals(&project, ngc);
    let membership = dump(&world.fx.db, &["project_sessions"]).await;

    // Removed: its goals are hidden from the Project and its goal count.
    let only_ngc = vec![subject(ngc)];
    let project =
        catalog.set_project_subjects(project.id, project.revision, &only_ngc).await.unwrap();
    assert_eq!(project.goals.len(), 1, "{:#?}", project.goals);
    assert_eq!(subject_goals(&project, ngc), ngc_goals);
    assert_eq!(catalog.list_projects(&ProjectQuery::default()).await.unwrap()[0].goal_count, 1);
    assert_eq!(dump(&world.fx.db, &["project_sessions"]).await, membership, "no session left");

    // Added back as a subject: the same goals, ids and edited values.
    let project = catalog.set_project_subjects(project.id, project.revision, &both).await.unwrap();
    assert_eq!(subject_goals(&project, m81), kept, "the hidden goals return");
    assert_eq!(subject_goals(&project, ngc), ngc_goals);
    assert_eq!(catalog.list_projects(&ProjectQuery::default()).await.unwrap()[0].goal_count, 4);
    assert_eq!(dump(&world.fx.db, &["project_sessions"]).await, membership, "no session joined");

    // Removed again, its panel group unmarked, then added back by adding an
    // M 81 session: the subject's own goals return, the panel goal does not.
    let project =
        catalog.set_project_subjects(project.id, project.revision, &only_ngc).await.unwrap();
    let desired =
        catalog.set_project_group_panel(project.id, project.revision, panel, false, None).await;
    assert!(!desired.unwrap().groups[0].panel, "no visible goal keeps the group a panel");
    let l = world.session(RC_L).await.id;
    hold(catalog, project.id, l, world.redcat.id).await;
    let project = catalog.project(project.id).await.unwrap();
    assert_eq!(subject_goals(&project, m81), kept[..2], "the subject's own goals return");
    assert_eq!(subject_goals(&project, ngc), ngc_goals);
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-05, PRJ-FR-08, PRJ-AC-02: every Project write, refused or committed,
/// changes no source file, no library quality decision and no session record
/// or membership; refusals write no Project row either.
#[tokio::test]
#[allow(clippy::too_many_lines, reason = "one scenario over every Project write")]
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
        (project.revision, project.lifecycle, project.closed_at.clone()),
        (1, ProjectLifecycle::Open, None)
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
            group_id: None,
            goal: GoalSpec::FrameCount { channel: Some("L".into()), goal_frames: 120 },
        },
        GoalInput {
            target_id: world.m81.candidate.id,
            group_id: None,
            goal: GoalSpec::QualityBar { criterion: QualityCriterion::UsableOnly },
        },
    ];
    let project = catalog.set_project_goals(project.id, 4, &goals).await.unwrap();
    let hoo_template = catalog.goal_templates().await.unwrap()[0].id;
    let ngc = world.ngc7000.candidate.id;
    let project =
        catalog.apply_goal_template(project.id, 5, hoo_template, ngc, None).await.unwrap();
    assert_eq!(project.revision, 6, "each write adds exactly one revision");
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
    assert_eq!(catalog.list_projects(&none).await.unwrap(), [] as [ProjectSummary; 0]);
    world.catalog.close().await.unwrap();

    // Every Project record survives a restart unchanged.
    let reopened = Catalog::open(&world.fx.db).await.unwrap();
    assert_eq!(reopened.project(project.id).await.unwrap(), project);
    reopened.close().await.unwrap();
}

/// Retire location review (R19) reads a Project through the copies of the
/// captures it holds, at its Project revision; a suggestion holds nothing.
#[tokio::test]
async fn project_references_name_the_copies_a_project_holds() {
    let world = world().await;
    let catalog = &world.catalog;
    let project = catalog.create_project(&hoo(&world)).await.unwrap();
    let (first, esprit) = (world.asset(RC_HA_1).await, world.asset(ES_HA).await);
    let asked: BTreeSet<Uuid> = [first.id, esprit.id].into();
    let references = catalog.project_references(&asked).await.unwrap();
    assert!(references.is_empty(), "a suggestion holds nothing: {references:?}");

    hold(catalog, project.id, world.session(RC_HA_1).await.id, world.redcat.id).await;
    let project = catalog.project(project.id).await.unwrap();
    let references = catalog.project_references(&asked).await.unwrap();
    let read: Vec<_> = references
        .iter()
        .map(|r| (r.kind, r.id, r.name.as_str(), r.revision, r.asset_ids.clone()))
        .collect();
    assert_eq!(
        read,
        vec![(
            ReferenceKind::Project,
            project.id,
            "NGC 7000 HOO",
            project.revision,
            vec![first.id]
        )]
    );
    assert_eq!(
        catalog.project_references(&BTreeSet::new()).await.unwrap(),
        [] as [platevault_model::AssetReference; 0]
    );
    assert_eq!(tree(&world.fx.root), world.before, "no file changed");
    world.catalog.close().await.unwrap();
}
