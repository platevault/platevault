// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A held session that isn't Ready holds Apply back (spec 063 FR-034, 064
//! LIB-AC-22, LIB-AC-36, LIB-FR-09, 066 VSEL-FR-12; D-W100, D-W140; owner's
//! answers of 2026-10-19 and 2026-10-20), over real catalogs and files:
//! - a frame set back to Unreviewed in a reopened review reaches every open
//!   Project holding the session as a pending change labelled with its
//!   source, the session reads Needs review there, and Apply refuses and
//!   changes nothing until the session is Ready again; a Closed or Archived
//!   Project is untouched;
//! - a frame whose bytes changed after review sets its session back to Needs
//!   review: Apply waits in the Project holding it, with no pending change;
//! - a grouping correction that re-splits a held session leaves every
//!   successor in each open Project holding it, labelled as a pending
//!   change: each successor reads Needs review until it is Ready, Apply
//!   waits until every one is, and no frame leaves the Project; a Closed or
//!   Archived Project keeps the session it holds.

#[path = "support/apply.rs"]
mod apply_support;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use apply_support::{
    catalogued, lights, scan_files, sep24_frame, world, World, AT, HA, OIII, SEP24,
};
use platevault_core::apply::Unattended;
use platevault_core::library::InventoryProbe;
use platevault_core::projects::SessionToAdd;
use platevault_core::*;
use uuid::Uuid;

/// A second Project on the world's subject and rig, named `name`, in the
/// world's processing location, holding `session`.
async fn project_holding(world: &World, name: &str, session: Uuid) -> Uuid {
    let subject = world.catalog().project(world.project).await.unwrap().subjects[0].target_id;
    let project = world
        .catalog()
        .create_project(&ProjectInput {
            name: name.into(),
            notes: None,
            subjects: vec![SubjectInput { target_id: subject, name: None }],
            rig_ids: vec![world.rig],
            goals: Vec::new(),
        })
        .await
        .unwrap()
        .id;
    let parent = serde_json::to_string(&NativePath::from_path(&world.parent)).unwrap();
    world
        .sql(
            "UPDATE projects SET processing_parent = ?2 WHERE id = ?1",
            &[&project.to_string(), &parent],
        )
        .await;
    let revision = world.catalog().project_desired(project).await.unwrap().revision;
    world
        .library
        .add_project_sessions(
            project,
            revision,
            &[SessionToAdd { session_id: session, expected: None }],
            None,
        )
        .await
        .unwrap();
    project
}

async fn preview(world: &World, project: Uuid) -> ApplyPreview {
    world.library.apply_preview(project).await.unwrap()
}

async fn apply(world: &World, project: Uuid) -> Result<ApplyReport, LibraryError> {
    let sheet = preview(world, project).await;
    world.library.apply(&World::request(&sheet), &Unattended).await
}

/// Lock `project` as Wrap up does: every step recorded, the snapshot taken,
/// then Closed, or Closing and then Archived.
async fn lock(world: &World, project: Uuid, lifecycle: ProjectLifecycle) {
    let id = project.to_string();
    let archive = if lifecycle == ProjectLifecycle::Archived { "finished" } else { "skipped" };
    for (step, outcome) in [("clean_up", "skipped"), ("trash", "skipped"), ("archive", archive)] {
        world
            .sql(
                "INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) \
                 VALUES (?1, ?2, ?3, ?4)",
                &[&id, step, outcome, AT],
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
    if lifecycle == ProjectLifecycle::Archived {
        world
            .sql(
                "UPDATE projects SET lifecycle = 'closing', closed_at = ?2 WHERE id = ?1",
                &[&id, AT],
            )
            .await;
        world.sql("UPDATE projects SET lifecycle = 'archived' WHERE id = ?1", &[&id]).await;
    } else {
        world
            .sql(
                "UPDATE projects SET lifecycle = 'closed', closed_at = ?2 WHERE id = ?1",
                &[&id, AT],
            )
            .await;
    }
}

/// Set the light at `path` to `quality`, as a review mark does.
async fn mark(world: &World, path: &str, quality: Quality) {
    let asset = world.asset_at(&world.captures, path).await;
    let expected = ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    };
    world.catalog().set_quality(&[expected], quality, InventoryProbe::default()).await.unwrap();
}

async fn readiness(world: &World, session: Uuid) -> SessionReadiness {
    world.catalog().session_admission(session).await.unwrap().intake.readiness()
}

/// What an Apply that changed nothing leaves as it was: the View's files,
/// the installed manifest and the Project revision, with no operation
/// running.
async fn untouched(world: &World, project: Uuid, view: &Path) -> (Vec<String>, String, Revision) {
    let inputs = world.catalog().apply_inputs(project).await.unwrap();
    assert!(inputs.running.is_none(), "no operation was reserved");
    let installed = serde_json::to_string(&inputs.installed.unwrap()).unwrap();
    (World::tree(view), installed, inputs.desired_revision)
}

fn not_ready(session: Uuid) -> ApplyBlocker {
    ApplyBlocker::SessionNotReady { session_id: session, readiness: SessionReadiness::NeedsReview }
}

/// LIB-AC-22, VSEL-FR-12, FR-034 (D-W100; owner's answer, 2026-10-19).
#[tokio::test]
#[allow(clippy::too_many_lines, reason = "one scenario across four Projects")]
async fn a_reopened_review_reaches_every_open_project_and_apply_waits_until_ready() {
    let world = world(ViewMode::Symlinks).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    let other = project_holding(&world, "NGC 7000 again", ha.id).await;
    let closed = project_holding(&world, "NGC 7000 closed", ha.id).await;
    let archived = project_holding(&world, "NGC 7000 archived", ha.id).await;
    world.apply().await;
    for project in [other, closed, archived] {
        assert_eq!(apply(&world, project).await.unwrap().outcome, Some(ApplyOutcome::Applied));
    }
    lock(&world, closed, ProjectLifecycle::Closed).await;
    lock(&world, archived, ProjectLifecycle::Archived).await;
    let folder = |name: &str| world.parent.join(name).join("View");
    let open = [(world.project, world.view()), (other, folder("NGC 7000 again"))];
    let locked = [
        (closed, ProjectLifecycle::Closed, folder("NGC 7000 closed")),
        (archived, ProjectLifecycle::Archived, folder("NGC 7000 archived")),
    ];
    let mut before = Vec::new();
    for (project, _, view) in &locked {
        before.push(untouched(&world, *project, view).await);
    }
    let sheet = preview(&world, world.project).await;
    assert!(sheet.blockers.is_empty(), "{:#?}", sheet.blockers);

    world.catalog().reopen_session_review(ha.id).await.unwrap();
    mark(&world, HA[0], Quality::Unreviewed).await;
    assert_eq!(readiness(&world, ha.id).await, SessionReadiness::NeedsReview);

    for (project, _) in &open {
        let changes = world.catalog().project_pending_changes(*project).await.unwrap();
        let held = PendingChange::SessionNotReady {
            session_id: ha.id,
            readiness: SessionReadiness::NeedsReview,
        };
        assert!(changes.contains(&held), "{project}: the session reads Needs review: {changes:#?}");
        assert_eq!(changes.len(), 1, "{project}: the Unreviewed frame is no removal: {changes:#?}");
        assert_eq!(changes[0].source(), ChangeSource::Library, "labelled with its source");
        assert!(!changes[0].discardable(), "fixed at its source");
    }
    for ((project, lifecycle, view), was) in locked.iter().zip(&before) {
        assert_eq!(
            world.catalog().project_pending_changes(*project).await.unwrap(),
            Vec::<PendingChange>::new(),
            "a {lifecycle:?} Project takes no pending change"
        );
        assert_eq!(
            preview(&world, *project).await.blockers,
            [ApplyBlocker::ProjectLocked { lifecycle: *lifecycle }],
            "the session's review never reaches a {lifecycle:?} Project"
        );
        assert_eq!(&untouched(&world, *project, view).await, was, "{lifecycle:?} is untouched");
    }

    // The sheet opened while the session was Ready no longer matches.
    let stale = world.library.apply(&World::request(&sheet), &Unattended).await.unwrap_err();
    assert_eq!(stale.code(), LibraryErrorCode::Conflict, "{stale:?}");
    for (project, view) in &open {
        let was = untouched(&world, *project, view).await;
        let sheet = preview(&world, *project).await;
        assert!(sheet.blockers.contains(&not_ready(ha.id)), "{:#?}", sheet.blockers);
        let refused = apply(&world, *project).await.unwrap_err();
        assert_eq!(refused.code(), LibraryErrorCode::SessionNotReady, "{refused:?}");
        assert_eq!(refused.response(None, None).identity, Some(ha.id));
        assert_eq!(untouched(&world, *project, view).await, was, "a refused Apply changes nothing");
    }

    mark(&world, HA[0], Quality::Usable).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    world.catalog().finish_session_review(ha.id, ha.grouping_revision).await.unwrap();
    assert_eq!(readiness(&world, ha.id).await, SessionReadiness::Ready);
    for (project, _) in &open {
        assert_eq!(
            world.catalog().project_pending_changes(*project).await.unwrap(),
            Vec::<PendingChange>::new(),
            "Ready again, nothing is pending"
        );
        assert_eq!(apply(&world, *project).await.unwrap().outcome, Some(ApplyOutcome::Applied));
    }
}

/// Write `bytes` over a file in place, keeping its size and mtime.
fn rewrite_same_stat(path: &Path, bytes: &[u8]) {
    assert_eq!(fs::metadata(path).unwrap().len(), bytes.len() as u64);
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    fs::write(path, bytes).unwrap();
    fs::File::options().write(true).open(path).unwrap().set_modified(modified).unwrap();
}

/// Rescan the captures as they are on disk, rehashing every light.
async fn rescan(world: &World) {
    let frames: Vec<(String, CaptureMetadata, Vec<u8>)> = lights()
        .into_iter()
        .map(|(relative, metadata)| {
            let bytes = fs::read(world.light(&relative)).unwrap();
            (relative, metadata, bytes)
        })
        .collect();
    let root = world.captures.path.to_path_buf().unwrap();
    scan_files(&world.library, &world.captures, &root, &frames).await;
}

/// LIB-AC-36, LIB-FR-09 (D-W140; owner's answer, 2026-10-20).
#[tokio::test]
async fn a_frame_changed_after_review_holds_apply_back_with_no_pending_change() {
    let world = world(ViewMode::Symlinks).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    world.apply().await;
    let light = world.light(HA[0]);
    let reviewed = fs::read(&light).unwrap();
    let mut changed = reviewed.clone();
    *changed.last_mut().unwrap() ^= 0xff;
    rewrite_same_stat(&light, &changed);
    rescan(&world).await;
    assert!(matches!(
        world.asset_at(&world.captures, HA[0]).await.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    ));
    assert_eq!(readiness(&world, ha.id).await, SessionReadiness::NeedsReview);
    assert_eq!(
        world.catalog().project_pending_changes(world.project).await.unwrap(),
        Vec::<PendingChange>::new(),
        "a content change is not a pending change"
    );
    let was = untouched(&world, world.project, &world.view()).await;
    let sheet = world.preview().await;
    assert!(sheet.blockers.contains(&not_ready(ha.id)), "{:#?}", sheet.blockers);
    let refused = world.library.apply(&World::request(&sheet), &Unattended).await.unwrap_err();
    assert_eq!(refused.code(), LibraryErrorCode::SessionNotReady, "{refused:?}");
    assert_eq!(untouched(&world, world.project, &world.view()).await, was);

    rewrite_same_stat(&light, &reviewed);
    rescan(&world).await;
    assert_eq!(readiness(&world, ha.id).await, SessionReadiness::Ready);
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
}

/// The Project's held sessions and capture keys.
async fn holds(world: &World, project: Uuid) -> (BTreeSet<Uuid>, BTreeSet<Uuid>) {
    let desired = world.catalog().project_desired(project).await.unwrap();
    (
        desired.sessions.iter().map(|member| member.session_id).collect(),
        desired.captures.iter().map(|capture| capture.capture_key).collect(),
    )
}

/// The lights the Project's installed View places, by capture key.
async fn placed_lights(world: &World, project: Uuid) -> BTreeSet<Uuid> {
    let installed = world.catalog().apply_inputs(project).await.unwrap().installed.unwrap();
    installed
        .entries
        .iter()
        .filter_map(|entry| match entry.source {
            EntrySource::Light { capture_key, .. } => Some(capture_key),
            _ => None,
        })
        .collect()
}

/// Every pending change of `project` is the Library's, fixed at its source.
/// A successor whose calibration isn't chosen again yet, one of `waiting`,
/// reads its calibration changed; those changes are left out.
async fn library_changes(world: &World, project: Uuid, waiting: &[Uuid]) -> Vec<PendingChange> {
    let mut changes = world.catalog().project_pending_changes(project).await.unwrap();
    for change in &changes {
        assert_eq!(change.source(), ChangeSource::Library, "{project}: {change:?}");
        assert!(!change.discardable(), "{project}: {change:?}");
    }
    changes.retain(|change| match change {
        PendingChange::CalibrationChanged { session_id, .. } => {
            assert!(waiting.contains(session_id), "{project}: {change:?}");
            false
        }
        _ => true,
    });
    changes
}

/// LIB-FR-12, VSEL-FR-12, FR-034 (D-W100; owner's answer, 2026-10-19,
/// `resplit_held`: "Every successor stays in the Project, each labelled as a
/// pending change. Apply waits until every successor is Ready. No frame
/// silently leaves the Project.").
#[tokio::test]
#[allow(clippy::too_many_lines, reason = "one scenario across four Projects")]
async fn a_resplit_held_session_stays_whole_and_apply_waits_for_every_successor() {
    // The Ha night holds J23's 24 Sep light too, an image a patched copy can
    // carry a corrected header on.
    let world = catalogued(ViewMode::Symlinks).await;
    world.add_lights(&[sep24_frame()]).await;
    world.hold(HA[0]).await;
    world.hold(OIII[0]).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    assert_eq!(world.session_of(&world.captures, SEP24).await.id, ha.id);
    let other = project_holding(&world, "NGC 7000 again", ha.id).await;
    let closed = project_holding(&world, "NGC 7000 closed", ha.id).await;
    let archived = project_holding(&world, "NGC 7000 archived", ha.id).await;
    world.apply().await;
    for project in [other, closed, archived] {
        assert_eq!(apply(&world, project).await.unwrap().outcome, Some(ApplyOutcome::Applied));
    }
    lock(&world, closed, ProjectLifecycle::Closed).await;
    lock(&world, archived, ProjectLifecycle::Archived).await;
    let folder = |name: &str| world.parent.join(name).join("View");
    let open = [(world.project, world.view()), (other, folder("NGC 7000 again"))];
    let locked = [
        (closed, ProjectLifecycle::Closed, folder("NGC 7000 closed")),
        (archived, ProjectLifecycle::Archived, folder("NGC 7000 archived")),
    ];
    let mut before = Vec::new();
    for (project, _, view) in &locked {
        before.push((untouched(&world, *project, view).await, holds(&world, *project).await));
    }
    let mut frames = Vec::new();
    for (project, _) in &open {
        let (sessions, keys) = holds(&world, *project).await;
        assert!(sessions.contains(&ha.id));
        frames.push((sessions, keys, placed_lights(&world, *project).await));
    }

    // A grouping correction splits the Ha night in two.
    world.correct(SEP24, &[("gain", serde_json::json!(120.0))]).await;
    let first = world.session_of(&world.captures, SEP24).await.id;
    let second = world.session_of(&world.captures, HA[0]).await.id;
    assert_eq!(world.session_of(&world.captures, HA[1]).await.id, second);
    let successors: BTreeSet<Uuid> = [first, second].into();
    assert_eq!(successors.len(), 2, "the night was split");
    assert!(!successors.contains(&ha.id), "both are successors");
    let regrouped = PendingChange::SessionRegrouped {
        session_id: ha.id,
        successors: successors.iter().copied().collect(),
    };
    let needs_review = |session_id| PendingChange::SessionNotReady {
        session_id,
        readiness: SessionReadiness::NeedsReview,
    };
    for successor in &successors {
        assert_eq!(readiness(&world, *successor).await, SessionReadiness::NeedsReview);
    }
    // The session the Project holds in place of the Ha night: its successors.
    let carried = |sessions: &BTreeSet<Uuid>| -> BTreeSet<Uuid> {
        sessions.iter().copied().filter(|id| *id != ha.id).chain(successors.clone()).collect()
    };

    for ((project, _), (held, keys, _)) in open.iter().zip(&frames) {
        let (sessions, captures) = holds(&world, *project).await;
        assert_eq!(sessions, carried(held), "{project} holds every successor in place of Ha");
        assert_eq!(&captures, keys, "{project}: no frame left the Project");
        let changes = library_changes(&world, *project, &[first, second]).await;
        assert!(changes.contains(&regrouped), "{project}: labelled: {changes:#?}");
        for successor in &successors {
            assert!(changes.contains(&needs_review(*successor)), "{project}: {changes:#?}");
        }
        assert_eq!(changes.len(), 3, "{project}: nothing else is pending: {changes:#?}");
    }
    for ((project, lifecycle, view), (was, held)) in locked.iter().zip(&before) {
        assert_eq!(
            world.catalog().project_pending_changes(*project).await.unwrap(),
            Vec::<PendingChange>::new(),
            "a {lifecycle:?} Project takes no pending change"
        );
        assert_eq!(
            preview(&world, *project).await.blockers,
            [ApplyBlocker::ProjectLocked { lifecycle: *lifecycle }],
        );
        assert_eq!(
            &holds(&world, *project).await,
            held,
            "a {lifecycle:?} Project keeps its session"
        );
        assert_eq!(&untouched(&world, *project, view).await, was, "{lifecycle:?} is untouched");
    }

    // The Project's own edit on a successor is discardable, and discarding
    // it leaves the regroup pending.
    let excluded = world.asset_at(&world.captures, HA[1]).await.id;
    let revision = world.catalog().project_desired(other).await.unwrap().revision;
    world
        .catalog()
        .set_project_frames(other, revision, &[excluded], FrameChoice::Exclude)
        .await
        .unwrap();
    let changes = world.catalog().project_pending_changes(other).await.unwrap();
    let own = PendingChange::FramesExcluded { session_id: second, capture_keys: vec![excluded] };
    assert!(changes.contains(&own), "{changes:#?}");
    let revision = world.catalog().project_desired(other).await.unwrap().revision;
    world.catalog().discard_project_edits(other, revision).await.unwrap();
    assert_eq!(
        library_changes(&world, other, &[first, second]).await.len(),
        3,
        "the Library's stay"
    );
    assert_eq!(holds(&world, other).await.0, carried(&frames[1].0), "discarding keeps them");

    // Apply waits until every successor is Ready.
    for (project, view) in &open {
        let was = untouched(&world, *project, view).await;
        let blockers = preview(&world, *project).await.blockers;
        for successor in &successors {
            assert!(blockers.contains(&not_ready(*successor)), "{blockers:#?}");
        }
        let refused = apply(&world, *project).await.unwrap_err();
        assert_eq!(refused.code(), LibraryErrorCode::SessionNotReady, "{refused:?}");
        assert_eq!(untouched(&world, *project, view).await, was, "a refused Apply changes nothing");
    }
    world.admissible(SEP24).await;
    assert_eq!(readiness(&world, first).await, SessionReadiness::Ready);
    assert_eq!(readiness(&world, second).await, SessionReadiness::NeedsReview);
    for (project, view) in &open {
        let changes = library_changes(&world, *project, &[second]).await;
        assert_eq!(changes, [regrouped.clone(), needs_review(second)], "{project}");
        let was = untouched(&world, *project, view).await;
        let blockers = preview(&world, *project).await.blockers;
        assert!(blockers.contains(&not_ready(second)), "{blockers:#?}");
        assert!(!blockers.contains(&not_ready(first)), "the first is Ready: {blockers:#?}");
        let refused = apply(&world, *project).await.unwrap_err();
        assert_eq!(refused.code(), LibraryErrorCode::SessionNotReady, "{refused:?}");
        assert_eq!(refused.response(None, None).identity, Some(second));
        assert_eq!(untouched(&world, *project, view).await, was, "a refused Apply changes nothing");
    }

    world.admissible(HA[0]).await;
    for ((project, _), (held, keys, lights)) in open.iter().zip(&frames) {
        assert_eq!(
            library_changes(&world, *project, &[]).await,
            std::slice::from_ref(&regrouped),
            "{project}"
        );
        assert_eq!(apply(&world, *project).await.unwrap().outcome, Some(ApplyOutcome::Applied));
        assert_eq!(
            world.catalog().project_pending_changes(*project).await.unwrap(),
            Vec::<PendingChange>::new(),
            "{project}: applied, nothing is pending"
        );
        let (sessions, captures) = holds(&world, *project).await;
        assert_eq!(sessions, carried(held), "{project} holds every successor");
        assert_eq!(&captures, keys, "{project}: no frame left the Project");
        assert_eq!(&placed_lights(&world, *project).await, lights, "{project}: none left its View");
    }
}
