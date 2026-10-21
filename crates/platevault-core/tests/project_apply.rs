// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply (spec 066 VSEL-AC-28/29/31/32/34/35, 069 PREP-AC-05/06/12/14/25/
//! 26/28/32/33/34/36/38/39, 071 STO-AC-11/26; astro-plan-y1zq7,
//! astro-plan-mks5g, astro-plan-q8rxp): the View rebuilt from the originals
//! only, corrected frames as isolated patched copies, a restart-safe swap,
//! and old copies deleted only once their originals verify, against a real
//! catalog and real files.
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use apply_support::{
    calibration_frames, catalogued, corrected, digest, frame, meta, scan, sep24_frame, world,
    Recorder, World, DARKS, HA, HA_FLATS, HA_GAIN_0, OIII, SEP24, SEP28,
};
use metadata_core::MetadataExtractor;
use platevault_core::apply::{ApplyControl, Unattended};
use platevault_core::custody::trash::OsTrash;
use platevault_core::*;
use serde_json::{json, Value};

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
    assert_eq!(preview.footprint, ViewFootprint::default(), "Linked · 0 B");

    let report = world.library.apply(&World::request(&preview), &Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");

    let tree = World::tree(&world.view());
    let ha = names(&tree, "NIGHT_2026-10-12/Lights/Ha_300s/");
    let oiii = names(&tree, "NIGHT_2026-10-13/Lights/OIII_300s/");
    assert_eq!(ha.len(), 2, "{tree:#?}");
    assert_eq!(oiii.len(), 2, "{tree:#?}");
    let all: Vec<&String> = ha.iter().chain(&oiii).collect();
    assert_eq!(all.iter().filter(|name| name.as_str() == "Light_001.fits").count(), 1);
    assert!(all.iter().any(|name| name.starts_with("Light_001-")
        && Path::new(name.as_str()).extension().is_some_and(|ext| ext == "fits")));
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

/// D-W81, 063 FR-005: every Copies entry is its own file made from the
/// original, so a flat set placed for two nights is two files, a write to
/// one leaves the other as it was, and the footprint counts both.
#[tokio::test]
async fn copies_place_every_entry_as_its_own_file_and_never_hard_link() {
    let world = catalogued(ViewMode::Copies).await;
    world.hold(HA[0]).await;
    world.hold(HA_GAIN_0).await;
    let preview = world.preview().await;
    let footprint: u64 = preview.entries.iter().map(|entry| entry.size_bytes).sum();
    assert!(preview.entries.iter().all(|entry| entry.placement != EntryPlacement::Symlink));
    assert_eq!(preview.footprint.bytes, footprint, "the footprint counts each copy");
    assert_eq!(preview.footprint.frames, u64::try_from(preview.entries.len()).unwrap());
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");

    let tree = World::tree(&world.view());
    assert_eq!(tree.len(), preview.entries.len(), "{tree:#?}");
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

    for entry in &tree {
        let metadata = fs::symlink_metadata(world.view().join(entry)).unwrap();
        assert!(metadata.is_file(), "{entry} is a copy");
        assert_eq!(metadata.nlink(), 1, "{entry} is no hard link");
    }
    for (index, flat) in HA_FLATS.iter().enumerate() {
        let original = world.calibration_file(flat);
        let a = world.view().join("NIGHT_2026-10-12/Flats/Ha_GAIN_100").join(&first[index]);
        let b = world.view().join("NIGHT_2026-10-14/Flats/Ha_GAIN_0").join(&second[index]);
        let (inode_a, inode_b, inode_original) = (
            fs::metadata(&a).unwrap().ino(),
            fs::metadata(&b).unwrap().ino(),
            fs::metadata(&original).unwrap().ino(),
        );
        assert_ne!(inode_a, inode_b, "each night's flat is its own file");
        assert_ne!(inode_a, inode_original, "an original is never hard-linked");
        assert_eq!(fs::metadata(&original).unwrap().nlink(), 1);
        let bytes = fs::read(&b).unwrap();
        fs::write(&a, b"rewritten by a stacking tool").unwrap();
        assert_eq!(fs::read(&b).unwrap(), bytes, "rewriting one night's copy leaves the other");
        assert_eq!(digest(&b), digest(&original));
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

/// D-W113, CAL-AC-29: changed and missing pinned files block Apply with the
/// file name and session Reassign guidance; restoring the recorded bytes, or
/// reassigning the pin, lets it proceed.
#[tokio::test]
async fn a_drifted_pin_blocks_apply_until_its_bytes_return_or_it_is_reassigned() {
    const FRESH: [&str; 2] = ["flats/Ha/Flat_Ha_101.fits", "flats/Ha/Flat_Ha_102.fits"];
    let world = catalogued(ViewMode::Symlinks).await;
    let session = world.hold(HA[0]).await;
    let flat = world.calibration_file(HA_FLATS[1]);
    let recorded = fs::read(&flat).unwrap();
    let modified = fs::metadata(&flat).unwrap().modified().unwrap();

    fs::write(&flat, vec![b'x'; recorded.len()]).unwrap();
    let preview = world.preview().await;
    assert!(
        preview.blockers.contains(&ApplyBlocker::PinDrift {
            session_id: session,
            kind: InputKind::Flat,
            path: Some(NativePath::from_path(&flat)),
            health: PinHealth::Changed
        }),
        "{:#?}",
        preview.blockers
    );
    let refusal = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert!(refusal.to_string().contains("Flat_Ha_002.fits"), "{refusal}");
    assert!(refusal.to_string().to_lowercase().contains("reassign"), "{refusal}");
    assert!(!world.view().exists(), "blocked Apply makes no View");

    fs::write(&flat, &recorded).unwrap();
    fs::File::options().write(true).open(&flat).unwrap().set_modified(modified).unwrap();
    let restored = world.preview().await;
    assert!(!restored.blockers.iter().any(|blocker| matches!(blocker, ApplyBlocker::PinDrift { session_id, kind: InputKind::Flat, .. } if *session_id == session)));
    assert_eq!(
        world.library.apply(&World::request(&restored), &Unattended).await.unwrap().outcome,
        Some(ApplyOutcome::Applied)
    );

    fs::remove_file(&flat).unwrap();
    let missing = world.preview().await;
    assert!(
        missing.blockers.contains(&ApplyBlocker::PinDrift {
            session_id: session,
            kind: InputKind::Flat,
            path: Some(NativePath::from_path(&flat)),
            health: PinHealth::Missing
        }),
        "{:#?}",
        missing.blockers
    );
    assert!(world.library.apply(&World::request(&missing), &Unattended).await.is_err());

    // The user reassigns the flat to a fresh set of Ha flats.
    let root = world.calibration.path.to_path_buf().unwrap();
    let mut frames: Vec<_> =
        calibration_frames().into_iter().filter(|(path, _)| path != HA_FLATS[1]).collect();
    frames.extend(
        FRESH.map(|path| (path.to_owned(), meta("FLAT", Some("Ha"), 2.0, 100.0, "2026-10-11"))),
    );
    scan(&world.library, &world.calibration, &root, &frames).await;
    let flats = world.session_of(&world.calibration, FRESH[0]).await;
    let input =
        InputRef::RawSet { session_id: flats.id, grouping_revision: flats.grouping_revision };
    let generation =
        world.catalog().session_calibration(session).await.unwrap().calibration.generation;
    world.library.reassign_calibration(session, InputKind::Flat, input, generation).await.unwrap();
    let reassigned = world.preview().await;
    assert!(
        !reassigned.blockers.iter().any(|blocker| matches!(blocker, ApplyBlocker::PinDrift { .. })),
        "{:#?}",
        reassigned.blockers
    );
    assert_eq!(
        world.library.apply(&World::request(&reassigned), &Unattended).await.unwrap().outcome,
        Some(ApplyOutcome::Applied)
    );
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
    // A kept file is never asked about again, and the next Apply doesn't
    // wait for it (D-W110).
    let kept = world.preview().await;
    assert!(kept.blockers.is_empty(), "{:#?}", kept.blockers);
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

const HA_DIR: &str = "NIGHT_2026-10-12/Lights/Ha_300s/";

/// The user saves `files` in `View/`, leaves them unticked at the next
/// Apply and keeps each in `View (previous)/` (D-W110).
async fn keep(world: &World, files: &[(&str, &[u8])]) {
    for (relative, bytes) in files {
        let path = world.view().join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
    }
    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(report.leftovers.len(), files.len(), "{:#?}", report.leftovers);
    let trash = FolderTrash(world.temp.path().join("Trash"));
    for (relative, _) in files {
        let path = NativePath::from_path(&Path::new("View (previous)").join(relative));
        world
            .library
            .review_view_leftover(world.project, path, PreviousItemReview::Kept, &trash)
            .await
            .unwrap();
    }
}

fn kept_folder(world: &World) -> PathBuf {
    world.folder().join("View (kept)")
}

#[tokio::test]
async fn the_next_apply_moves_a_kept_file_to_view_kept_at_its_view_path() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    keep(&world, &[(&note, b"my notes")]).await;
    let inode = fs::symlink_metadata(world.previous().join(&note)).unwrap().ino();

    // Apply doesn't wait for a file already kept.
    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    let report = world.library.apply(&World::request(&preview), &Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.kept_missing.is_empty(), "{:#?}", report.kept_missing);

    let moved = kept_folder(&world).join(&note);
    assert_eq!(fs::read(&moved).unwrap(), b"my notes");
    assert_eq!(fs::symlink_metadata(&moved).unwrap().ino(), inode, "moved, never copied");
    assert!(!world.previous().exists(), "{:?}", World::tree(&world.previous()));
    // A later sheet doesn't list it, and a later Apply leaves it alone.
    world.bump().await;
    let later = world.preview().await;
    assert!(later.leftovers.is_empty(), "{:#?}", later.leftovers);
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
    assert_eq!(fs::read(&moved).unwrap(), b"my notes");
}

#[tokio::test]
async fn a_kept_file_whose_name_view_kept_holds_takes_the_next_free_number() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    for bytes in [b"first" as &[u8], b"second", b"third"] {
        keep(&world, &[(&note, bytes)]).await;
        world.bump().await;
        let report = world.apply().await;
        assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    }
    let kept = kept_folder(&world).join(HA_DIR);
    assert_eq!(fs::read(kept.join("notes.txt")).unwrap(), b"first");
    assert_eq!(fs::read(kept.join("notes-2.txt")).unwrap(), b"second");
    assert_eq!(fs::read(kept.join("notes-3.txt")).unwrap(), b"third");
    assert_eq!(World::tree(&kept).len(), 3);
}

#[tokio::test]
async fn a_kept_file_gone_from_disk_is_named_in_the_apply_outcome() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let (gone, stays) = (format!("{HA_DIR}notes.txt"), format!("{HA_DIR}todo.txt"));
    keep(&world, &[(&gone, b"my notes"), (&stays, b"my todo")]).await;
    fs::remove_file(world.previous().join(&gone)).unwrap();
    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let named = NativePath::from_path(&Path::new("View (previous)").join(&gone));
    assert_eq!(report.kept_missing, vec![named]);
    assert_eq!(fs::read(kept_folder(&world).join(&stays)).unwrap(), b"my todo");

    // The only kept file gone: View (previous)/ then holds nothing at all.
    let last = format!("{HA_DIR}last.txt");
    keep(&world, &[(&last, b"last")]).await;
    fs::remove_file(world.previous().join(&last)).unwrap();
    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let named = NativePath::from_path(&Path::new("View (previous)").join(&last));
    assert_eq!(report.kept_missing, vec![named]);

    // Named once: the next sheet and Apply no longer hold it.
    world.bump().await;
    let leftovers = world.preview().await.leftovers;
    assert!(leftovers.is_empty(), "{leftovers:#?}");
    let report = world.apply().await;
    assert!(report.kept_missing.is_empty(), "{report:#?}");
}

/// The Project's manifests in `state`.
async fn manifests_in(world: &World, state: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM view_manifests WHERE project_id = ?1 AND state = ?2")
        .bind(world.project.to_string())
        .bind(state)
        .fetch_one(&mut world.conn().await)
        .await
        .unwrap()
}

/// 5u6x7 (1): with `View/` deleted while `View (previous)/` holds a kept
/// file, Apply still moves it to `View (kept)/`, retires the previous View
/// and settles Applied: there is never a second previous manifest.
#[tokio::test]
async fn apply_settles_with_view_deleted_and_a_kept_file_in_view_previous() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    keep(&world, &[(&note, b"my notes")]).await;
    fs::remove_dir_all(world.view()).unwrap();
    world.bump().await;

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(fs::read(kept_folder(&world).join(&note)).unwrap(), b"my notes");
    assert!(!world.previous().exists(), "{:?}", World::tree(&world.previous()));
    assert!(manifests_in(&world, "previous").await <= 1);
    assert_eq!(manifests_in(&world, "installed").await, 1);
    world.bump().await;
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
}

/// Writes `bytes` at `at` in the new View once it is installed, before the
/// ticked foreign files move, as another program could.
struct WriteOnInstall {
    at: PathBuf,
    bytes: &'static [u8],
    done: AtomicBool,
}

impl ApplyControl for WriteOnInstall {
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        if phase == ApplyPhase::NewInstalled && !self.done.swap(true, Ordering::SeqCst) {
            fs::create_dir_all(self.at.parent().unwrap()).unwrap();
            fs::write(&self.at, self.bytes).unwrap();
        }
        false
    }
}

/// 5u6x7 (2): a file another program put at a ticked foreign file's path
/// in the new View is never removed, even when it is empty or holds the
/// foreign file's first bytes: no journal claimed that name. The foreign
/// file stays in `View (previous)/` and its name is reported taken.
#[tokio::test]
async fn a_file_at_a_ticked_foreign_files_new_path_is_kept_and_its_name_reported_taken() {
    for theirs in [&b""[..], b"the user"] {
        let world = world(ViewMode::Copies).await;
        world.apply().await;
        let note = format!("{HA_DIR}notes.txt");
        fs::write(world.view().join(&note), b"the user's notes").unwrap();
        world.bump().await;
        let preview = world.preview().await;
        let mut request = World::request(&preview);
        request.ticked = vec![NativePath::from_path(Path::new(&note))];
        let at = world.view().join(&note);
        let control =
            WriteOnInstall { at: at.clone(), bytes: theirs, done: AtomicBool::new(false) };

        let report = world.library.apply(&request, &control).await.unwrap();
        assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
        let item = report.foreign.iter().find(|item| item.path.display() == note).unwrap();
        assert_eq!(
            (item.state, item.reason),
            (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
            "{item:#?}"
        );
        assert_eq!(fs::read(&at).unwrap(), theirs, "their file stays");
        assert_eq!(fs::read(world.previous().join(&note)).unwrap(), b"the user's notes");
    }
}

/// Every foreign outcome update fails from now on, as `PlateVault` closing
/// after a ticked foreign file's attempt and before its outcome is recorded
/// would leave it.
const CLOSE_BEFORE_OUTCOME: &str = "CREATE TRIGGER closed_before_outcome \
     BEFORE UPDATE OF state ON apply_foreign_items \
     BEGIN SELECT RAISE(ABORT, 'PlateVault closed'); END";

/// What `PlateVault` closing mid move leaves where the volume has no
/// no-replace rename (macOS exFAT, and Linux volumes that refuse
/// `RENAME_NOREPLACE`), once the file that was at `from` is already at
/// `moved`: a verified copy at `moved`, and the source moved aside beside
/// `from` to the hidden name it takes before it is unlinked. Simulated here
/// where the platform renames, so the source keeps its identity. Returns
/// that name's path.
fn closed_before_the_source_unlink(from: &Path, moved: &Path) -> PathBuf {
    let aside = from.with_file_name(format!(".pv-{}.removing", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(aside.parent().unwrap()).unwrap();
    fs::rename(moved, &aside).unwrap();
    fs::copy(&aside, moved).unwrap();
    aside
}

/// 5u6x7 review: `PlateVault` closing after a ticked foreign file's
/// attempt and before its outcome is recorded, where another program's
/// prefix of it already held the new path. Resumed at the next start, the
/// move never takes that file for its own unfinished copy: it stays, and
/// the name is reported taken.
#[tokio::test]
async fn a_resumed_foreign_move_never_removes_a_file_that_held_its_path_first() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    fs::write(world.view().join(&note), b"the user's notes").unwrap();
    world.bump().await;
    let preview = world.preview().await;
    let mut request = World::request(&preview);
    request.ticked = vec![NativePath::from_path(Path::new(&note))];
    let at = world.view().join(&note);
    let control =
        WriteOnInstall { at: at.clone(), bytes: b"the user", done: AtomicBool::new(false) };
    world.sql(CLOSE_BEFORE_OUTCOME, &[]).await;
    world.library.apply(&request, &control).await.unwrap_err();
    world.sql("DROP TRIGGER closed_before_outcome", &[]).await;
    world.reopen().await;

    let journal = world.catalog().latest_apply_journal(world.project).await.unwrap().unwrap();
    assert_eq!(journal.outcome, Some(ApplyOutcome::Applied), "{journal:#?}");
    let items = world.catalog().apply_foreign_items(journal.operation_id).await.unwrap();
    let item = items.iter().find(|item| item.path.display() == note).unwrap();
    assert_eq!(
        (item.state, item.reason),
        (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
        "{item:#?}"
    );
    assert_eq!(fs::read(&at).unwrap(), b"the user", "their file stays");
    assert_eq!(fs::read(world.previous().join(&note)).unwrap(), b"the user's notes");
}

/// vmv9s: `PlateVault` closing mid way through a ticked foreign file's move
/// where the volume has no no-replace rename, after its verified copy and
/// before its source is unlinked. Resumed at the next start, the move
/// removes the source it proves the copy holds, so nothing hidden stays in
/// `View (previous)/` for a later Apply to keep.
#[tokio::test]
async fn a_resumed_foreign_move_removes_the_source_its_copy_holds() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    fs::write(world.view().join(&note), b"the user's notes").unwrap();
    world.bump().await;
    let preview = world.preview().await;
    let mut request = World::request(&preview);
    request.ticked = vec![NativePath::from_path(Path::new(&note))];
    world.sql(CLOSE_BEFORE_OUTCOME, &[]).await;
    world.library.apply(&request, &Unattended).await.unwrap_err();
    world.sql("DROP TRIGGER closed_before_outcome", &[]).await;
    let at = world.view().join(&note);
    let aside = closed_before_the_source_unlink(&world.previous().join(&note), &at);
    world.reopen().await;

    let journal = world.catalog().latest_apply_journal(world.project).await.unwrap().unwrap();
    assert_eq!(journal.outcome, Some(ApplyOutcome::Applied), "{journal:#?}");
    let items = world.catalog().apply_foreign_items(journal.operation_id).await.unwrap();
    let item = items.iter().find(|item| item.path.display() == note).unwrap();
    assert_eq!(item.state, ForeignItemState::Moved, "{item:#?}");
    assert!(!aside.exists(), "the source its copy holds is removed");
    assert_eq!(fs::read(&at).unwrap(), b"the user's notes");
}

/// Every review update fails from now on, as `PlateVault` closing right
/// after a kept file moved and before its move was recorded would leave it.
const CLOSE_BEFORE_RECORD: &str = "CREATE TRIGGER closed_before_record \
     BEFORE UPDATE OF review ON view_previous_items \
     BEGIN SELECT RAISE(ABORT, 'PlateVault closed'); END";

/// Apply the sheet with `PlateVault` closing right after the first kept
/// file moves, then start again.
async fn closed_after_a_kept_move(world: &mut World) {
    world.sql(CLOSE_BEFORE_RECORD, &[]).await;
    world.bump().await;
    let preview = world.preview().await;
    world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    world.sql("DROP TRIGGER closed_before_record", &[]).await;
}

/// 5u6x7 (5): `PlateVault` closing between a kept file's move and its
/// record leaves no kept file reported gone from disk: the next start
/// records the move, and the next Apply moves the rest.
#[tokio::test]
async fn a_kept_move_closed_before_its_record_is_never_reported_missing() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let (first, second) = (format!("{HA_DIR}notes.txt"), format!("{HA_DIR}todo.txt"));
    keep(&world, &[(&first, b"my notes"), (&second, b"my todo")]).await;
    closed_after_a_kept_move(&mut world).await;
    world.reopen().await;

    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.kept_missing.is_empty(), "{:#?}", report.kept_missing);
    assert_eq!(fs::read(kept_folder(&world).join(&first)).unwrap(), b"my notes");
    assert_eq!(fs::read(kept_folder(&world).join(&second)).unwrap(), b"my todo");
    assert_eq!(World::tree(&kept_folder(&world).join(HA_DIR)), ["notes.txt", "todo.txt"]);
}

/// 5u6x7 (4): where the volume has no no-replace rename (macOS exFAT) a
/// kept file moves as a copy made under its kept name, so `PlateVault`
/// closing mid copy leaves that name holding the copy's first bytes and the
/// file still in `View (previous)/`. Simulated here where the platform
/// renames: the next start removes the unfinished copy, which the move's
/// claim names, and the next Apply moves the file to that name. Nothing
/// unrecorded stays.
#[tokio::test]
async fn an_interrupted_kept_copy_leaves_no_unrecorded_partial() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    keep(&world, &[(&note, b"my notes")]).await;
    closed_after_a_kept_move(&mut world).await;
    let (from, to) = (world.previous().join(&note), kept_folder(&world).join(&note));
    fs::create_dir_all(from.parent().unwrap()).unwrap();
    fs::rename(&to, &from).unwrap();
    fs::write(&to, b"my no").unwrap();
    world.reopen().await;

    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.kept_missing.is_empty(), "{:#?}", report.kept_missing);
    assert_eq!(World::tree(&kept_folder(&world).join(HA_DIR)), ["notes.txt"]);
    assert_eq!(fs::read(&to).unwrap(), b"my notes");
}

/// vmv9s: `PlateVault` closing mid way through a kept file's move where the
/// volume has no no-replace rename, after its verified copy under its kept
/// name and before its source is unlinked
/// ([`closed_before_the_source_unlink`]). The next start, which finds the
/// claimed copy under the kept name, removes the source it proves the copy
/// holds, so the next Apply keeps no hidden duplicate in `View (kept)/`.
#[tokio::test]
async fn a_kept_move_closed_before_its_source_unlink_keeps_no_hidden_duplicate() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    keep(&world, &[(&note, b"my notes")]).await;
    closed_after_a_kept_move(&mut world).await;
    let to = kept_folder(&world).join(&note);
    let aside = closed_before_the_source_unlink(&world.previous().join(&note), &to);
    world.reopen().await;
    assert!(!aside.exists(), "the source its copy holds is removed");

    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.kept_missing.is_empty(), "{:#?}", report.kept_missing);
    assert_eq!(World::tree(&kept_folder(&world).join(HA_DIR)), ["notes.txt"]);
    assert_eq!(fs::read(&to).unwrap(), b"my notes");
}

/// vmv9s: beside a claimed kept move, a file under the hidden name a moved
/// source takes, holding the kept file's bytes but not being that file, is
/// the user's: the next start leaves it, and the next Apply keeps it.
#[tokio::test]
async fn a_file_named_like_a_moved_source_is_never_taken_for_one() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let note = format!("{HA_DIR}notes.txt");
    keep(&world, &[(&note, b"my notes")]).await;
    closed_after_a_kept_move(&mut world).await;
    let to = kept_folder(&world).join(&note);
    let name = format!(".pv-{}.removing", uuid::Uuid::new_v4().simple());
    let theirs = world.previous().join(HA_DIR).join(&name);
    fs::create_dir_all(theirs.parent().unwrap()).unwrap();
    fs::copy(&to, &theirs).unwrap();
    world.reopen().await;
    assert_eq!(fs::read(&theirs).unwrap(), b"my notes", "their file stays");

    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(World::tree(&kept_folder(&world).join(HA_DIR)), [name.as_str(), "notes.txt"]);
    assert_eq!(fs::read(kept_folder(&world).join(HA_DIR).join(&name)).unwrap(), b"my notes");
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
    assert_eq!(World::tree(&world.previous()), std::slice::from_ref(&replaced));
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

// ── Corrected values as isolated patched copies ──────────────────────────────

/// The entry the View places for the light at `relative`.
fn placed(world: &World, relative: &str) -> PathBuf {
    let name = Path::new(relative).file_name().unwrap().to_string_lossy().into_owned();
    let found = World::tree(&world.view());
    let entry = found.iter().find(|path| path.ends_with(&format!("/{name}")));
    world.view().join(entry.unwrap_or_else(|| panic!("{name} is not in {found:#?}")))
}

/// What `PlateVault`'s FITS reader returns for the file at `path`.
fn read_fits(path: &Path) -> metadata_core::RawFileMetadata {
    metadata_fits::FitsExtractor.extract(path).unwrap().unwrap()
}

/// The primary header's cards up to `END`, trailing blanks trimmed.
fn cards(path: &Path) -> Vec<String> {
    fs::read(path)
        .unwrap()
        .chunks(80)
        .map(|card| String::from_utf8_lossy(card).trim_end().to_owned())
        .take_while(|card| card != "END")
        .collect()
}

/// The value field of the fixed-format `keyword` card, trimmed.
fn value(path: &Path, keyword: &str) -> Option<String> {
    cards(path).into_iter().find_map(|card| {
        let name = card.get(..8).unwrap_or(card.as_str()).trim_end();
        (name == keyword && card.get(8..10) == Some("= "))
            .then(|| card[10..].split('/').next().unwrap_or_default().trim().to_owned())
    })
}

/// PREP-FR-03, PREP-FR-20, PREP-AC-06, PREP-AC-39; J23 S11, SC7 and SC8
/// (D-W122, provisional D-W123): in a Copies View each held frame with a
/// recorded correction is an isolated patched copy whose cards carry the
/// corrected values and `PlateVault`'s FITS reader returns them; its present
/// aliases, its HIERARCH `TELESCOPE` among them, are overwritten in their
/// own units, an absent alias isn't added, and the original keeps its
/// bytes. The report reads "4 corrected values written to 2 patched copies"
/// and claims nothing about what a tool reads.
#[tokio::test]
async fn corrected_frames_reach_a_copies_view_as_isolated_patched_copies() {
    let world = corrected(ViewMode::Copies).await;
    let originals = [world.light(SEP24), world.light(SEP28)];
    let before: Vec<String> = originals.iter().map(|path| digest(path)).collect();

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let wire = serde_json::to_value(&report).unwrap();
    assert_eq!(wire["correctedValues"], json!(4), "24 Sep's Target, 28 Sep's rig: {wire:#}");
    assert_eq!(wire["patchedCopies"], json!(2), "{wire:#}");

    let sep24 = placed(&world, SEP24);
    assert_eq!(read_fits(&sep24).object.as_deref(), Some("NGC 7000"));
    assert_eq!(value(&sep24, "OBJECT").as_deref(), Some("'NGC 7000'"));
    assert_eq!(read_fits(&originals[0]).object, None, "the original still lacks OBJECT");

    let sep28 = placed(&world, SEP28);
    let read = read_fits(&sep28);
    assert_eq!(read.telescop.as_deref(), Some("RedCat 51"));
    assert_eq!(read.instrume.as_deref(), Some("ZWO ASI2600MM Pro"));
    assert_eq!(read.focal_length_mm, Some(250.0));
    assert_eq!(value(&sep28, "FOCAL").as_deref(), Some("250.0"), "Siril FOCAL is in mm");
    assert_eq!(value(&sep28, "FLENGTH").as_deref(), Some("0.25"), "Siril FLENGTH is in m");
    assert_eq!(value(&sep28, "DETECTOR").as_deref(), Some("'ZWO ASI2600MM Pro'"));
    assert_eq!(value(&sep28, "EXPOSURE").as_deref(), Some("300.0"), "uncorrected");
    assert_eq!(value(&sep28, "TARGET"), None, "an absent alias is never added");
    let hierarch = |path: &Path| -> Vec<String> {
        cards(path).into_iter().filter(|card| card.starts_with("HIERARCH")).collect()
    };
    assert_eq!(hierarch(&sep28), ["HIERARCH TELESCOPE = 'RedCat 51'"]);
    assert_eq!(hierarch(&sep24), Vec::<String>::new(), "no HIERARCH card is added");

    for ((copy, original), digested) in [&sep24, &sep28].into_iter().zip(&originals).zip(&before) {
        assert_eq!(&digest(original), digested, "the original keeps its bytes");
        let (copied, source) = (fs::read(copy).unwrap(), fs::read(original).unwrap());
        assert_ne!(copied, source, "{} carries the corrected cards", copy.display());
        assert_eq!(copied.len(), source.len());
        assert_eq!(copied[2880..], source[2880..], "only the header differs");
        let metadata = fs::symlink_metadata(copy).unwrap();
        assert!(metadata.is_file(), "a patched copy is its own file, never a link");
        assert_eq!(metadata.nlink(), 1, "never a hard link");
        assert_ne!(metadata.ino(), fs::metadata(original).unwrap().ino());
    }

    // Every other entry is a byte-for-byte copy of its original.
    let sources: BTreeSet<String> = [&world.captures, &world.calibration]
        .into_iter()
        .map(|location| location.path.to_path_buf().unwrap())
        .flat_map(|root| World::tree(&root).into_iter().map(move |file| digest(&root.join(file))))
        .collect();
    let tree = World::tree(&world.view());
    let patched: Vec<&String> =
        tree.iter().filter(|entry| !sources.contains(&digest(&world.view().join(entry)))).collect();
    assert_eq!(patched.len(), 2, "only the corrected frames are patched: {patched:#?}");
}

/// PREP-FR-03 with PREP-FR-06: a further correction on a held session reaches
/// the View at the next Apply, whose fresh patched copy replaces the old one;
/// the sheet doesn't list the untouched old copy as changed, it leaves
/// `View (previous)/` as a copy `PlateVault` placed, and the original never
/// changes.
#[tokio::test]
async fn a_reapply_after_a_further_correction_replaces_the_patched_copy() {
    let world = corrected(ViewMode::Copies).await;
    let original = digest(&world.light(SEP24));
    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
    assert_eq!(read_fits(&placed(&world, SEP24)).object.as_deref(), Some("NGC 7000"));

    world.correct(SEP24, &[("object", json!("North America Nebula"))]).await;
    // A tool opens the patched copy for writing and changes nothing but its
    // modification time, so the sheet reads its bytes.
    let touched = fs::File::options().write(true).open(placed(&world, SEP24)).unwrap();
    touched.set_modified(std::time::SystemTime::now()).unwrap();
    let sheet = world.preview().await;
    assert_eq!(sheet.changed_copies, Vec::<NativePath>::new(), "{sheet:#?}");
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.leftovers.is_empty(), "the old patched copy was retired: {report:#?}");
    assert!(!world.previous().exists());
    assert_eq!(read_fits(&placed(&world, SEP24)).object.as_deref(), Some("North America Nebula"));
    assert_eq!(read_fits(&placed(&world, SEP28)).telescop.as_deref(), Some("RedCat 51"));
    assert_eq!(digest(&world.light(SEP24)), original);
    assert_eq!(read_fits(&world.light(SEP24)).object, None);
}

/// Cancels once the build is verified, before the swap.
#[derive(Default)]
struct CancelAfterBuild(AtomicBool);

impl ApplyControl for CancelAfterBuild {
    fn canceled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        if phase == ApplyPhase::BuildVerified {
            self.0.store(true, Ordering::SeqCst);
        }
        false
    }
}

/// PREP-FR-09: Cancel keeps the old View with its patched copy, and the
/// canceled build's patched copies are cleared as its own.
#[tokio::test]
async fn cancel_keeps_the_old_patched_view_and_clears_the_new_patched_copies() {
    let world = corrected(ViewMode::Copies).await;
    world.apply().await;
    let kept = digest(&placed(&world, SEP24));
    world.correct(SEP24, &[("object", json!("North America Nebula"))]).await;
    let preview = world.preview().await;
    let control = CancelAfterBuild::default();
    let report = world.library.apply(&World::request(&preview), &control).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Canceled), "{report:#?}");
    assert!(!world.building().exists(), "{:#?}", World::tree(&world.building()));
    assert_eq!(digest(&placed(&world, SEP24)), kept);
    assert_eq!(read_fits(&placed(&world, SEP24)).object.as_deref(), Some("NGC 7000"));
}

/// The corrected XISF light of the tests below.
const XISF: &str = "2026-10-12/J23_Light_001.xisf";

/// An XISF light holding `FILTER = 'Ha'` with its image data and, when
/// `thumbnail`, a thumbnail's data block after it.
fn xisf_light(thumbnail: bool) -> Vec<u8> {
    let body = "<FITSKeyword name=\"FILTER\" value=\"'Ha'\" comment=\"\"/>";
    apply_support::xisf_frame(Some(body), &[9_u8; 16], thumbnail.then_some([5_u8; 4].as_slice()))
}

/// PREP-AC-05 and the partial copies an interruption leaves: an Apply
/// stopped after its build leaves its FITS and XISF patched copies in
/// `View (building)/`, and one killed mid-write a partial copy and the file
/// `xisf-header` writes beside one; the restart settles it Failed and the
/// next Apply clears them all as its own and succeeds.
#[tokio::test]
async fn the_next_apply_clears_what_an_interrupted_build_left() {
    let mut world = catalogued(ViewMode::Copies).await;
    let metadata = meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12");
    world.add_lights(&[sep24_frame(), (XISF.to_owned(), metadata, xisf_light(true))]).await;
    world.correct(SEP24, &[("object", json!("NGC 7000"))]).await;
    world.correct(XISF, &[("object", json!("NGC 7000"))]).await;
    world.hold(HA[0]).await;
    let report = interrupted_at(&world, ApplyPhase::BuildVerified).await;
    let built = World::tree(&world.building());
    let xisf = built.iter().find(|path| path.ends_with("J23_Light_001.xisf")).unwrap();
    let night = world.building().join(xisf).parent().unwrap().to_path_buf();
    let partial = format!(".pv-{}-99-a1b2c3.partial", report.operation_id.simple());
    fs::write(night.join(&partial), b"SIMPLE  =                    T half a copy").unwrap();
    fs::write(night.join(format!(".{partial}.tmp-4242")), b"XISF0100 half an edit").unwrap();
    world.reopen().await;
    assert_eq!(world.journal(report.operation_id).await.outcome, Some(ApplyOutcome::Failed));
    assert!(world.building().exists(), "the failed build stays for Retry");

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(!world.building().exists());
    assert_eq!(read_fits(&placed(&world, SEP24)).object.as_deref(), Some("NGC 7000"));
    let read = metadata_xisf::XisfExtractor.extract(&placed(&world, XISF)).unwrap().unwrap();
    assert_eq!(read.object.as_deref(), Some("NGC 7000"));
}

/// The `correction_undeliverable` blockers of a sheet, by original path.
fn undeliverable(preview: &ApplyPreview) -> Vec<(Value, Value, Value)> {
    let blockers = serde_json::to_value(&preview.blockers).unwrap();
    blockers
        .as_array()
        .unwrap()
        .iter()
        .filter(|blocker| blocker["blocker"] == "correction_undeliverable")
        .map(|blocker| {
            (blocker["path"].clone(), blocker["field"].clone(), blocker["refusal"].clone())
        })
        .collect()
}

/// Nothing was built: no `View/` and no `View (building)/`.
fn nothing_built(world: &World) {
    assert!(!world.view().exists() && !world.building().exists(), "nothing was built");
}

/// D-W123 owner decisions and the FITS limits: a corrected value no patched
/// copy can carry refuses Apply before anything is built, so the source
/// value never reaches the tool. Recording such a value is refused too, so
/// these were recorded below that check. An image in an extension refuses
/// even where the primary header holds the keyword, and a HIERARCH alias
/// in a spelling the header crate can't address refuses rather than keep
/// the old value. The sheet names each frame and field; Apply's coded
/// error names the session, one frame and its field, in no English.
#[tokio::test]
async fn a_correction_no_patched_copy_can_carry_refuses_apply_before_building() {
    let world = catalogued(ViewMode::Copies).await;
    let long = "NGC 7000 ".repeat(8);
    let hierarch = frame("Hierarch", true, &["HIERARCH Telescope = 'RedCat 51'"]);
    let ascii = frame("Ascii", true, &[]);
    let too_long = frame("Long", true, &[]);
    let extension = frame("Extension", false, &["OBJECT  = 'M 31'"]);
    let closed = apply_support::xisf_frame(None, &[9_u8; 16], None);
    let cases: [(&str, Vec<u8>, &str, &str, &str); 5] = [
        ("2026-10-12/J23_Ascii.fits", ascii, "object", "Hα NGC 7000", "not_printable_ascii"),
        ("2026-10-12/J23_Long.fits", too_long, "object", &long, "too_long"),
        ("2026-10-12/J23_Extension.fits", extension, "object", "NGC 7000", "image_in_extension"),
        ("2026-10-12/J23_Hierarch.fits", hierarch, "telescope", "Samyang 135", "hierarch_alias"),
        ("2026-10-12/J23_Closed.xisf", closed, "object", "NGC 7000", "xisf_layout"),
    ];
    let frames: Vec<(String, CaptureMetadata, Vec<u8>)> = cases
        .iter()
        .map(|(relative, bytes, _, _, _)| {
            let metadata = meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12");
            ((*relative).to_owned(), metadata, bytes.clone())
        })
        .collect();
    world.add_lights(&frames).await;
    for (relative, _, field, value, _) in &cases {
        world.correct(relative, &[(*field, json!(value))]).await;
    }
    let session = world.hold(HA[0]).await;
    let path = |relative: &str| serde_json::to_value(NativePath::from_path(&world.light(relative)));

    let preview = world.preview().await;
    let mut named = undeliverable(&preview);
    named.sort_by_key(|(path, _, _)| path.to_string());
    let mut expected: Vec<(Value, Value, Value)> = cases
        .iter()
        .map(|(relative, _, field, _, refusal)| {
            (path(relative).unwrap(), json!(field), json!(refusal))
        })
        .collect();
    expected.sort_by_key(|(path, _, _)| path.to_string());
    assert_eq!(named, expected, "{:#?}", preview.blockers);

    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert_eq!(refused.code().as_str(), "correction_unpatchable", "{refused}");
    let response = serde_json::to_value(refused.response(None, None)).unwrap();
    assert_eq!(response["identity"], json!(session), "{response:#}");
    assert!(
        expected.iter().any(|(path, field, refusal)| response["scope"] == *path
            && response["correction"]["field"] == *field
            && response["correction"]["refusal"] == *refusal),
        "{response:#}"
    );
    assert!(!response.to_string().contains("can't"), "no English crosses IPC: {response}");
    nothing_built(&world);
}

/// The reviewed expectation of recording a correction for `asset`.
fn expected(asset: &Asset) -> [ExpectedAsset; 1] {
    [ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }]
}

/// The coded refusals of recording `corrections` for one frame: at the
/// preview, naming the frame, and at the confirm of the same plan
/// previewed below that check. Each carries the refused field and why.
async fn refused_at_entry(
    world: &World,
    expected: &[ExpectedAsset],
    corrections: &[CorrectionInput],
) -> [Value; 2] {
    let refused = world.library.preview_correction(expected, corrections).await.unwrap_err();
    assert_eq!(refused.code().as_str(), "correction_unpatchable", "{refused}");
    let previewed = serde_json::to_value(refused.response(None, None)).unwrap();
    assert_eq!(previewed["identity"], json!(corrections[0].asset_id), "{previewed:#}");
    let preview = world
        .catalog()
        .preview_correction(expected, corrections, apply_support::group_by_night)
        .await
        .unwrap();
    let confirmed = world.library.confirm_correction(preview.id, expected).await;
    let Err(refused) = confirmed else { panic!("the confirm takes {corrections:?}") };
    let confirmed = serde_json::to_value(refused.response(None, None)).unwrap();
    [previewed["correction"].clone(), confirmed["correction"].clone()]
}

/// Owner decisions (D-W123, LIB-FR-20): a correction no patched copy can
/// deliver, a value FITS can't hold or a field no header keyword carries,
/// is refused where it is recorded, at the preview and again at the
/// confirm, with a coded error naming the frame and field, and nothing is
/// recorded. The framing label is no header correction and is taken.
#[tokio::test]
async fn recording_a_correction_no_patched_copy_can_deliver_is_refused() {
    let world = catalogued(ViewMode::Copies).await;
    let asset = world.asset_at(&world.captures, HA[0]).await;
    let correction = |field: &str, value: Value| {
        [CorrectionInput { asset_id: asset.id, field: field.into(), value }]
    };
    for (field, value, refusal) in [
        ("object", json!("Hα"), "not_printable_ascii"),
        ("dateObs", json!("2026-10-12T20:00:00"), "no_keyword"),
        ("readoutMode", json!("High Gain"), "no_keyword"),
    ] {
        let refused = json!({ "field": field, "refusal": refusal });
        let found = refused_at_entry(&world, &expected(&asset), &correction(field, value)).await;
        assert_eq!(found, [refused.clone(), refused]);
    }
    assert_eq!(world.asset_at(&world.captures, HA[0]).await, asset, "nothing was recorded");
    let framing = correction(platevault_core::FRAMING_LABEL_FIELD, json!("Ha 2"));
    assert!(world.library.preview_correction(&expected(&asset), &framing).await.is_ok());
}

/// Owner decision 2026-10-19: clearing a value the frame's header holds
/// is refused where it is recorded, at the preview and again at the
/// confirm, as no header card holds an empty value, and nothing is
/// recorded. Clearing a field the header lacks undoes an earlier
/// correction and is taken.
#[tokio::test]
async fn clearing_a_value_the_header_holds_is_refused_and_undoing_a_correction_is_taken() {
    let world = catalogued(ViewMode::Copies).await;
    world.correct(HA[0], &[("object", json!("NGC 7000"))]).await;
    let asset = world.asset_at(&world.captures, HA[0]).await;
    assert_eq!(asset.observed.filter.as_deref(), Some("Ha"));
    assert_eq!(asset.observed.object, None);
    let cleared = |field: &str| {
        [CorrectionInput { asset_id: asset.id, field: field.into(), value: Value::Null }]
    };

    let refused = json!({ "field": "filter", "refusal": "no_value" });
    let found = refused_at_entry(&world, &expected(&asset), &cleared("filter")).await;
    assert_eq!(found, [refused.clone(), refused]);
    assert_eq!(world.asset_at(&world.captures, HA[0]).await, asset, "nothing was recorded");

    let preview =
        world.library.preview_correction(&expected(&asset), &cleared("object")).await.unwrap();
    world.library.confirm_correction(preview.id, &expected(&asset)).await.unwrap();
    let undone = world.asset_at(&world.captures, HA[0]).await;
    assert_eq!(undone.effective.object, None, "the correction is undone");
}

/// A HIERARCH alias leaves its value less room than a card on its own:
/// beside `HIERARCH TELESCOPE` a telescope value fits 57 characters, as
/// the FITS patcher works it out. A 60-character one is refused where it
/// is recorded, at the preview and again at the confirm, rather than at
/// Apply; on a frame without the alias it is taken.
#[tokio::test]
async fn a_value_longer_than_its_hierarch_alias_holds_is_refused_where_it_is_recorded() {
    let world = catalogued(ViewMode::Copies).await;
    let relative = "2026-10-12/J23_Hierarch_Light_001.fits";
    let alias = "HIERARCH TELESCOPE = 'Samyang 135'";
    let metadata = meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12");
    world.add_lights(&[(relative.to_owned(), metadata, frame(relative, true, &[alias]))]).await;
    let rig = "William Optics RedCat 51 WIFD 250 mm f/4.9 with 0.8x reducer";
    assert_eq!(rig.len(), 60);
    let telescope = |asset: &Asset| {
        [CorrectionInput { asset_id: asset.id, field: "telescope".into(), value: json!(rig) }]
    };

    let aliased = world.asset_at(&world.captures, relative).await;
    let refused = json!({ "field": "telescope", "refusal": "too_long" });
    let found = refused_at_entry(&world, &expected(&aliased), &telescope(&aliased)).await;
    assert_eq!(found, [refused.clone(), refused]);

    let plain = world.asset_at(&world.captures, HA[0]).await;
    assert!(world.library.preview_correction(&expected(&plain), &telescope(&plain)).await.is_ok());
}

/// A correction is reverted by entering the header's own value, which is
/// taken at the preview and the confirm even where that value breaks an
/// entry rule: here the UTF-8 OBJECT an XISF header holds, which FITS
/// can't. The frame reads its header value again.
#[tokio::test]
async fn reverting_to_the_header_value_is_taken_where_the_value_breaks_an_entry_rule() {
    let world = catalogued(ViewMode::Copies).await;
    let relative = "2026-10-12/J23_Coeur_Light_001.xisf";
    let coeur = "Cœur NGC 7000";
    let body = format!("<FITSKeyword name=\"OBJECT\" value=\"'{coeur}'\" comment=\"\"/>");
    let bytes = apply_support::xisf_frame(Some(body.as_str()), &[9_u8; 16], None);
    let metadata = CaptureMetadata {
        object: Some(coeur.into()),
        ..meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12")
    };
    world.add_lights(&[(relative.to_owned(), metadata, bytes)]).await;
    world.correct(relative, &[("object", json!("NGC 7000"))]).await;
    let corrected = world.asset_at(&world.captures, relative).await;
    assert_eq!(corrected.effective.object.as_deref(), Some("NGC 7000"));

    let object = |value: &str| {
        [CorrectionInput { asset_id: corrected.id, field: "object".into(), value: json!(value) }]
    };
    let refused = json!({ "field": "object", "refusal": "not_printable_ascii" });
    let found = refused_at_entry(&world, &expected(&corrected), &object("Cœur")).await;
    assert_eq!(found, [refused.clone(), refused], "another UTF-8 value is refused");

    let preview =
        world.library.preview_correction(&expected(&corrected), &object(coeur)).await.unwrap();
    world.library.confirm_correction(preview.id, &expected(&corrected)).await.unwrap();
    let reverted = world.asset_at(&world.captures, relative).await;
    assert_eq!(reverted.effective.object.as_deref(), Some(coeur), "the correction is reverted");
    assert_eq!(reverted.effective, reverted.observed);
}

/// The corrected frames are loaded as one batch for preview and confirm, and
/// a successful in-process preview lets confirm reuse its header findings.
#[tokio::test]
async fn correction_entry_checks_batch_frames_and_reuse_preview_header_results() {
    let world = catalogued(ViewMode::Copies).await;
    let first = world.asset_at(&world.captures, HA[0]).await;
    let second = world.asset_at(&world.captures, HA[1]).await;
    let expected = [expected(&first)[0].clone(), expected(&second)[0].clone()];
    let corrections = [
        CorrectionInput { asset_id: first.id, field: "object".into(), value: json!("NGC 7000") },
        CorrectionInput { asset_id: second.id, field: "object".into(), value: json!("M 31") },
    ];
    let preview = world.library.preview_correction(&expected, &corrections).await.unwrap();
    world.library.confirm_correction(preview.id, &expected).await.unwrap();
}

#[tokio::test]
async fn a_correction_of_a_frame_the_expectations_do_not_name_is_invalid_input() {
    let world = catalogued(ViewMode::Copies).await;
    let (named, other) = (
        world.asset_at(&world.captures, HA[0]).await,
        world.asset_at(&world.captures, HA[1]).await,
    );
    assert_eq!(other.observed.filter.as_deref(), Some("Ha"));
    for asset_id in [other.id, uuid::Uuid::new_v4()] {
        let cleared = [CorrectionInput { asset_id, field: "filter".into(), value: Value::Null }];
        let refused =
            world.library.preview_correction(&expected(&named), &cleared).await.unwrap_err();
        assert_eq!(refused.code().as_str(), "invalid_input", "{refused}");
    }
    assert_eq!(world.asset_at(&world.captures, HA[1]).await, other, "nothing was recorded");
}

/// A card's comment never refuses a value that fits a card on its own:
/// NINA's `OBJECT` comment leaves 35 characters, and "Heart and Soul
/// Nebulae (IC 1805 / IC 1848)" reaches the patched copy in one card, its
/// comment cut to the room left.
#[tokio::test]
async fn a_value_longer_than_the_room_a_card_comment_leaves_reaches_the_copy() {
    let world = catalogued(ViewMode::Copies).await;
    let relative = "2026-10-12/J23_NINA_Light_001.fits";
    let nina = "OBJECT  = 'IC 1805'            / Name of the object of interest";
    let metadata = CaptureMetadata {
        object: Some("IC 1805".into()),
        ..meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12")
    };
    world.add_lights(&[(relative.to_owned(), metadata, frame(relative, true, &[nina]))]).await;
    let heart = "Heart and Soul Nebulae (IC 1805 / IC 1848)";
    world.correct(relative, &[("object", json!(heart))]).await;
    world.hold(HA[0]).await;

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let copy = placed(&world, relative);
    assert_eq!(read_fits(&copy).object.as_deref(), Some(heart));
    let object: Vec<String> =
        cards(&copy).into_iter().filter(|card| card.starts_with("OBJECT")).collect();
    assert_eq!(object, [format!("OBJECT  = '{heart}' / Name of the object of")]);
    assert!(!cards(&copy).iter().any(|card| card.starts_with("CONTINUE")));
}

/// Owner decision (D-W123): a corrected XISF frame is patched too, an
/// Image with a Thumbnail among them. Its copy is a byte copy of the
/// original whose header keywords carry the corrected value, read back by
/// `PlateVault`'s XISF reader, with both data blocks unchanged; its entry
/// is a Copy that records the digest it was proven to hold, and the
/// original keeps its bytes.
#[tokio::test]
async fn a_corrected_xisf_frame_reaches_the_view_as_a_patched_copy() {
    let world = catalogued(ViewMode::Copies).await;
    let metadata = meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12");
    world.add_lights(&[(XISF.to_owned(), metadata, xisf_light(true))]).await;
    world.correct(XISF, &[("object", json!("NGC 7000"))]).await;
    world.hold(HA[0]).await;
    let original = digest(&world.light(XISF));

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!((report.corrected_values, report.patched_copies), (1, 1));
    let copy = placed(&world, XISF);
    let read = metadata_xisf::XisfExtractor.extract(&copy).unwrap().unwrap();
    assert_eq!(read.object.as_deref(), Some("NGC 7000"));
    assert_eq!(read.filter.as_deref(), Some("Ha"));
    let blocks: Vec<u8> = [[9_u8; 16].as_slice(), &[5_u8; 4]].concat();
    assert!(fs::read(&copy).unwrap().ends_with(&blocks), "both data blocks are unchanged");
    assert_eq!(digest(&world.light(XISF)), original, "the original keeps its bytes");
    let read = metadata_xisf::XisfExtractor.extract(&world.light(XISF)).unwrap().unwrap();
    assert_eq!(read.object, None);

    let installed = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    let entry = installed.entries.iter().find(|entry| !entry.header_patch.is_empty()).unwrap();
    assert_eq!(entry.placement, EntryPlacement::Copy, "a patched copy is never a clone");
    assert_eq!(entry.patched_sha256.as_deref(), Some(digest(&copy).as_str()));
}

/// PREP-FR-04 with PREP-FR-03: a Symlinks View holds symlinks beside the
/// isolated patched copies of its corrected frames, never dropping a
/// correction; the sheet's footprint counts those copies' bytes, and a
/// re-Apply after a further correction replaces the copy and retires the
/// old one as `PlateVault`'s own.
#[tokio::test]
async fn a_symlinks_view_holds_patched_copies_of_its_corrected_frames() {
    let world = corrected(ViewMode::Symlinks).await;
    let preview = world.preview().await;
    let copies =
        preview.entries.iter().filter(|entry| entry.placement == EntryPlacement::Copy).count();
    assert_eq!(copies, 2, "{:#?}", preview.entries);
    let corrected_bytes: u64 = [SEP24, SEP28]
        .iter()
        .map(|relative| fs::metadata(world.light(relative)).unwrap().len())
        .sum();
    assert_eq!(
        preview.footprint,
        ViewFootprint { frames: 2, bytes: corrected_bytes, cloned: 0 },
        "the footprint counts the patched copies, never as clones"
    );

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(report.patched_copies, 2);
    assert_eq!(report.footprint, preview.footprint);
    let (sep24, sep28) = (placed(&world, SEP24), placed(&world, SEP28));
    for copy in [&sep24, &sep28] {
        assert!(fs::symlink_metadata(copy).unwrap().is_file(), "{} is a copy", copy.display());
    }
    assert_eq!(read_fits(&sep24).object.as_deref(), Some("NGC 7000"));
    assert_eq!(read_fits(&sep28).telescop.as_deref(), Some("RedCat 51"));
    let links = World::tree(&world.view())
        .into_iter()
        .filter(|entry| !entry.ends_with("J23_24Sep_Light_001.fits"))
        .filter(|entry| !entry.ends_with("J23_28Sep_Light_001.fits"))
        .map(|entry| fs::symlink_metadata(world.view().join(entry)).unwrap())
        .collect::<Vec<_>>();
    assert!(!links.is_empty() && links.iter().all(|link| link.file_type().is_symlink()));

    world.correct(SEP24, &[("object", json!("North America Nebula"))]).await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.leftovers.is_empty(), "the old patched copy was retired: {report:#?}");
    let read = read_fits(&placed(&world, SEP24));
    assert_eq!(read.object.as_deref(), Some("North America Nebula"));
}

/// A corrected input neither FITS nor XISF can't be patched, and PREP-FR-03
/// forbids letting the source value reach the tool: Apply refuses before
/// building, with its own code naming the input.
#[tokio::test]
async fn a_corrected_input_neither_fits_nor_xisf_refuses_apply_naming_it() {
    let world = catalogued(ViewMode::Copies).await;
    let raw = "2026-10-12/J23_Light_001.cr2";
    let metadata = meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12");
    world.add_lights(&[(raw.to_owned(), metadata, b"II*\0 J23 raw light".to_vec())]).await;
    world.correct(raw, &[("object", json!("NGC 7000"))]).await;
    let session = world.hold(HA[0]).await;
    let input = serde_json::to_value(NativePath::from_path(&world.light(raw))).unwrap();

    let preview = world.preview().await;
    let named = undeliverable(&preview);
    assert_eq!(named, [(input.clone(), json!("object"), json!("unsupported_format"))]);
    let refused = world.library.apply(&World::request(&preview), &Unattended).await.unwrap_err();
    assert_eq!(refused.code().as_str(), "correction_format_unpatchable", "{refused}");
    let response = serde_json::to_value(refused.response(None, None)).unwrap();
    assert_eq!(response["identity"], json!(session), "{response:#}");
    assert_eq!(response["scope"], input);
    assert_eq!(
        response["correction"],
        json!({ "field": "object", "refusal": "unsupported_format" })
    );
    nothing_built(&world);
}

/// PREP-FR-04, PREP-AC-25: with the originals and the Project folder on one
/// APFS volume, every Copies entry is a clone, and the sheet says so before
/// the build makes them.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn copies_on_one_clone_capable_volume_are_cloned_in_the_sheet_and_the_report() {
    let world = world(ViewMode::Copies).await;
    let preview = world.preview().await;
    assert_ne!(preview.entries.len(), 0);
    assert!(
        preview.entries.iter().all(|entry| entry.placement == EntryPlacement::Clone),
        "{:#?}",
        preview.entries
    );
    let frames = u64::try_from(preview.entries.len()).unwrap();
    let bytes = preview.entries.iter().map(|entry| entry.size_bytes).sum();
    assert_eq!(preview.footprint, ViewFootprint { frames, bytes, cloned: frames }, "(cloned)");
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(report.footprint, preview.footprint, "the build cloned what the sheet said");
    let installed = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    assert!(installed.entries.iter().all(|entry| entry.placement == EntryPlacement::Clone));
}

/// Text an OS error carries; none of it may reach an Apply response (CT3).
fn assert_no_os_text(response: &impl serde::Serialize, sentinel: &Path) {
    let text = serde_json::to_string(response).unwrap();
    for os in ["os error", "Permission denied", "No such file or directory"] {
        assert!(!text.contains(os), "{os:?} reached the response: {text}");
    }
    let sentinel = sentinel.display().to_string();
    assert!(!text.contains(&sentinel), "{sentinel} reached the response: {text}");
}

/// Point the Project's processing location at `parent`.
async fn process_in(world: &World, parent: &Path) {
    let parent = serde_json::to_string(&NativePath::from_path(parent)).unwrap();
    world
        .sql(
            "UPDATE projects SET processing_parent = ?2 WHERE id = ?1",
            &[&world.project.to_string(), &parent],
        )
        .await;
}

fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

/// CT3: an original whose folder can't be searched and a processing
/// location that is gone are blockers that name the path, never the OS
/// error text.
#[tokio::test]
async fn no_blocker_carries_os_error_text() {
    let world = world(ViewMode::Copies).await;
    let night = world.light(HA[0]).parent().unwrap().to_path_buf();
    let gone = world.temp.path().join("SENTINEL-gone/Processing");
    process_in(&world, &gone).await;
    set_mode(&night, 0o000);
    let preview = world.preview().await;
    set_mode(&night, 0o755);
    let tags: Vec<Value> = preview
        .blockers
        .iter()
        .map(|blocker| serde_json::to_value(blocker).unwrap()["blocker"].clone())
        .collect();
    assert!(tags.contains(&json!("original_changed")), "{:#?}", preview.blockers);
    assert!(tags.contains(&json!("processing_location_unavailable")), "{:#?}", preview.blockers);
    assert_no_os_text(&preview.blockers, Path::new("/SENTINEL-unused"));
}

/// Makes the Project folder read-only once the build is verified, so moving
/// the old View aside fails on the OS.
struct ReadOnlyAtSwap(PathBuf);

impl ApplyControl for ReadOnlyAtSwap {
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        if phase == ApplyPhase::BuildVerified {
            set_mode(&self.0, 0o555);
        }
        false
    }
}

/// CT3: an original that can't be read when Apply snapshots it is a named
/// failure, and a swap the OS refuses ends Failed; each reports its stop
/// code, and neither the report's failures nor anything else in it carry
/// the OS text or the absolute Project folder (the sentinel) it named.
#[tokio::test]
async fn an_apply_the_os_refuses_reports_no_os_text() {
    let world = world(ViewMode::Symlinks).await;
    let sentinel = world.temp.path().join("SENTINEL-9f3c/Processing");
    fs::create_dir_all(&sentinel).unwrap();
    let sentinel = fs::canonicalize(sentinel).unwrap();
    process_in(&world, &sentinel).await;
    let folder = sentinel.join(apply_support::PROJECT);

    let original = world.light(HA[0]);
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    set_mode(&original, 0o000);
    let unread = world.library.apply(&World::request(&preview), &Unattended).await.unwrap();
    set_mode(&original, 0o644);
    assert_eq!(unread.outcome, Some(ApplyOutcome::Failed), "{unread:#?}");
    assert!(!unread.failures.is_empty(), "{unread:#?}");
    let count = u64::try_from(unread.failures.len()).unwrap();
    assert_eq!(unread.stop, Some(ApplyStop::OriginalsUnverified { count }), "{unread:#?}");
    assert_no_os_text(&unread, &folder);

    let first = world.apply().await;
    assert_eq!(first.outcome, Some(ApplyOutcome::Applied), "{first:#?}");
    let preview = world.preview().await;
    let control = ReadOnlyAtSwap(folder.clone());
    let refused = world.library.apply(&World::request(&preview), &control).await;
    set_mode(&folder, 0o755);
    let refused = refused.unwrap();
    assert_eq!(refused.outcome, Some(ApplyOutcome::Failed), "{refused:#?}");
    assert_eq!(refused.stop, Some(ApplyStop::AsideFailed), "{refused:#?}");
    assert_no_os_text(&refused, &folder);
}
