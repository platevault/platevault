// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Wrap up and Close (spec 065 PRJ-FR-14/15/25/30, PRJ-AC-15/21/27/31/
//! 34/43, 071 STO-FR-01/04/06/13/14; D-W43, D-W80, D-W97, D-W111, D-W112;
//! astro-plan-i1an5) on the Apply world: real files, a real catalog and a
//! stand-in OS Trash. Clean up and Trash retire only what the user reviewed
//! and ticked and never `Output/`; Close locks the Project with the
//! calibration its View used; Archive repoints the kept View and a stop while
//! Closing resumes to Archived; Duplicate takes the sessions' current pins.
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use apply_support::{corrected, world, World, HA, OIII, OIII_FLATS, PROJECT, SEP24, SEP28};
use cleanup_support::ScopedTrash;
use platevault_core::apply::Unattended;
use platevault_core::projects::SessionToAdd;
use platevault_core::wrap_up::ArchiveControl;
use platevault_core::*;
use uuid::Uuid;

fn bin(world: &World) -> Arc<ScopedTrash> {
    ScopedTrash::new(&world.temp.path().join("bin"))
}

fn kind(error: &LibraryError) -> String {
    error.code().as_str().into()
}

/// A file the user's tool wrote under the Project folder.
fn write(world: &World, relative: &str) -> std::path::PathBuf {
    let path = world.folder().join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, relative.as_bytes()).unwrap();
    path
}

/// Proceed through Clean up and Trash with nothing ticked.
async fn skip_to_archive(world: &World, trash: &Arc<ScopedTrash>) {
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: Vec::new(),
    };
    world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let request =
        TrashRequest { project_id: world.project, digest: review.digest, ticked: Vec::new() };
    world.library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();
}

async fn revision(world: &World) -> u64 {
    world.library.wrap_up_status(world.project).await.unwrap().desired_revision
}

/// Stops the archive after `0` more durable steps.
struct StopAfter(AtomicUsize);

impl ArchiveControl for StopAfter {
    fn interrupted(&self) -> bool {
        let left = self.0.load(Ordering::SeqCst);
        self.0.store(left.saturating_sub(1), Ordering::SeqCst);
        left == 0
    }
}

/// The empty, active `Archive-T7` captures location, canonical.
async fn archive_location(world: &World) -> (Location, std::path::PathBuf) {
    let root = world.temp.path().join("Archive-T7");
    fs::create_dir_all(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let location = world
        .library
        .register_location(
            NativePath::from_path(&root),
            "Archive-T7".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap();
    (location, root)
}

/// STO-FR-01/04, RES-FR-06: Clean up offers the View's copies ticked and
/// nothing of `Output/` or `Processing/`; only the confirmed row goes, to
/// the OS Trash after its original re-verifies, and everything else stays.
#[tokio::test]
async fn clean_up_retires_only_the_reviewed_rows_and_never_output() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let output = write(&world, "Output/NGC7000_final.xisf");
    let processing = write(&world, "Processing/WBPP/master/masterLight_Ha.xisf");
    let trash = bin(&world);

    let review = world.library.clean_up_review(world.project).await.unwrap();
    assert!(review.entries.len() > 1, "{review:#?}");
    assert!(review.entries.iter().all(|entry| entry.preselected), "Copies are ticked");
    assert!(review.entries.iter().all(|entry| entry.path.display().starts_with("View")));
    let request = |selected: Vec<NativePath>| CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected,
    };
    let stray = request(vec![NativePath::from_path(Path::new("Output/NGC7000_final.xisf"))]);
    let refused = world.library.clean_up(&stray, trash.dyn_trash()).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "{refused}");

    let chosen = review.entries[0].path.clone();
    let report =
        world.library.clean_up(&request(vec![chosen.clone()]), trash.dyn_trash()).await.unwrap();
    assert_eq!(report.results.len(), 1, "{report:#?}");
    assert_eq!(report.results[0].outcome, CleanUpOutcome::Trashed);
    assert_eq!(
        (report.record.step, report.record.outcome),
        (WrapUpStep::CleanUp, WrapUpOutcome::Finished)
    );
    assert!(!report.view_removed);
    assert_eq!(trash.moved(), [world.folder().join(chosen.to_path_buf().unwrap())]);
    for entry in &review.entries[1..] {
        assert!(
            world.folder().join(entry.path.to_path_buf().unwrap()).exists(),
            "unticked rows stay"
        );
    }
    assert!(output.exists() && processing.exists(), "Output/ and Processing/ are never touched");
    assert!(world.light(HA[0]).exists(), "originals are never Clean up's");
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.current, Some(WrapUpStep::Trash));
}

/// STO-FR-04 with PREP-FR-03: Clean up moves an isolated patched copy to the
/// OS Trash once it still differs from its re-verified original only by its
/// planned header cards; one a tool rewrote stays, named.
#[tokio::test]
async fn clean_up_trashes_a_patched_copy_only_while_it_holds_its_patch() {
    let world = corrected(ViewMode::Copies).await;
    world.apply().await;
    let trash = bin(&world);
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let row = |relative: &str| {
        let name = Path::new(relative).file_name().unwrap().to_string_lossy().into_owned();
        let found = review.entries.iter().find(|entry| entry.path.display().ends_with(&name));
        found.unwrap_or_else(|| panic!("{name} is no row: {review:#?}")).path.clone()
    };
    let (sep24, sep28) = (row(SEP24), row(SEP28));
    let at = |row: &NativePath| world.folder().join(row.to_path_buf().unwrap());
    let patched = String::from_utf8_lossy(&fs::read(at(&sep24)).unwrap()).into_owned();
    assert!(patched.contains("OBJECT  = 'NGC 7000'"), "the View holds the patched copy");
    // A tool rewrites the 28 Sep copy's first card in place, keeping its size.
    let mut rewritten = fs::read(at(&sep28)).unwrap();
    rewritten[..80].copy_from_slice(format!("{:<80}", "SIMPLE  = T / rewritten").as_bytes());
    fs::write(at(&sep28), &rewritten).unwrap();

    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: vec![sep24.clone(), sep28.clone()],
    };
    let report = world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    let outcome = |row: &NativePath| {
        report.results.iter().find(|result| result.path == *row).map(|result| &result.outcome)
    };
    assert_eq!(outcome(&sep24), Some(&CleanUpOutcome::Trashed), "{report:#?}");
    assert!(matches!(outcome(&sep28), Some(CleanUpOutcome::Kept { .. })), "{report:#?}");
    assert_eq!(trash.moved(), [at(&sep24)]);
    assert!(at(&sep28).exists(), "the rewritten copy stays");
}

/// STO-FR-04: a View link goes only after its no-follow check proves it is
/// still the link `PlateVault` placed to its original; a link the user
/// retargeted stays, named, and nothing is ever followed.
#[tokio::test]
async fn symlinks_are_deleted_after_their_no_follow_check() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let trash = bin(&world);
    let review = world.library.clean_up_review(world.project).await.unwrap();
    assert!(review.entries.iter().all(|entry| !entry.preselected), "Symlinks are unticked");
    let changed = world.folder().join(review.entries[0].path.to_path_buf().unwrap());
    let elsewhere = write(&world, "elsewhere.fits");
    fs::remove_file(&changed).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &changed).unwrap();

    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: review.entries.iter().map(|entry| entry.path.clone()).collect(),
    };
    let report = world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    assert!(matches!(report.results[0].outcome, CleanUpOutcome::Kept { .. }), "{report:#?}");
    assert!(report.results[1..].iter().all(|result| result.outcome == CleanUpOutcome::Deleted));
    assert!(fs::symlink_metadata(&changed).is_ok() && elsewhere.exists());
    assert_eq!(trash.moved(), Vec::<std::path::PathBuf>::new(), "a link is deleted, not trashed");
    assert!(!report.view_removed, "the kept link holds the View");
    assert!(world.light(HA[0]).exists() && world.light(OIII[0]).exists());
}

/// PRJ-FR-15, D-W43: the Trash step moves a row only when it is ticked.
/// Rejected frames stay while only the `Processing/` row is ticked, and
/// `Output/` is never offered.
#[tokio::test]
async fn trash_moves_a_row_only_when_it_is_ticked() {
    let world = world(ViewMode::Symlinks).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    world.apply().await;
    world.mark(&ha, Quality::Unusable).await;
    world.apply().await;
    let trash = bin(&world);
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: Vec::new(),
    };
    world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    let output = write(&world, "Output/NGC7000_final.xisf");
    let intermediate = write(&world, "Processing/WBPP/registered/Light_001_r.xisf");

    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let rejected = &review.groups[0];
    assert_eq!(rejected.group, TrashGroup::RejectedFrames);
    assert_eq!(rejected.items.len(), 2, "{review:#?}");
    let processing = &review.groups[1];
    let offered: Vec<&NativePath> = processing.items.iter().flat_map(|item| &item.files).collect();
    assert_eq!(offered, [&NativePath::from_path(&intermediate)], "Output/ is never offered");

    let request = TrashRequest {
        project_id: world.project,
        digest: review.digest.clone(),
        ticked: vec![TrashGroup::ProcessingFiles],
    };
    let report = world.library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();
    assert_eq!(report.moved, [NativePath::from_path(&intermediate)], "{report:#?}");
    assert_eq!(
        (report.record.step, report.record.outcome),
        (WrapUpStep::Trash, WrapUpOutcome::Finished)
    );
    assert!(world.light(HA[0]).exists() && world.light(HA[1]).exists(), "the unticked row stays");
    assert!(output.exists());
    let assets = world.library.catalog().session(ha.id).await.unwrap().assets;
    assert!(assets.iter().all(|asset| asset.availability != Availability::Trashed));
}

/// PRJ-FR-25, PRJ-AC-34, PRJ-AC-43: Close freezes the applied basis with the
/// calibration each night used and locks the Project: a later reassignment
/// leaves the snapshot alone, nothing applies, nothing reopens. Duplicate
/// takes the sessions' current pins, not the snapshot's.
#[tokio::test]
async fn close_locks_with_its_calibration_and_duplicate_takes_current_pins() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let installed =
        world.library.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let request = CloseRequest {
        project_id: world.project,
        desired_revision: revision(&world).await,
        archive: None,
    };
    let report =
        world.library.close_project(&request, trash.dyn_trash(), &Unattended).await.unwrap();

    assert_eq!(report.lifecycle, ProjectLifecycle::Closed);
    assert_eq!(report.snapshot.applied_generation, Some(installed.generation));
    assert_eq!(report.snapshot.basis, installed.basis, "the snapshot is what the View used");
    let ha = world.session_of(&world.captures, HA[0]).await;
    let frozen_flat = |basis: &ProjectBasis| {
        basis
            .groups
            .iter()
            .flat_map(|group| &group.sessions)
            .find(|session| session.session_id == ha.id)
            .map(|session| session.calibration.flat.clone())
            .unwrap()
    };
    let before = frozen_flat(&report.snapshot.basis);

    world.pin(ha.id, "flat", &world.raw_set(OIII_FLATS[0], "2026-10-13").await).await;
    let snapshot = world.library.closed_snapshot(world.project).await.unwrap().unwrap();
    assert_eq!(snapshot, report.snapshot, "a reassignment never changes a Closed Project");
    let pending = world.library.catalog().project_pending_changes(world.project).await.unwrap();
    assert_eq!(pending, Vec::<PendingChange>::new(), "Library changes never touch it");
    let locked = world
        .library
        .apply_preview(world.project)
        .await
        .map_or(true, |preview| !preview.blockers.is_empty());
    assert!(locked, "a Closed Project takes no Apply");
    assert!(world.view().exists(), "the kept View stays");
    let reopen =
        world.library.reopen_wrap_up_step(world.project, WrapUpStep::Archive).await.unwrap_err();
    assert_eq!(kind(&reopen), "invalid_input");

    let oiii = world.session_of(&world.captures, OIII[0]).await;
    let duplicate = world
        .library
        .duplicate_project(&DuplicateRequest {
            project_id: world.project,
            name: "NGC 7000 · 2".into(),
            sessions: vec![ha.id, oiii.id],
            goals: true,
            notes: true,
            settings: true,
        })
        .await
        .unwrap();
    let inputs = world.library.catalog().apply_inputs(duplicate.id).await.unwrap();
    assert!(inputs.installed.is_none(), "no View and no file until its first Apply");
    let now = frozen_flat(&inputs.basis);
    assert_ne!(now, before, "the duplicate uses the current pin");
    assert_eq!(frozen_flat(&snapshot.basis), before, "the original keeps its snapshot");
}

/// STO-FR-06/13, D-W111, PRJ-AC-31: Close with Archive moves the sessions'
/// files to the archive, repoints the kept View's links to the verified
/// copies and records it beside the frozen manifest; the snapshot, sessions
/// and Wrap up record stay. A stop while Closing leaves the Project locked
/// and Closing; the next start resumes it to Archived, never half-closed.
#[tokio::test]
async fn a_stopped_close_resumes_to_archived_with_its_kept_view_repointed() {
    let mut world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let (archive, archive_root) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    assert_eq!(review.sessions.len(), 2, "{review:#?}");
    assert!(review.sessions.iter().all(|offer| offer.kept_by.is_empty() && offer.hold.is_none()));
    assert_eq!(review.links.len(), 4, "every light link of the kept View is repointed");
    let sessions: Vec<Uuid> = review.sessions.iter().map(|offer| offer.session_id).collect();
    let desired = world.library.catalog().project_desired(world.project).await.unwrap();
    let request = CloseRequest {
        project_id: world.project,
        desired_revision: revision(&world).await,
        archive: Some(ArchiveSelection {
            destination: archive.id,
            sessions,
            digest: review.digest,
        }),
    };
    let stop = StopAfter(AtomicUsize::new(9));
    let report = world.library.close_project(&request, trash.dyn_trash(), &stop).await.unwrap();
    assert_eq!(report.lifecycle, ProjectLifecycle::Closing, "{report:#?}");
    assert!(!report.archive.as_ref().unwrap().settled);
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(
        status.blocker,
        Some(WrapUpBlocker::NotOpen { lifecycle: ProjectLifecycle::Closing })
    );

    world.reopen().await;
    let settled = world.library.recover_wrap_up(trash.dyn_trash()).await.unwrap();
    assert_eq!(settled.len(), 1);
    let progress = &settled[0];
    assert!(progress.settled, "{progress:#?}");
    assert!(progress.moves.iter().all(|step| step.outcome == Some(ArchiveMoveOutcome::Archived)));
    assert_eq!(progress.repointed_links.len(), 4);
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Archived);
    let steps: Vec<_> = status.records.iter().map(|record| (record.step, record.outcome)).collect();
    assert_eq!(steps[2], (WrapUpStep::Archive, WrapUpOutcome::Finished));

    for link in &review.links {
        let path = link.link.to_path_buf().unwrap();
        let target = fs::read_link(&path).unwrap();
        assert!(target.starts_with(&archive_root), "{} reads {}", path.display(), target.display());
        assert!(target.exists());
    }
    assert!(!world.light(HA[0]).exists() && !world.light(OIII[0]).exists(), "originals retired");
    assert_eq!(trash.moved().len(), 4, "only the four originals went to the OS Trash");
    assert_eq!(
        world.library.closed_snapshot(world.project).await.unwrap().unwrap(),
        report.snapshot
    );
    let after = world.library.catalog().project_desired(world.project).await.unwrap();
    assert_eq!(after.sessions, desired.sessions, "archiving changes no Project's sessions");
}

/// STO-FR-13, record §8 line 203 (a session an open Project holds can't be
/// selected; the F4 form of the Done archive's holder refusal): the session
/// another open Project holds stays at its path, named by that Project, and
/// Close refuses to archive it with nothing changed. The session only this
/// Project holds archives, and Storage names the transfer as this Project's
/// Wrap up archive.
#[tokio::test]
async fn archive_refuses_a_session_another_open_project_holds() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let ha = world.session_of(&world.captures, HA[0]).await.id;
    let oiii = world.session_of(&world.captures, OIII[0]).await.id;
    let catalog = world.catalog();
    let target_id = catalog.project(world.project).await.unwrap().subjects[0].target_id;
    let other = catalog
        .create_project(&ProjectInput {
            name: "Sadr region".into(),
            notes: None,
            subjects: vec![SubjectInput { target_id, name: None }],
            rig_ids: vec![world.rig],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    let expected = catalog.project_desired(other.id).await.unwrap().revision;
    let adds = [SessionToAdd { session_id: ha, expected: None }];
    world.library.add_project_sessions(other.id, expected, &adds, None).await.unwrap();
    let (archive, archive_root) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;

    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let offer = |id: Uuid| review.sessions.iter().find(|offer| offer.session_id == id).unwrap();
    assert_eq!(offer(ha).kept_by, ["Sadr region".to_owned()], "{review:#?}");
    assert!(offer(oiii).kept_by.is_empty() && offer(oiii).hold.is_none(), "{review:#?}");
    let close = |sessions: Vec<Uuid>, desired_revision: u64| CloseRequest {
        project_id: world.project,
        desired_revision,
        archive: Some(ArchiveSelection {
            destination: archive.id,
            sessions,
            digest: review.digest.clone(),
        }),
    };

    let refused = world
        .library
        .close_project(
            &close(vec![ha, oiii], revision(&world).await),
            trash.dyn_trash(),
            &Unattended,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "{refused}");
    assert!(refused.to_string().contains("Sadr region holds it"), "{refused}");
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Open);
    assert!(world.light(HA[0]).exists() && world.light(OIII[0]).exists(), "nothing moved");
    assert_eq!(trash.moved(), Vec::<std::path::PathBuf>::new(), "nothing went to the OS Trash");

    let report = world
        .library
        .close_project(&close(vec![oiii], revision(&world).await), trash.dyn_trash(), &Unattended)
        .await
        .unwrap();
    assert_eq!(report.lifecycle, ProjectLifecycle::Archived, "{report:#?}");
    assert!(world.light(HA[0]).exists(), "the held session stays at its path");
    assert!(!world.light(OIII[0]).exists(), "the OIII original is retired");
    let overview = world.library.storage_overview().await.unwrap();
    let [transfer] = overview.transfers.as_slice() else {
        panic!("{:#?}", overview.transfers);
    };
    assert_eq!(
        transfer.archive,
        Some(persistence_library::ArchiveOwner::Project {
            project_id: world.project,
            project_name: PROJECT.into(),
        })
    );
    let root = NativePath::from_path(&archive_root);
    assert!(transfer
        .items
        .iter()
        .all(|item| item.destination.as_ref().is_some_and(|destination| destination.root == root)));
}
