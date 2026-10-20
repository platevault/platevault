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
//!   review: Apply waits in the Project holding it, with no pending change.
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;

use std::fs;
use std::path::Path;

use apply_support::{lights, scan_files, world, World, AT, HA};
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
