// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply (spec 066 VSEL-AC-28/29/31/32/34/35, 069 PREP-AC-05/12/14/25/26/
//! 28/32/33/34/36/38, 071 STO-AC-11/26; astro-plan-y1zq7, astro-plan-mks5g):
//! the View rebuilt from the originals only, a restart-safe swap, and old
//! copies deleted only once their originals verify, against a real catalog
//! and real files.
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::atomic::Ordering;

use apply_support::{
    catalogued, digest, world, Recorder, World, DARKS, HA, HA_FLATS, HA_GAIN_0, OIII,
};
use platevault_core::apply::Unattended;
use platevault_core::custody::trash::OsTrash;
use platevault_core::*;

fn names(tree: &[String], folder: &str) -> Vec<String> {
    tree.iter()
        .filter_map(|path| path.strip_prefix(folder).map(str::to_owned))
        .filter(|rest| !rest.contains('/'))
        .collect()
}

#[tokio::test]
async fn the_first_apply_builds_the_night_layout_from_symlinks_to_the_originals() {
    let world = world(ViewMode::Symlinks).await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    assert_eq!(preview.applied_generation, None);
    assert_eq!(preview.copy_bytes, 0, "Linked · 0 B");

    let report = world.library.apply(&World::request(&preview), &Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");

    let tree = World::tree(&world.view());
    let ha = names(&tree, "NIGHT_2026-10-12/Lights/Ha_300s/");
    let oiii = names(&tree, "NIGHT_2026-10-13/Lights/OIII_300s/");
    assert_eq!(ha.len(), 2, "{tree:#?}");
    assert_eq!(oiii.len(), 2, "{tree:#?}");
    let all: Vec<&String> = ha.iter().chain(&oiii).collect();
    assert_eq!(all.iter().filter(|name| name.as_str() == "Light_001.fits").count(), 1);
    assert!(all.iter().any(|name| name.starts_with("Light_001-") && name.ends_with(".fits")));
    assert_eq!(names(&tree, "NIGHT_2026-10-12/Flats/Ha/").len(), 2, "{tree:#?}");
    assert_eq!(names(&tree, "NIGHT_2026-10-13/Flats/OIII/").len(), 2, "{tree:#?}");
    assert_eq!(names(&tree, "Darks/"), ["Dark_300s_001.fits", "Dark_300s_002.fits"]);
    assert!(!tree.iter().any(|path| path.starts_with("GROUP_")), "one group, no group level");
    assert!(!world.previous().exists() && !world.building().exists());

    for entry in &tree {
        let path = world.view().join(entry);
        let metadata = fs::symlink_metadata(&path).unwrap();
        assert!(metadata.file_type().is_symlink(), "{entry} is a symlink");
        let target = fs::read_link(&path).unwrap();
        assert!(
            target.starts_with(world.captures.path.to_path_buf().unwrap())
                || target.starts_with(world.calibration.path.to_path_buf().unwrap())
        );
        assert_eq!(fs::metadata(&target).unwrap().nlink(), 1, "an original is never hard-linked");
    }
}

#[tokio::test]
async fn copies_clone_or_copy_once_and_hard_link_only_their_own_copy() {
    let world = catalogued(ViewMode::Copies).await;
    world.hold(HA[0]).await;
    world.hold(HA_GAIN_0).await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");

    let tree = World::tree(&world.view());
    // Gain is part of the folder name when the Project mixes it; offset is not.
    assert_eq!(names(&tree, "NIGHT_2026-10-12/Lights/Ha_GAIN_100_300s/").len(), 2, "{tree:#?}");
    assert_eq!(names(&tree, "NIGHT_2026-10-14/Lights/Ha_GAIN_0_300s/").len(), 1, "{tree:#?}");
    assert!(!tree.iter().any(|path| path.contains("OFFSET_")));
    // The 14 Oct lights' flats were taken on 12 Oct: they sit beside the
    // lights they calibrate, under those lights' gain.
    let first = names(&tree, "NIGHT_2026-10-12/Flats/Ha_GAIN_100/");
    let second = names(&tree, "NIGHT_2026-10-14/Flats/Ha_GAIN_0/");
    assert_eq!(first.len(), 2, "{tree:#?}");
    assert_eq!(first, second);
    assert_eq!(names(&tree, "Darks/GAIN_100/").len(), 2, "{tree:#?}");
    assert_eq!(names(&tree, "Darks/GAIN_0/").len(), 2, "{tree:#?}");

    for (index, flat) in HA_FLATS.iter().enumerate() {
        let original = world.calibration_file(flat);
        let a = world.view().join("NIGHT_2026-10-12/Flats/Ha_GAIN_100").join(&first[index]);
        let b = world.view().join("NIGHT_2026-10-14/Flats/Ha_GAIN_0").join(&second[index]);
        let (a, b, original) =
            (fs::metadata(a).unwrap(), fs::metadata(b).unwrap(), fs::metadata(original).unwrap());
        assert_eq!(a.ino(), b.ino(), "the second placement hard-links this build's own copy");
        assert_ne!(a.ino(), original.ino(), "an original is never hard-linked");
        assert_eq!(original.nlink(), 1);
    }
    for entry in &tree {
        let path = world.view().join(entry);
        assert!(fs::symlink_metadata(&path).unwrap().is_file(), "{entry} is a copy");
    }
    let light = names(&tree, "NIGHT_2026-10-14/Lights/Ha_GAIN_0_300s/").remove(0);
    let placed = world.view().join("NIGHT_2026-10-14/Lights/Ha_GAIN_0_300s").join(light);
    assert_eq!(digest(&placed), digest(&world.light(HA_GAIN_0)));
}

#[tokio::test]
async fn an_entry_keeps_its_name_and_a_newcomer_takes_a_suffix() {
    let world = catalogued(ViewMode::Symlinks).await;
    world.hold(HA[0]).await;
    world.apply().await;
    let before = World::tree(&world.view());
    assert!(before.contains(&"NIGHT_2026-10-12/Lights/Ha_300s/Light_001.fits".to_owned()));

    world.hold(OIII[0]).await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let tree = World::tree(&world.view());
    assert!(tree.contains(&"NIGHT_2026-10-12/Lights/Ha_300s/Light_001.fits".to_owned()));
    let oiii = names(&tree, "NIGHT_2026-10-13/Lights/OIII_300s/");
    assert_eq!(oiii.len(), 2);
    assert!(oiii.iter().any(
        |name| name.starts_with("Light_001-") && name.len() == "Light_001-12345678.fits".len()
    ));
    assert!(!world.previous().exists(), "every old link was retired");
}

#[tokio::test]
async fn an_offline_original_refuses_apply_and_changes_nothing() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let root = world.captures.path.to_path_buf().unwrap();
    let away = root.with_file_name("Captures (unmounted)");
    fs::rename(&root, &away).unwrap();

    let preview = world.preview().await;
    let offline = preview
        .blockers
        .iter()
        .filter(|blocker| matches!(blocker, ApplyBlocker::OriginalOffline { .. }))
        .count();
    assert_eq!(offline, 4, "{:#?}", preview.blockers);
    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert!(
        matches!(refused, LibraryError::InvalidInput(ref message) if message.contains("offline"))
    );

    fs::rename(&away, &root).unwrap();
    assert_eq!(World::tree(&world.view()), before);
    assert!(!world.previous().exists() && !world.building().exists());
}

#[tokio::test]
async fn a_changed_or_missing_pinned_file_refuses_apply_with_its_session() {
    let world = catalogued(ViewMode::Symlinks).await;
    let ha = world.hold(HA[0]).await;
    fs::write(world.calibration_file(HA_FLATS[1]), b"rewritten in place").unwrap();
    let preview = world.preview().await;
    assert!(
        preview.blockers.contains(&ApplyBlocker::PinDrift {
            session_id: ha,
            kind: InputKind::Flat,
            health: PinHealth::Changed
        }),
        "{:#?}",
        preview.blockers
    );
    fs::remove_file(world.calibration_file(HA_FLATS[1])).unwrap();
    let preview = world.preview().await;
    assert!(preview.blockers.contains(&ApplyBlocker::PinDrift {
        session_id: ha,
        kind: InputKind::Flat,
        health: PinHealth::Missing
    }));
    assert!(world.library.apply(&World::request(&preview), &Unattended).await.is_err());
    assert!(!world.folder().join("View").exists());
}

#[tokio::test]
async fn a_sheet_the_project_or_the_library_moved_past_is_refused() {
    let world = world(ViewMode::Symlinks).await;
    let preview = world.preview().await;
    world.bump().await;
    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert!(matches!(refused, LibraryError::Conflict { id, .. } if id == world.project));

    // A Library rejection reaches the Project after the sheet opened.
    let preview = world.preview().await;
    let session = world.session_of(&world.captures, HA[0]).await;
    world.mark(&session, Quality::Unusable).await;
    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert!(matches!(refused, LibraryError::Conflict { .. }));
    let fresh = world.preview().await;
    assert_ne!(fresh.basis_digest, preview.basis_digest);
    assert!(!fresh.entries.iter().any(|entry| entry.path.display().contains("Lights/Ha_300s")));
    assert!(!world.view().exists(), "nothing was built");
}

struct FolderTrash(std::path::PathBuf);

impl OsTrash for FolderTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        TrashSupport::Supported
    }
    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        fs::create_dir_all(&self.0).map_err(|error| error.to_string())?;
        fs::rename(entry, self.0.join(entry.file_name().unwrap()))
            .map_err(|error| error.to_string())
    }
}

#[tokio::test]
async fn the_swap_retires_verified_copies_and_keeps_changed_unknown_and_unverified_ones() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let view = world.view();
    let tree = World::tree(&view);
    let ha_dir = "NIGHT_2026-10-12/Lights/Ha_300s/";
    let ha = names(&tree, ha_dir);
    // A tool rewrites one copy in place; DSS writes an .Info.txt; the user
    // saves a note.
    let edited = format!("{ha_dir}{}", ha[0]);
    fs::write(view.join(&edited), b"a tool rewrote this copy's header").unwrap();
    fs::write(view.join(ha_dir).join("Light_001.Info.txt"), b"dss info").unwrap();
    fs::write(view.join("notes.txt"), b"my notes").unwrap();
    // The user excludes the other Ha capture; then its original changes.
    let excluded = world.asset_at(&world.captures, HA[1]).await;
    world
        .sql(
            "UPDATE project_captures SET inclusion = 'excluded', basis = 'user' \
             WHERE project_id = ?1 AND capture_key = ?2",
            &[&world.project.to_string(), &excluded.id.to_string()],
        )
        .await;
    world.bump().await;
    fs::write(world.light(HA[1]), b"the original changed after Apply").unwrap();

    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    assert_eq!(preview.changed_copies, vec![NativePath::from_path(Path::new(&edited))]);
    let foreign: Vec<String> = preview.foreign.iter().map(|file| file.path.display()).collect();
    assert_eq!(foreign, [format!("{ha_dir}Light_001.Info.txt"), "notes.txt".to_owned()]);
    let mut request = World::request(&preview);
    request.ticked = vec![NativePath::from_path(Path::new(&format!("{ha_dir}Light_001.Info.txt")))];
    let report = world.library.apply(&request, &Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");

    // The new View holds fresh copies from the originals and the ticked file.
    // `ha` is sorted, so its first entry is the 12 Oct `Light_001.fits`.
    let fresh = view.join(&edited);
    assert_eq!(digest(&fresh), digest(&world.light(HA[0])));
    assert!(view.join(ha_dir).join("Light_001.Info.txt").exists());
    assert!(!view.join("notes.txt").exists());
    // View (previous)/ keeps exactly the changed copy, the unverifiable copy
    // and the unticked note.
    let mut kept: Vec<(String, PreviousItemReason)> =
        report.leftovers.iter().map(|item| (item.path.display(), item.reason)).collect();
    kept.sort_by(|a, b| a.0.cmp(&b.0));
    let unverified = format!("View (previous)/{ha_dir}{}", ha[1]);
    let mut expected = vec![
        (format!("View (previous)/{edited}"), PreviousItemReason::ChangedCopy),
        (unverified.clone(), PreviousItemReason::UnverifiedCopy),
        ("View (previous)/notes.txt".to_owned(), PreviousItemReason::UntickedFile),
    ];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(kept, expected);
    assert_eq!(World::tree(&world.previous()).len(), 3, "every verified copy was deleted");

    // The next Apply waits until each leftover is reviewed.
    world.bump().await;
    let blocked = world.preview().await;
    assert!(blocked.blockers.contains(&ApplyBlocker::LeftoversPending { count: 3 }));
    let trash = FolderTrash(world.temp.path().join("Trash"));
    for (path, review) in [
        (format!("View (previous)/{edited}"), PreviousItemReview::Trashed),
        (unverified, PreviousItemReview::Trashed),
        ("View (previous)/notes.txt".to_owned(), PreviousItemReview::Kept),
    ] {
        world
            .library
            .review_view_leftover(
                world.project,
                NativePath::from_path(Path::new(&path)),
                review,
                &trash,
            )
            .await
            .unwrap();
    }
    // A kept file is never asked about again, but while it sits in
    // View (previous)/ the next Apply refuses (open with the owner).
    let kept = world.preview().await;
    assert!(
        kept.blockers.iter().any(|blocker| matches!(blocker, ApplyBlocker::PreviousHoldsKeptFiles { paths } if paths.len() == 1)),
        "{:#?}",
        kept.blockers
    );
    assert!(!kept
        .blockers
        .iter()
        .any(|blocker| matches!(blocker, ApplyBlocker::LeftoversPending { .. })));
    world
        .library
        .review_view_leftover(
            world.project,
            NativePath::from_path(Path::new("View (previous)/notes.txt")),
            PreviousItemReview::Moved,
            &trash,
        )
        .await
        .unwrap();
    assert!(view.join("notes.txt").exists());
    assert!(!world.previous().exists(), "an empty View (previous)/ is removed");
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
}

#[tokio::test]
async fn switching_to_copies_unlinks_old_links_without_following_them() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let tree = World::tree(&world.view());
    let replaced = tree.iter().find(|path| path.starts_with("Darks/")).unwrap().clone();
    fs::remove_file(world.view().join(&replaced)).unwrap();
    fs::write(world.view().join(&replaced), b"a regular file where a link was").unwrap();
    let originals: Vec<String> =
        DARKS.iter().map(|dark| digest(&world.calibration_file(dark))).collect();
    world
        .sql(
            "UPDATE projects SET view_mode = 'copies' WHERE id = ?1",
            &[&world.project.to_string()],
        )
        .await;
    world.bump().await;

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(World::tree(&world.previous()), [replaced.clone()]);
    assert_eq!(report.leftovers.len(), 1);
    assert_eq!(report.leftovers[0].reason, PreviousItemReason::UnverifiedLink);
    for (dark, before) in DARKS.iter().zip(originals) {
        assert_eq!(digest(&world.calibration_file(dark)), before, "no original changed");
    }
    assert!(fs::symlink_metadata(world.view().join(&replaced)).unwrap().is_file());
}

#[tokio::test]
async fn cancel_keeps_the_old_view() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let control = Recorder::default();
    control.cancel.store(true, Ordering::SeqCst);
    let preview = world.preview().await;
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Canceled));
    assert_eq!(World::tree(&world.view()), before);
    assert!(!world.building().exists() && !world.previous().exists());
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
}

#[tokio::test]
async fn one_operation_runs_per_project() {
    let world = world(ViewMode::Symlinks).await;
    let running = uuid::Uuid::new_v4();
    world
        .sql(
            "INSERT INTO project_operations (id, project_id, kind, state, reserved_at) \
             VALUES (?1, ?2, 'copy_to_output', 'active', ?3)",
            &[&running.to_string(), &world.project.to_string(), apply_support::AT],
        )
        .await;
    let preview = world.preview().await;
    assert!(preview.blockers.contains(&ApplyBlocker::OperationRunning {
        operation_id: running,
        kind: ProjectOperationKind::CopyToOutput
    }));
    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert!(
        matches!(refused, LibraryError::InvalidInput(ref message) if message.contains(&running.to_string()))
    );
}

async fn interrupted_at(world: &World, phase: ApplyPhase) -> ApplyReport {
    let control = Recorder::default();
    *control.stop_at.lock().unwrap() = Some(phase);
    let preview = world.preview().await;
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    assert_eq!(report.outcome, None, "stopped at {phase:?}");
    report
}

#[tokio::test]
async fn a_restart_after_the_old_view_moved_restores_it() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let report = interrupted_at(&world, ApplyPhase::OldMoved).await;
    assert!(!world.view().exists() && world.previous().exists());

    world.reopen().await;
    assert_eq!(World::tree(&world.view()), before);
    assert!(!world.previous().exists());
    let journal = world.journal(report.operation_id).await;
    assert_eq!(journal.outcome, Some(ApplyOutcome::Failed));
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
}

#[tokio::test]
async fn a_restart_after_a_move_the_journal_missed_restores_the_old_view() {
    let mut world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let report = interrupted_at(&world, ApplyPhase::BuildVerified).await;
    fs::rename(world.view(), world.previous()).unwrap();

    world.reopen().await;
    assert_eq!(World::tree(&world.view()), before);
    assert_eq!(world.journal(report.operation_id).await.outcome, Some(ApplyOutcome::Failed));
}

#[tokio::test]
async fn a_restart_after_the_install_finishes_the_apply() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    world.bump().await;
    let report = interrupted_at(&world, ApplyPhase::NewInstalled).await;
    assert!(world.view().exists() && world.previous().exists());

    world.reopen().await;
    let journal = world.journal(report.operation_id).await;
    assert_eq!(journal.outcome, Some(ApplyOutcome::Applied));
    assert_eq!(journal.settled_from, Some(ApplyPhase::RetiringPrevious));
    assert!(!world.previous().exists(), "the verified old copies were retired");
    assert_eq!(World::tree(&world.view()).len(), 10, "4 lights, 4 flats, 2 darks");
}

#[tokio::test]
async fn a_failed_build_keeps_the_current_view_and_its_building_folder_for_retry() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let preview = world.preview().await;
    // The original changes after the sheet, before its snapshot.
    let ha = world.light(HA[0]);
    let original = fs::read(&ha).unwrap();
    let mut changed = original.clone();
    changed[100] ^= 1;
    let modified = fs::metadata(&ha).unwrap().modified().unwrap();
    fs::write(&ha, &changed).unwrap();
    fs::File::options().write(true).open(&ha).unwrap().set_modified(modified).unwrap();
    let report = world.library.apply(&World::request(&preview), &Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].reason.code, ReasonCode::SourceDrift);
    assert_eq!(World::tree(&world.view()), before, "the current View stays as it was");

    fs::write(&ha, &original).unwrap();
    fs::File::options().write(true).open(&ha).unwrap().set_modified(modified).unwrap();
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
}
