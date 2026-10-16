// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's inputs (spec 065 PRJ-FR-02/04/05/08/09, PRJ-FR-25, PRJ-FR-27
//! to PRJ-FR-31; 066 VSEL-FR-10/12/15; D-W94 to D-W96, D-W100, D-W105,
//! D-W107, D-W109, D-W114) over real catalogs, FITS files and Views:
//! - a whole session joins only Ready and settled, atomically, at its basis,
//!   with its exact captures; nothing joins by itself and nothing is rekeyed;
//! - sessions group by rig, optics and framing with the intake margins, and
//!   the user's groups, splits, moves, names, panels and keywords hold;
//! - goals on panel groups and per-Project counts, with Target totals
//!   counting a session once;
//! - no edit touches the View: each reads as a pending change labelled with
//!   its source, and a Closed Project takes none.
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;

use apply_support::{catalogued, lights, meta, scan, World, AT, HA, HA_GAIN_0, OIII, OIII_FLATS};
use platevault_core::library::InventoryProbe;
use platevault_core::project_groups::{
    group_folders, place_sessions, require_distinct_folders, SessionToPlace,
};
use platevault_core::projects::SessionToAdd;
use platevault_core::*;
use uuid::Uuid;

// ── Fixtures ─────────────────────────────────────────────────────────────────

/// The shared Apply world without its hand-made group: INPUT's writer makes
/// the groups.
async fn world() -> World {
    let world = catalogued(ViewMode::Symlinks).await;
    let revision = desired(&world).await.revision;
    world.catalog().remove_project_group(world.project, revision, world.group).await.unwrap();
    world
}

async fn desired(world: &World) -> ProjectDesired {
    world.catalog().project_desired(world.project).await.unwrap()
}

async fn add_to(
    world: &World,
    project: Uuid,
    sessions: &[Uuid],
) -> Result<ProjectDesired, LibraryError> {
    let revision = world.catalog().project_desired(project).await.unwrap().revision;
    let adds: Vec<SessionToAdd> =
        sessions.iter().map(|id| SessionToAdd { session_id: *id, expected: None }).collect();
    world.library.add_project_sessions(project, revision, &adds, None).await
}

async fn add(world: &World, sessions: &[Uuid]) -> Result<ProjectDesired, LibraryError> {
    add_to(world, world.project, sessions).await
}

fn refusal(error: &LibraryError) -> &str {
    match error {
        LibraryError::InvalidInput(message) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Record the session's framing as intake would have split it.
async fn frame(world: &World, session: Uuid, framing: &SessionFraming) {
    world
        .sql(
            "UPDATE sessions SET framing = ?2 WHERE id = ?1",
            &[&session.to_string(), &serde_json::to_string(framing).unwrap()],
        )
        .await;
}

fn framing_at(anchor: Uuid, ra_deg: f64, rotator_deg: f64) -> SessionFraming {
    SessionFraming {
        ordinal: 1,
        anchor_asset_id: anchor,
        ra_deg,
        dec_deg: 44.3,
        rotator_deg: Some(rotator_deg),
        sky_angle_deg: None,
        field: Some(FieldOfView { width_deg: 3.0, height_deg: 2.0 }),
        label: None,
    }
}

async fn subject_target(world: &World, project: Uuid) -> Uuid {
    world.catalog().project(project).await.unwrap().subjects[0].target_id
}

async fn activity(world: &World, target: Uuid) -> TargetActivity {
    world.catalog().target_activity().await.unwrap().get(&target).cloned().unwrap()
}

fn ha_frames(target: Uuid, group: Option<Uuid>, goal_frames: u64) -> GoalInput {
    GoalInput {
        target_id: target,
        panel: None,
        group_id: group,
        goal: GoalSpec::FrameCount { channel: Some("Ha".into()), goal_frames },
    }
}

/// Close the Project as Wrap up does, skipping every step.
async fn close(world: &World, project: Uuid) {
    let id = project.to_string();
    for step in ["clean_up", "trash", "archive"] {
        world
            .sql(
                "INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) \
                 VALUES (?1, ?2, 'skipped', ?3)",
                &[&id, step, AT],
            )
            .await;
    }
    world
        .sql(
            "INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) \
             SELECT ?1, g, json_object('projectId', ?1, 'appliedGeneration', g), ?2 FROM \
             (SELECT max(generation) AS g FROM view_manifests WHERE project_id = ?1 \
             AND state IN ('installed', 'previous', 'retired'))",
            &[&id, AT],
        )
        .await;
    world
        .sql("UPDATE projects SET lifecycle = 'closed', closed_at = ?2 WHERE id = ?1", &[&id, AT])
        .await;
}

// ── Membership ───────────────────────────────────────────────────────────────

/// PRJ-FR-08, VSEL-FR-15, D16, D19: a Ready, settled session joins whole,
/// at its admission basis, with every live capture and each copy's decision
/// revision and observation; its Usable frames are included.
#[tokio::test]
async fn a_ready_settled_session_joins_whole_with_every_capture_and_copy() {
    let world = world().await;
    let session = world.admissible(HA[0]).await;
    let before = desired(&world).await;

    let after = add(&world, &[session.id]).await.unwrap();

    assert_eq!(after.revision, before.revision + 1, "one edit, one revision");
    let admission = world.catalog().session_admission(session.id).await.unwrap();
    let [member] = after.sessions.as_slice() else { panic!("{after:#?}") };
    assert_eq!(
        (member.session_id, member.grouping_revision, member.calibration_generation),
        (session.id, admission.intake.grouping_revision, admission.calibration.generation),
        "the session is held at the basis it was admitted on"
    );
    assert_eq!(member.placement, SessionPlacement::FramingUnknown, "its lights record no pointing");
    let [group] = after.groups.as_slice() else { panic!("{after:#?}") };
    assert_eq!(
        (group.name.as_str(), group.origin, group.rig_id, group.panel),
        ("RedCat 51", GroupOrigin::Framing, world.rig, false),
        "the rig's first group takes the rig's name"
    );
    assert_eq!(member.group_id, group.id);
    let assets = world.catalog().session(session.id).await.unwrap().assets;
    assert_eq!(after.captures.len(), assets.len(), "every frame of the session, none of another");
    for asset in &assets {
        let capture =
            after.captures.iter().find(|capture| capture.capture_key == asset.id).unwrap();
        assert_eq!(capture.session_id, session.id);
        assert_eq!(capture.inclusion, CaptureInclusion::Included { basis: InclusionBasis::Usable });
        assert_eq!(
            capture.copies,
            vec![CopyBasis {
                asset_id: asset.id,
                decision_revision: asset.decision_revision,
                fingerprint: asset.fingerprint.clone(),
            }]
        );
    }
}

/// PRJ-FR-08/09, LIB-FR-23, record §9 (provisional drift rule): an add is
/// refused unless every session is Ready and calibration-settled with no
/// drifted pin, all or none, and a refused add writes nothing.
#[tokio::test]
async fn an_add_is_refused_unless_ready_and_settled_and_a_refusal_writes_nothing() {
    let world = world().await;
    let ready = world.admissible(HA[0]).await;
    let before = desired(&world).await;

    let unreviewed = world.session_of(&world.captures, OIII[0]).await;
    let error = add(&world, &[ready.id, unreviewed.id]).await.unwrap_err();
    assert!(refusal(&error).contains("needs its review finished"), "{error}");
    assert_eq!(desired(&world).await, before, "the Ready session did not join alone either");

    let oiii = world.admissible(OIII[0]).await;
    world.pin(oiii.id, "flat", &PinState::Unresolved).await;
    let error = add(&world, &[oiii.id]).await.unwrap_err();
    assert!(refusal(&error).contains("calibration is not settled: choose its flat"), "{error}");

    world.pin(oiii.id, "flat", &world.raw_set(OIII_FLATS[0], "2026-10-13").await).await;
    let flat = world.session_of(&world.calibration, OIII_FLATS[0]).await;
    world
        .sql(
            "UPDATE assets SET availability = 'missing' WHERE id IN \
             (SELECT asset_id FROM session_members WHERE session_id = ?1)",
            &[&flat.id.to_string()],
        )
        .await;
    let error = add(&world, &[oiii.id]).await.unwrap_err();
    assert!(refusal(&error).contains("pinned flat changed or went missing"), "{error}");
    assert_eq!(desired(&world).await, before, "no refused add wrote anything");

    let held = add(&world, &[ready.id]).await.unwrap();
    let error = add(&world, &[ready.id]).await.unwrap_err();
    assert!(refusal(&error).contains("already in project"), "{error}");
    assert_eq!(desired(&world).await, held);
}

/// D08, D-W105: an add checks the basis the user saw and the Project
/// revision; either being stale is a conflict and writes nothing.
#[tokio::test]
async fn a_stale_basis_or_revision_is_a_conflict() {
    let world = world().await;
    let session = world.admissible(HA[0]).await;
    let before = desired(&world).await;
    let admission = world.catalog().session_admission(session.id).await.unwrap();
    let stale = AdmissionBasis {
        grouping_revision: admission.intake.grouping_revision,
        calibration_generation: admission.calibration.generation - 1,
    };
    let adds = [SessionToAdd { session_id: session.id, expected: Some(stale) }];
    let error =
        world.library.add_project_sessions(world.project, before.revision, &adds, None).await;
    assert!(matches!(error, Err(LibraryError::Conflict { .. })), "{error:?}");
    let adds = [SessionToAdd { session_id: session.id, expected: None }];
    let error =
        world.library.add_project_sessions(world.project, before.revision - 1, &adds, None).await;
    assert!(matches!(error, Err(LibraryError::Conflict { .. })), "{error:?}");
    assert_eq!(desired(&world).await, before);
}

/// PRJ-FR-09, VSEL-FR-12, D-W45: a matching session is only suggested,
/// never added; a session that needs review is not suggested; and when the
/// Library regroups a held session, the Project keeps exactly the frames it
/// chose and shows the change as the Library's, never moving to the new
/// frames by itself.
#[tokio::test]
async fn nothing_joins_by_itself_and_a_regroup_never_rekeys_held_frames() {
    let world = world().await;
    let ha = world.admissible(HA[0]).await;
    let held = add(&world, &[ha.id]).await.unwrap();
    let keys: Vec<Uuid> = held.captures.iter().map(|capture| capture.capture_key).collect();
    let oiii = world.admissible(OIII[0]).await;
    let new_night = world.session_of(&world.captures, HA_GAIN_0).await;

    let suggestions = world.catalog().project_suggestions(world.project).await.unwrap();
    let suggested: Vec<Uuid> = suggestions.iter().map(|suggestion| suggestion.session_id).collect();
    assert_eq!(suggested, vec![oiii.id], "the Ready match only, never the held or unreviewed one");
    assert!(suggestions[0].blockers.is_empty(), "it is settled, so it can be added");
    assert_ne!(new_night.id, oiii.id);
    assert_eq!(desired(&world).await, held, "a suggestion is never added by itself");

    world.apply().await;
    let root = world.captures.path.to_path_buf().unwrap();
    let mut frames = lights();
    frames.push((
        "2026-10-12/Light_003.fits".into(),
        meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12"),
    ));
    scan(&world.library, &world.captures, &root, &frames).await;
    let grown = world.asset_at(&world.captures, "2026-10-12/Light_003.fits").await;

    let after = desired(&world).await;
    assert_eq!(after.sessions, held.sessions, "the Project still holds the session it chose");
    let after_keys: Vec<Uuid> = after.captures.iter().map(|capture| capture.capture_key).collect();
    assert_eq!(after_keys, keys, "exactly the frames it chose");
    assert!(
        after
            .captures
            .iter()
            .all(|capture| capture.copies.iter().all(|copy| copy.asset_id != grown.id)),
        "the new frame joined no Project"
    );
    let pending = world.catalog().project_pending_changes(world.project).await.unwrap();
    let change = pending
        .iter()
        .find(|change| match change {
            PendingChange::SessionNotReady { session_id, .. }
            | PendingChange::SessionRegrouped { session_id, .. } => *session_id == ha.id,
            _ => false,
        })
        .unwrap_or_else(|| panic!("the regroup shows on the Project: {pending:#?}"));
    assert_eq!(change.source(), ChangeSource::Library);
    assert!(!change.discardable());
    assert!(
        pending.iter().all(|change| change.source() == ChangeSource::Library),
        "the Project itself changed nothing: {pending:#?}"
    );
}

// ── Groups ───────────────────────────────────────────────────────────────────

fn optics(focal_mm: f64) -> OpticsSignature {
    OpticsSignature::new(None, Some(focal_mm), None).unwrap()
}

fn evidence(ra_deg: f64, rotator_deg: Option<f64>, sky_angle_deg: Option<f64>) -> FramingEvidence {
    FramingEvidence {
        ra_deg,
        dec_deg: 44.3,
        rotator_deg,
        sky_angle_deg,
        field: Some(FieldOfView { width_deg: 3.0, height_deg: 2.0 }),
    }
}

fn to_place(
    n: u128,
    rig: (Uuid, &str),
    optics: OpticsSignature,
    framing: Option<FramingEvidence>,
) -> SessionToPlace {
    SessionToPlace {
        session_id: Uuid::from_u128(n),
        rig_id: rig.0,
        rig_name: rig.1.into(),
        optics,
        framing,
        expected: None,
    }
}

fn empty_project() -> ProjectDesired {
    ProjectDesired {
        project_id: Uuid::from_u128(99),
        revision: 1,
        lifecycle: ProjectLifecycle::Open,
        settings: ProjectViewSettings::default(),
        groups: Vec::new(),
        sessions: Vec::new(),
        captures: Vec::new(),
    }
}

/// PRJ-FR-27, PRJ-FR-31, D-W107: sessions group by rig, optics and framing
/// with the intake margins (centre within 5 % of the 3.6° field diagonal,
/// rotation within 5°), anchors compared non-transitively; a session without
/// pointing joins its rig's group flagged Framing unknown; new groups take
/// the rig's name, then "<Rig> · Framing N".
#[test]
fn sessions_group_by_rig_optics_and_framing_without_chaining() {
    let redcat = (Uuid::from_u128(1), "RedCat");
    let esprit = (Uuid::from_u128(2), "Esprit 100");
    let sessions = [
        to_place(10, redcat, optics(250.0), Some(evidence(100.0, Some(10.0), None))),
        // 0.14° from the anchor (5 % of the field's 3.6° diagonal is 0.18°)
        // and 3° turned: the same framing.
        to_place(11, redcat, optics(250.0), Some(evidence(100.2, Some(13.0), None))),
        // 0.29° from the anchor, 0.14° from the session before: no chain.
        to_place(12, redcat, optics(250.0), Some(evidence(100.4, Some(10.0), None))),
        // Same centre, ROTATANG 8° apart: another framing.
        to_place(13, redcat, optics(250.0), Some(evidence(100.0, Some(18.0), None))),
        // No pointing: the rig's first group of these optics.
        to_place(14, redcat, optics(250.0), None),
        // New optics on the same rig: a new group.
        to_place(15, redcat, optics(400.0), Some(evidence(100.0, Some(10.0), None))),
        // Another rig.
        to_place(16, esprit, optics(250.0), Some(evidence(100.0, Some(10.0), None))),
    ];
    let margins = FramingMargins::default();
    let plan = place_sessions(&empty_project(), &sessions, &margins).unwrap();
    let names: Vec<&str> = plan.groups.iter().map(|group| group.name.as_str()).collect();
    assert_eq!(
        names,
        ["RedCat", "RedCat · Framing 2", "RedCat · Framing 3", "RedCat · Framing 4", "Esprit 100"]
    );
    let group_of = |n: u128| {
        let add = plan.adds.iter().find(|add| add.session_id == Uuid::from_u128(n)).unwrap();
        let name = plan.groups.iter().find(|group| group.id == add.group_id).unwrap();
        (name.name.as_str(), add.placement)
    };
    assert_eq!(group_of(10), ("RedCat", SessionPlacement::Framing));
    assert_eq!(group_of(11), ("RedCat", SessionPlacement::Framing));
    assert_eq!(group_of(12), ("RedCat · Framing 2", SessionPlacement::Framing));
    assert_eq!(group_of(13), ("RedCat · Framing 3", SessionPlacement::Framing));
    assert_eq!(group_of(14), ("RedCat", SessionPlacement::FramingUnknown));
    assert_eq!(group_of(15), ("RedCat · Framing 4", SessionPlacement::Framing));
    assert_eq!(group_of(16), ("Esprit 100", SessionPlacement::Framing));
    assert!(plan.groups.iter().all(|group| group.origin == GroupOrigin::Framing));

    // With only the sky angle known, 180° apart is the same framing; a
    // meridian flip leaves ROTATANG alone, so ROTATANG 180° apart is not.
    let flipped = [
        to_place(20, redcat, optics(250.0), Some(evidence(50.0, None, Some(30.0)))),
        to_place(21, redcat, optics(250.0), Some(evidence(50.0, None, Some(210.0)))),
        to_place(22, esprit, optics(250.0), Some(evidence(50.0, Some(30.0), None))),
        to_place(23, esprit, optics(250.0), Some(evidence(50.0, Some(210.0), None))),
    ];
    let plan = place_sessions(&empty_project(), &flipped, &margins).unwrap();
    let names: Vec<&str> = plan.groups.iter().map(|group| group.name.as_str()).collect();
    assert_eq!(names, ["RedCat", "Esprit 100", "Esprit 100 · Framing 2"]);
}

/// D-W114, PRJ-FR-27/28: names that would share a folder are refused, a
/// one-group Project has no group folder, and several groups get GROUP_ or,
/// for a panel, only PANEL_ folders with hyphenated names.
#[test]
fn group_folders_are_distinct_hyphenated_and_only_with_several_groups() {
    let split = GroupName::new("RedCat 51 · 2").unwrap();
    let clash = GroupName::new("RedCat 51: 2").unwrap();
    let error = require_distinct_folders([&split, &clash]).unwrap_err();
    assert!(refusal(&error).contains("would share one folder"), "{error}");

    let group = |name: &str, panel: bool, position: u32| ProjectGroup {
        id: Uuid::from_u128(u128::from(position) + 1),
        rig_id: Uuid::from_u128(1),
        name: GroupName::new(name).unwrap(),
        panel,
        origin: GroupOrigin::Framing,
        optics: optics(250.0),
        framing: None,
        position,
    };
    let mut project = empty_project();
    project.groups.push(group("Panel 1", true, 0));
    let keywords = GroupKeywords::default();
    assert_eq!(group_folders(&project, &keywords).unwrap(), vec![(Uuid::from_u128(1), None)]);
    project.groups.push(group("RedCat 51 · Framing 2", false, 1));
    let folders: Vec<Option<String>> =
        group_folders(&project, &keywords).unwrap().into_iter().map(|(_, f)| f).collect();
    assert_eq!(folders, [Some("PANEL_Panel-1".into()), Some("GROUP_RedCat-51-Framing-2".into())]);
}

/// PRJ-FR-27/28/29/31: sessions with two framings form two named groups;
/// the user's split, rename, move, panel mark and keyword names hold, and a
/// later add only ever joins framing groups.
#[tokio::test]
async fn manual_groups_names_panels_and_keywords_hold() {
    let world = world().await;
    let ha = world.admissible(HA[0]).await;
    let oiii = world.admissible(OIII[0]).await;
    let anchor = |session: &Session| session.asset_ids[0];
    frame(&world, ha.id, &framing_at(anchor(&ha), 314.0, 10.0)).await;
    frame(&world, oiii.id, &framing_at(anchor(&oiii), 316.5, 10.0)).await;

    let added = add(&world, &[ha.id, oiii.id]).await.unwrap();
    let names: Vec<&str> = added.groups.iter().map(|group| group.name.as_str()).collect();
    assert_eq!(names, ["RedCat 51", "RedCat 51 · Framing 2"]);
    let (first, second) = (added.groups[0].id, added.groups[1].id);
    let inputs = world.library.project_inputs(world.project).await.unwrap();
    let folders: Vec<Option<&str>> =
        inputs.folders.iter().map(|folder| folder.folder.as_deref()).collect();
    assert_eq!(folders, [Some("GROUP_RedCat-51"), Some("GROUP_RedCat-51-Framing-2")]);

    let marked = world
        .library
        .set_project_group_panel(world.project, added.revision, second, true, None)
        .await
        .unwrap();
    let panel = marked.groups.iter().find(|group| group.id == second).unwrap();
    assert_eq!((panel.name.as_str(), panel.panel), ("Panel 1", true), "a mosaic panel's default");
    let mut settings = marked.settings.clone();
    settings.keywords = Some(GroupKeywords::new("SET", "TILE").unwrap());
    let keyed = world
        .catalog()
        .set_project_view_settings(world.project, marked.revision, &settings)
        .await
        .unwrap();
    let inputs = world.library.project_inputs(world.project).await.unwrap();
    let folders: Vec<Option<&str>> =
        inputs.folders.iter().map(|folder| folder.folder.as_deref()).collect();
    assert_eq!(folders, [Some("SET_RedCat-51"), Some("TILE_Panel-1")], "the Project's keywords");

    let split = world
        .library
        .split_project_group(world.project, keyed.revision, first, &[ha.id], None)
        .await
        .unwrap();
    let names: Vec<&str> = split.groups.iter().map(|group| group.name.as_str()).collect();
    assert_eq!(names, ["Panel 1", "RedCat 51 · 2"], "the emptied framing group went");
    let user = split.groups.iter().find(|group| group.name.as_str() == "RedCat 51 · 2").unwrap();
    assert_eq!(user.origin, GroupOrigin::User);
    let member = split.sessions.iter().find(|member| member.session_id == ha.id).unwrap();
    assert_eq!((member.group_id, member.placement), (user.id, SessionPlacement::User));

    let error = world
        .library
        .rename_project_group(world.project, split.revision, second, "RedCat 51: 2")
        .await
        .unwrap_err();
    assert!(refusal(&error).contains("would share one folder"), "{error}");
    let renamed = world
        .library
        .rename_project_group(world.project, split.revision, user.id, "Ha night one")
        .await
        .unwrap();
    assert!(renamed.groups.iter().any(|group| group.name.as_str() == "Ha night one"));

    // A later session without pointing joins a framing group, never the
    // user's group.
    let gain = world.admissible(HA_GAIN_0).await;
    let later = add(&world, &[gain.id]).await.unwrap();
    let member = later.sessions.iter().find(|member| member.session_id == gain.id).unwrap();
    assert_eq!((member.group_id, member.placement), (second, SessionPlacement::FramingUnknown));
    let member = later.sessions.iter().find(|member| member.session_id == ha.id).unwrap();
    assert_eq!(member.group_id, user.id, "the user's move survives");

    let moved = world
        .catalog()
        .move_project_sessions(world.project, later.revision, &[gain.id], user.id)
        .await
        .unwrap();
    let member = moved.sessions.iter().find(|member| member.session_id == gain.id).unwrap();
    assert_eq!((member.group_id, member.placement), (user.id, SessionPlacement::User));
}

// ── Goals and counts ─────────────────────────────────────────────────────────

/// PRJ-FR-03/04/29, D-W96: each Project counts its own sessions, so a session
/// two Projects hold counts in each, while the Target's totals count it once;
/// a Project's exclusion counts only there; a suggestion is captured, not in
/// project; a panel group's goal counts that group only.
#[tokio::test]
async fn each_project_counts_its_own_sessions_and_the_target_counts_them_once() {
    let world = world().await;
    let target = subject_target(&world, world.project).await;
    let before = activity(&world, target).await;
    let other = world
        .catalog()
        .create_project(&ProjectInput {
            name: "NGC 7000 again".into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: target,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![world.rig],
            goals: vec![ha_frames(target, None, 10)],
        })
        .await
        .unwrap();
    let ha = world.admissible(HA[0]).await;
    let one = add(&world, &[ha.id]).await.unwrap();
    let two = add_to(&world, other.id, &[ha.id]).await.unwrap();
    let goals = vec![ha_frames(target, None, 10)];
    world.catalog().set_project_goals(world.project, one.revision, &goals).await.unwrap();

    let ha_goal = |progress: &ProjectProgress| progress.goals[0].clone();
    let first = ha_goal(&world.library.project_progress(world.project).await.unwrap());
    let second = ha_goal(&world.library.project_progress(other.id).await.unwrap());
    assert_eq!((first.in_project.frames, second.in_project.frames), (2, 2), "counted in each");
    assert_eq!(activity(&world, target).await, before, "the Target's totals count it once");

    let excluded = two.captures[0].capture_key;
    world
        .catalog()
        .set_project_frames(other.id, two.revision, &[excluded], FrameChoice::Exclude)
        .await
        .unwrap();
    let second = ha_goal(&world.library.project_progress(other.id).await.unwrap());
    assert_eq!(
        (second.in_project.frames, second.captured.frames),
        (1, 2),
        "excluded, still captured"
    );
    let first = ha_goal(&world.library.project_progress(world.project).await.unwrap());
    assert_eq!(first.in_project.frames, 2, "an exclusion is this Project's only");

    // A Ready match the Project doesn't hold is captured, never in project.
    world.admissible(OIII[0]).await;
    let revision = desired(&world).await.revision;
    let oiii_goal = GoalInput {
        target_id: target,
        panel: None,
        group_id: None,
        goal: GoalSpec::FrameCount { channel: Some("OIII".into()), goal_frames: 10 },
    };
    world
        .catalog()
        .set_project_goals(
            world.project,
            revision,
            &[ha_frames(target, None, 10), oiii_goal.clone()],
        )
        .await
        .unwrap();
    let progress = world.library.project_progress(world.project).await.unwrap();
    let oiii = &progress.goals[1];
    assert_eq!((oiii.in_project.frames, oiii.captured.frames), (0, 2), "a suggestion is captured");

    // A goal belongs to a mosaic panel group, and counts that group only.
    let state = desired(&world).await;
    let group = state.groups[0].id;
    let error = world
        .catalog()
        .set_project_goals(world.project, state.revision, &[ha_frames(target, Some(group), 4)])
        .await
        .unwrap_err();
    assert!(refusal(&error).contains("not a mosaic panel"), "{error}");
    let marked = world
        .library
        .set_project_group_panel(world.project, state.revision, group, true, None)
        .await
        .unwrap();
    world
        .catalog()
        .set_project_goals(world.project, marked.revision, &[ha_frames(target, Some(group), 4)])
        .await
        .unwrap();
    let panel = &world.library.project_progress(world.project).await.unwrap().goals[0];
    assert_eq!((panel.goal.group_id, panel.in_project.frames), (Some(group), 2));
    let revision = desired(&world).await.revision;
    let error = world
        .catalog()
        .set_project_group_panel(world.project, revision, group, false, None)
        .await
        .unwrap_err();
    assert!(refusal(&error).contains("stays a panel"), "{error}");
}

// ── Pending changes ──────────────────────────────────────────────────────────

/// PRJ-FR-05, VSEL-FR-12, D-W100, D-W109, LIB-FR-20 and the record's answer
/// on Library changes: once the View exists, no edit touches it; each edit
/// reads as the Project's own pending change, which it can discard, and a
/// Library rejection, a reassigned calibration and a reopened review read as
/// the Library's, which it can't. A Closed Project takes none of them.
#[tokio::test]
async fn edits_never_touch_the_view_and_read_as_pending_changes_by_source() {
    let world = world().await;
    let ha = world.admissible(HA[0]).await;
    let added = add(&world, &[ha.id]).await.unwrap();
    assert!(
        world.catalog().project_pending_changes(world.project).await.unwrap().is_empty(),
        "before the first Apply there is no View to change"
    );
    world.apply().await;
    let tree = World::tree(&world.view());
    let installed = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    assert!(world.catalog().project_pending_changes(world.project).await.unwrap().is_empty());

    let state = desired(&world).await;
    let (excluded, rejected) = (added.captures[0].capture_key, added.captures[1].capture_key);
    let group = state.groups[0].id;
    let state = world
        .catalog()
        .set_project_frames(world.project, state.revision, &[excluded], FrameChoice::Exclude)
        .await
        .unwrap();
    let state = world
        .library
        .rename_project_group(world.project, state.revision, group, "Ha nights")
        .await
        .unwrap();
    let mut settings = state.settings.clone();
    settings.mode = ViewMode::Copies;
    world
        .catalog()
        .set_project_view_settings(world.project, state.revision, &settings)
        .await
        .unwrap();
    let oiii = world.admissible(OIII[0]).await;
    add(&world, &[oiii.id]).await.unwrap();

    let own = world.catalog().project_pending_changes(world.project).await.unwrap();
    let ha_name = GroupName::new("RedCat 51").unwrap();
    let expected = [
        PendingChange::ModeSwitched { from: ViewMode::Symlinks, to: ViewMode::Copies },
        PendingChange::GroupRenamed {
            group_id: group,
            from: ha_name,
            to: GroupName::new("Ha nights").unwrap(),
        },
        PendingChange::FramesExcluded { session_id: ha.id, capture_keys: vec![excluded] },
        PendingChange::SessionAdded { session_id: oiii.id, group_id: group },
    ];
    assert_eq!(own.len(), expected.len(), "{own:#?}");
    for change in &expected {
        assert!(own.contains(change), "missing {change:?} in {own:#?}");
    }
    assert!(own
        .iter()
        .all(|change| change.source() == ChangeSource::Project && change.discardable()));

    let asset = world
        .catalog()
        .session(ha.id)
        .await
        .unwrap()
        .assets
        .into_iter()
        .find(|asset| asset.id == rejected)
        .unwrap();
    let mark = ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    };
    world
        .catalog()
        .set_quality(&[mark], Quality::Unusable, InventoryProbe::default())
        .await
        .unwrap();
    world.pin(ha.id, "dark", &PinState::Declined { origin: DeclineOrigin::User }).await;
    world.catalog().reopen_session_review(ha.id).await.unwrap();

    let all = world.catalog().project_pending_changes(world.project).await.unwrap();
    let library: Vec<&PendingChange> =
        all.iter().filter(|change| change.source() == ChangeSource::Library).collect();
    assert!(
        library.contains(&&PendingChange::LibraryRejected {
            session_id: ha.id,
            capture_keys: vec![rejected]
        }),
        "{all:#?}"
    );
    assert!(
        library.contains(&&PendingChange::SessionNotReady {
            session_id: ha.id,
            readiness: SessionReadiness::NeedsReview,
        }),
        "{all:#?}"
    );
    assert!(
        library.iter().any(|change| matches!(
            change,
            PendingChange::CalibrationChanged {
                session_id,
                kind: InputKind::Dark,
                to: Some(SettledPin::Declined),
                ..
            } if *session_id == ha.id
        )),
        "{all:#?}"
    );
    assert!(
        library.iter().all(|change| !change.discardable()),
        "fixed at its source: {library:#?}"
    );
    for change in &expected {
        assert!(all.contains(change), "the Project's own edits stay: {all:#?}");
    }

    assert_eq!(World::tree(&world.view()), tree, "no edit or Library change touched the View");
    let still = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    assert_eq!(
        serde_json::to_value(&still).unwrap(),
        serde_json::to_value(&installed).unwrap(),
        "the installed manifest is unchanged"
    );

    close(&world, world.project).await;
    assert!(
        world.catalog().project_pending_changes(world.project).await.unwrap().is_empty(),
        "a Closed Project takes no pending change"
    );
    assert!(world.catalog().project_suggestions(world.project).await.unwrap().is_empty());
    let revision = desired(&world).await.revision;
    let error = world
        .catalog()
        .set_project_frames(world.project, revision, &[excluded], FrameChoice::FollowLibrary)
        .await
        .unwrap_err();
    assert!(refusal(&error).contains("takes no edit"), "{error}");
}
