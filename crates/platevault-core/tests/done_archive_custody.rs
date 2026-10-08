// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Done / Archive custody (spec 071 STO-FR-06/07/08/13/14/15/16, STO-AC-05/
//! 07/10/17/18/19/21/22/23; spec 065 PRJ-AC-17/27; spec 064 LIB-AC-19; D06,
//! D19, D-W43, D-W46, D-W69, D-W74) over real files: Archive transfers the
//! sessions no open Project's run uses to templated paths, repairs their
//! references before any source is retired and shows them Archived until a
//! reviewed restore; each trash offer is its own approval, re-verified
//! immediately before every move, and goes to the OS Trash only.
#![cfg(unix)]

#[path = "support/done_archive_custody.rs"]
mod custody_support;
#[path = "support/done_archive.rs"]
mod done_archive_support;
#[path = "support/home.rs"]
mod home_support;
#[path = "support/prepare.rs"]
mod prepare_support;
#[path = "support/results.rs"]
mod results_support;
mod support;

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use custody_support::{
    approve_duplicates, approve_intermediates, approve_rejected, archive_location, copies_in,
    custody_codes, file_in, open_project, project_without, record, session_of, Bin,
};
use done_archive_support::{
    done, file_of, light, mark_done, project_of, record_preparation, set_quality, sheet,
};
use persistence_library::TrashedQuery;
use platevault_core::*;
use prepare_support::{overwrite_in_place, tree, world, Watch, World, HA_LIGHTS, OIII_LIGHTS};
use results_support::{prepared, results_dir, stack};
use uuid::Uuid;

fn ids(items: &[ArchiveItem]) -> BTreeSet<Uuid> {
    items.iter().map(|item| item.asset_id).collect()
}

fn item<'a>(transfer: &'a ArchiveTransfer, asset: &Asset) -> &'a ArchiveItem {
    transfer
        .items
        .iter()
        .find(|item| item.asset_id == asset.id)
        .unwrap_or_else(|| panic!("{} is not an item of {transfer:#?}", asset.id))
}

/// The world's four lights, Ha then OIII.
async fn lights(world: &World) -> [Asset; 4] {
    [
        light(world, HA_LIGHTS[0]).await,
        light(world, HA_LIGHTS[1]).await,
        light(world, OIII_LIGHTS[0]).await,
        light(world, OIII_LIGHTS[1]).await,
    ]
}

/// The file an archive item wrote below `archive`.
fn destination(archive: &Location, item: &ArchiveItem) -> PathBuf {
    archive.path.to_path_buf().unwrap().join(item.destination_path.relative_path().unwrap())
}

/// A record as the wire carries it, for records that compare no other way.
fn json(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap()
}

/// STO-AC-17, STO-FR-13, PRJ-FR-14: Archive keeps the session a run of open
/// Project B uses, naming B, and transfers the session that open Project C
/// only has as a candidate. B's run membership and totals are unchanged, and
/// every transferred frame keeps its catalog record, now at its archive path.
#[tokio::test]
async fn archive_keeps_sessions_used_by_non_done_project() {
    let world = world().await;
    let ha = session_of(&world, HA_LIGHTS[0]).await;
    let oiii = session_of(&world, OIII_LIGHTS[0]).await;
    let (b, b_run) = project_without(&world, "NGC 7000 Wide", "Wide-Ha", &[oiii]).await;
    let c = open_project(&world, "NGC 7000 Candidates").await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    let catalog = world.catalog();
    let b_membership = json(&catalog.view_revision(b_run, 1).await.unwrap());
    let b_progress = world.library.project_progress(b).await.unwrap();
    let [ha_1, ha_2, oiii_1, oiii_2] = lights(&world).await;

    let review = world.library.archive_review(project, archive.id).await.unwrap();
    assert_eq!((review.kind, review.state), (ArchiveKind::Archive, ArchiveState::Reviewed));
    assert_eq!(
        review.kept,
        vec![KeptSession {
            session_id: ha,
            projects: vec![ProjectName { id: b, name: "NGC 7000 Wide".into() }],
        }]
    );
    assert_eq!(ids(&review.items), BTreeSet::from([oiii_1.id, oiii_2.id]), "{review:#?}");
    assert!(review.items.iter().all(|item| item.hold.is_none() && item.session_id == oiii));
    assert!(file_of(&world.captures, &oiii_1).exists(), "review moves nothing");

    let bin = Bin::new(&world);
    let transfer = world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled, "{transfer:#?}");
    for frame in [&oiii_1, &oiii_2] {
        let item = item(&transfer, frame);
        assert_eq!(item.outcome, Some(ArchiveOutcome::Archived), "{item:#?}");
        assert!(item.repointed, "{item:#?}");
        let source = file_of(&world.captures, frame);
        assert!(!source.exists(), "the retired source left its path");
        let trashed = bin.kept(&source).expect("the source went to the OS Trash");
        assert_eq!(support::digest(&destination(&archive, item)), support::digest(&trashed));
        let moved = record(&world, frame.id).await;
        assert_eq!((moved.location_id, &moved.relative_path), (archive.id, &item.destination_path));
        assert_eq!(moved.availability, Availability::Available);
    }
    for frame in [&ha_1, &ha_2] {
        assert!(file_of(&world.captures, frame).exists(), "a kept session stays at its path");
        assert_eq!(record(&world, frame.id).await.location_id, world.captures.id);
    }
    assert_eq!(json(&catalog.view_revision(b_run, 1).await.unwrap()), b_membership);
    assert_eq!(world.library.project_progress(b).await.unwrap(), b_progress);
    let candidates = catalog.project_candidates(c).await.unwrap();
    assert!(candidates.iter().any(|candidate| candidate.session_id == oiii), "{candidates:#?}");
}

/// STO-FR-06, STO-AC-17, D-W20: Archive lays every destination out by the
/// light template (its Target is the session's confirmed Target) and names
/// the destination volume, free space and writability before anything moves.
#[tokio::test]
async fn archive_paths_follow_templates() {
    let world = world().await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    world
        .library
        .save_naming_template(NamingFrameType::Light, "{target}/{date}/{filter}")
        .await
        .unwrap();
    let frames = lights(&world).await;

    let review = world.library.archive_review(project, archive.id).await.unwrap();
    let expected = [
        "NGC 7000/2026-09-18/Ha/Ha_001.fits",
        "NGC 7000/2026-09-18/Ha/Ha_002.fits",
        "NGC 7000/2026-09-24/OIII/OIII_001.fits",
        "NGC 7000/2026-09-24/OIII/OIII_002.fits",
    ];
    for (frame, path) in frames.iter().zip(expected) {
        let item = item(&review, frame);
        assert_eq!(item.destination_path, NativePath::from_path(Path::new(path)), "{item:#?}");
        assert!(item.fallbacks.is_empty(), "{item:#?}");
        assert_eq!(item.sha256.as_deref().map(str::len), Some(64));
    }
    assert_eq!(review.destinations.len(), 1, "{review:#?}");
    let target = &review.destinations[0];
    assert_eq!(target.location_id, archive.id);
    assert_eq!(target.identity.as_ref(), Some(&archive.identity));
    assert_eq!(target.writability, Writability::Writable);
    assert!(target.free_bytes.is_some_and(|free| free >= target.needed_bytes));
    assert_eq!(
        target.needed_bytes,
        frames.iter().map(|frame| frame.fingerprint.size_bytes).sum::<u64>()
    );
    assert!(target.blocked.is_none());

    let transfer =
        world.library.archive_execute(review.id, Bin::new(&world).trash()).await.unwrap();
    for (frame, path) in frames.iter().zip(expected) {
        assert_eq!(item(&transfer, frame).outcome, Some(ArchiveOutcome::Archived));
        assert!(file_in(&archive, path).exists(), "{path} holds the archived copy");
        assert_eq!(
            record(&world, frame.id).await.relative_path,
            NativePath::from_path(Path::new(path))
        );
    }
}

/// STO-AC-10, STO-FR-07, D06: a prepared link changed outside `PlateVault`
/// fails its reference repair. That frame's reference reads blocked and its
/// source is retained with its catalog record; the archive copy it wrote and
/// nothing reads is discarded, so a later review offers the frame again
/// rather than holding its archive path as occupied. Every other frame's link
/// is rebuilt to its archive path before its source is retired.
#[tokio::test]
async fn reference_repair_failure_blocks_retirement() {
    let world = world().await;
    let outcome = prepared(&world).await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    let frames = lights(&world).await;
    let link_of = |asset: &Asset| {
        let entry = outcome
            .prepared
            .iter()
            .find(|entry| entry.asset_id == Some(asset.id))
            .expect("the run prepared every light");
        assert_eq!(entry.kind, PreparedEntryKind::Symlink);
        entry.path.to_path_buf().unwrap()
    };

    let review = world.library.archive_review(project, archive.id).await.unwrap();
    for frame in &frames {
        let item = item(&review, frame);
        assert_eq!(item.references.len(), 1, "{item:#?}");
        let reference = &item.references[0];
        assert_eq!(
            (reference.mode, reference.update),
            (PreparedEntryKind::Symlink, ReferenceUpdate::RepointLink)
        );
        assert_eq!(reference.state, ReferenceState::Pending);
        assert_eq!(reference.run.view_id, world.run);
    }
    let broken = &frames[2];
    let elsewhere = world.temp.path().join("elsewhere.fits");
    fs::write(&elsewhere, b"another tool's file").unwrap();
    fs::remove_file(link_of(broken)).unwrap();
    std::os::unix::fs::symlink(&elsewhere, link_of(broken)).unwrap();
    let source = file_of(&world.captures, broken);
    let original = support::digest(&source);

    let bin = Bin::new(&world);
    let transfer = world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled);
    let held = item(&transfer, broken);
    assert_eq!(held.outcome, Some(ArchiveOutcome::SourceRetained), "{held:#?}");
    assert!(!held.repointed);
    assert_eq!(held.references[0].state, ReferenceState::Blocked, "{held:#?}");
    assert!(held.references[0].reason.is_some());
    assert_eq!(support::digest(&source), original, "the source keeps its bytes");
    assert!(!destination(&archive, held).exists(), "the unused archive copy is discarded");
    assert!(bin.kept(&source).is_none(), "the source was never retired");
    assert_eq!(record(&world, broken.id).await.location_id, world.captures.id);
    assert_eq!(fs::read_link(link_of(broken)).unwrap(), elsewhere, "the foreign link is untouched");

    for frame in frames.iter().filter(|frame| frame.id != broken.id) {
        let item = item(&transfer, frame);
        assert_eq!(item.outcome, Some(ArchiveOutcome::Archived), "{item:#?}");
        assert_eq!(item.references[0].state, ReferenceState::Completed);
        assert_eq!(fs::read_link(link_of(frame)).unwrap(), destination(&archive, item));
        assert!(!file_of(&world.captures, frame).exists());
    }
    let again = world.library.archive_review(project, archive.id).await.unwrap();
    assert_eq!(item(&again, broken).hold, None, "{again:#?}");
    let journal =
        world.catalog().storage_operation(transfer.storage_operation_id.unwrap()).await.unwrap();
    let outcomes: Vec<Option<ItemOutcome>> =
        journal.items.iter().map(|item| item.outcome).collect();
    assert_eq!(
        outcomes.iter().filter(|outcome| **outcome == Some(ItemOutcome::Moved)).count(),
        3,
        "{journal:#?}"
    );
    assert_eq!(
        outcomes.iter().filter(|outcome| **outcome == Some(ItemOutcome::Blocked)).count(),
        1
    );
}

/// STO-AC-10, STO-FR-07, D06: when retiring a replaced link through the OS
/// Trash ends Uncertain, the rebuilt link already reads the archive copy.
/// Its reference reads Uncertain, the source is retained, and the copy that
/// link reads is never discarded, so no prepared link dangles.
#[tokio::test]
async fn uncertain_link_repair_keeps_the_archive_copy() {
    let world = world().await;
    let outcome = prepared(&world).await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    let frames = lights(&world).await;
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    let bin = Bin::new(&world);
    bin.misreport(&outcome.revision.folder.to_path_buf().unwrap());

    let transfer = world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled, "{transfer:#?}");
    for frame in &frames {
        let item = item(&transfer, frame);
        assert_eq!(item.outcome, Some(ArchiveOutcome::SourceRetained), "{item:#?}");
        assert_eq!(item.references[0].state, ReferenceState::Uncertain, "{item:#?}");
        let copy = destination(&archive, item);
        assert!(copy.exists(), "the copy the rebuilt link reads stays: {item:#?}");
        let link = item.references[0].entry_path.to_path_buf().unwrap();
        assert_eq!(fs::read_link(&link).unwrap(), copy, "the rebuilt link reads the copy");
        assert!(file_of(&world.captures, frame).exists(), "the source is retained");
    }
}

/// STO-FR-05/07, D06: the prepared entries a run's Clean up moved to the OS
/// Trash read no frame any more. After Complete, Clean up and Mark Done,
/// Archive reviews no reference update for them and archives every frame.
#[tokio::test]
async fn archive_after_clean_up_archives_every_frame() {
    let world = world().await;
    prepared(&world).await;
    world.library.mark_view_complete(world.run).await.unwrap();
    let bin = Bin::new(&world);
    let request =
        CleanupRequest::CleanUp { view_id: world.run, selection: CleanupSelection::default() };
    let review = world.library.review_cleanup(&request, bin.trash()).await.unwrap();
    let cleaned = world.library.run_cleanup(review.id.unwrap(), bin.trash()).await.unwrap();
    assert!(!cleaned.moved.is_empty() && cleaned.left.is_empty(), "{cleaned:#?}");
    let project = project_of(&world).await;
    mark_done(&world, project).await;
    let archive = archive_location(&world).await;
    let frames = lights(&world).await;

    let review = world.library.archive_review(project, archive.id).await.unwrap();
    for frame in &frames {
        let item = item(&review, frame);
        assert!(item.hold.is_none() && item.references.is_empty(), "{item:#?}");
    }
    let transfer = world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled);
    for frame in &frames {
        let item = item(&transfer, frame);
        assert_eq!(item.outcome, Some(ArchiveOutcome::Archived), "{item:#?}");
        assert!(destination(&archive, item).exists());
        assert_eq!(record(&world, frame.id).await.location_id, archive.id);
    }
}

/// D06, STO-FR-07: the prepared entries that read a frame and the kept-session
/// rule are re-read immediately before each retirement. While the first Ha
/// frame retires, open Project B starts using the Ha session and records a
/// prepared link to an OIII frame of a session it does not select: the other
/// Ha frame and that OIII frame keep their sources, each naming why, and the
/// frame nothing changed for retires.
#[tokio::test]
async fn references_and_kept_sessions_recheck_before_retirement() {
    let world = world().await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    let [ha_1, ha_2, oiii_1, oiii_2] = lights(&world).await;
    let oiii = session_of(&world, OIII_LIGHTS[0]).await;
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    assert!(review.items.iter().all(|item| item.hold.is_none()), "{review:#?}");
    assert_eq!(review.items[0].asset_id, ha_1.id, "Ha_001 retires first");
    let bin = Bin::new(&world);
    let (reached, release) = bin.hold_next();
    let running = {
        let (library, trash) = (Arc::clone(&world.library), bin.trash());
        tokio::spawn(async move { library.archive_execute(review.id, trash).await })
    };
    tokio::time::timeout(Duration::from_secs(20), reached.notified())
        .await
        .expect("retirement starts");
    let (_, b_run) = project_without(&world, "NGC 7000 Wide", "Wide-Ha", &[oiii]).await;
    let linked = file_of(&world.captures, &oiii_1);
    record_preparation(&world, b_run, InputMode::LinkedView, &[(oiii_1.id, &oiii_1, linked)]).await;
    drop(release);
    let transfer = running.await.unwrap().unwrap();

    assert_eq!(transfer.state, ArchiveState::Settled, "{transfer:#?}");
    for frame in [&ha_1, &oiii_2] {
        assert_eq!(item(&transfer, frame).outcome, Some(ArchiveOutcome::Archived));
    }
    for (frame, code, needle) in [
        (&ha_2, ReasonCode::Protected, "NGC 7000 Wide"),
        (&oiii_1, ReasonCode::DestinationMismatch, "prepared entries"),
    ] {
        let item = item(&transfer, frame);
        assert_eq!(item.outcome, Some(ArchiveOutcome::SourceRetained), "{item:#?}");
        let reason = item.reason.as_ref().expect("the retained source names why");
        assert_eq!(reason.code, code, "{item:#?}");
        assert!(reason.detail.contains(needle), "{item:#?}");
        assert!(file_of(&world.captures, frame).exists(), "its source stays in place");
        assert!(bin.kept(&file_of(&world.captures, frame)).is_none());
    }
}

/// STO-FR-15, STO-AC-19: every physical copy of a rejected frame moves, or
/// none does. A frame with both copies on volumes with an OS Trash moves
/// whole; a frame with one copy where the OS deletes immediately is refused
/// whole, naming that copy, and both its copies stay.
#[tokio::test]
async fn rejected_move_whole_frame_or_refused() {
    let world = world().await;
    let (second, extra) = copies_in(&world, "Astro-T7/Captures B", &[HA_LIGHTS[0]]).await;
    let (third, other) = copies_in(&world, "NAS/Captures C", &[HA_LIGHTS[1]]).await;
    let (ha_1, ha_2) = (light(&world, HA_LIGHTS[0]).await, light(&world, HA_LIGHTS[1]).await);
    for asset in [&ha_1, &ha_2, &extra[0], &other[0]] {
        set_quality(&world, &record(&world, asset.id).await, Quality::Unusable).await;
    }
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    assert_eq!(offered.rejected_frames.n, 2, "{:#?}", offered.rejected_frames);
    let bin = Bin::new(&world);
    bin.refuse(&third.path.to_path_buf().unwrap());

    let summary = world
        .library
        .trash_rejected_execute(project, &approve_rejected(&offered), bin.trash())
        .await
        .unwrap();
    assert_eq!(summary.offer, TrashOffer::RejectedFrames);
    assert_eq!(summary.state, StorageOperationState::Settled);
    assert_eq!(summary.moved.len(), 1, "{summary:#?}");
    let whole = [file_of(&world.captures, &ha_1), file_of(&second, &extra[0])];
    let moved: BTreeSet<PathBuf> =
        summary.moved[0].paths.iter().map(|path| path.to_path_buf().unwrap()).collect();
    assert_eq!(moved, whole.iter().cloned().collect());
    for path in &whole {
        assert!(
            !path.exists() && bin.kept(path).is_some(),
            "{} went to the OS Trash",
            path.display()
        );
    }
    assert_eq!(summary.refused.len(), 1, "{summary:#?}");
    let refused = &summary.refused[0];
    assert_eq!(custody_codes(refused), vec![ReasonCode::TrashUnsupported], "{refused:#?}");
    assert!(refused
        .reasons
        .iter()
        .any(|reason| matches!(reason, MoveRefusal::FrameIncomplete { .. })));
    for path in [file_of(&world.captures, &ha_2), file_of(&third, &other[0])] {
        assert!(path.exists(), "{} stays in place", path.display());
    }
    for asset in [&ha_2, &other[0]] {
        assert_eq!(record(&world, asset.id).await.availability, Availability::Available);
    }
    assert_eq!(summary.moved_bytes, ha_1.fingerprint.size_bytes + extra[0].fingerprint.size_bytes);
}

/// STO-FR-14: the rejected-frames Size is the expected reclaim. A copy whose
/// bytes a Complete run's prepared hardlink still holds reclaims nothing, so
/// its bytes leave the Size while the frame stays offered; once Clean up
/// moved that hardlink to the OS Trash, they count again.
#[tokio::test]
async fn rejected_size_excludes_bytes_a_hardlink_still_holds() {
    let world = world().await;
    let profile = world.siril("exit 0").await;
    let request = world.request(&profile, InputMode::LinkedView, Some(LinkKind::Hardlink));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let ha_1 = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &ha_1, Quality::Unusable).await;
    let project = done(&world).await;
    let offer = sheet(&world, project).await.rejected_frames;
    assert_eq!(offer.n, 1, "{offer:#?}");
    assert_eq!((offer.size_bytes, offer.frames[0].size_bytes), (0, 0), "{offer:#?}");

    let bin = Bin::new(&world);
    let request =
        CleanupRequest::CleanUp { view_id: world.run, selection: CleanupSelection::default() };
    let review = world.library.review_cleanup(&request, bin.trash()).await.unwrap();
    let cleaned = world.library.run_cleanup(review.id.unwrap(), bin.trash()).await.unwrap();
    assert!(!cleaned.moved.is_empty() && cleaned.left.is_empty(), "{cleaned:#?}");
    let offer = sheet(&world, project).await.rejected_frames;
    let size = ha_1.fingerprint.size_bytes;
    assert_eq!((offer.size_bytes, offer.frames[0].size_bytes), (size, size), "{offer:#?}");
}

/// STO-AC-21, STO-FR-14/16, PRJ-FR-15: the sheet lists each custody refusal
/// when it opens, before any approval. An intermediate on a volume with no OS
/// Trash, and a rejected frame whose only copy sits there, are refused with
/// that reason and leave N and Size; the other intermediates are offered.
#[tokio::test]
async fn sheet_lists_custody_refusals_when_it_opens() {
    let world = world().await;
    prepared(&world).await;
    let results = results_dir(&world);
    let files: Vec<PathBuf> =
        (1..=4).map(|n| results.join(format!("process/pp_light_0000{n}.fit"))).collect();
    for file in &files {
        stack(file, &[("OBJECT", "'NGC 7000'")]);
    }
    world.library.rescan_results(ResultOwner::Run { view_id: world.run }).await.unwrap();
    let ha_1 = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &ha_1, Quality::Unusable).await;
    let project = done(&world).await;
    let bin = Bin::new(&world);
    bin.refuse(&files[3]);
    bin.refuse(&file_of(&world.captures, &ha_1));

    let sheet = world.library.done_archive_review(project, bin.trash()).await.unwrap();
    let no_trash = |custody: &[MoveRefusal]| {
        matches!(custody, [MoveRefusal::Custody { reason, .. }]
            if reason.code == ReasonCode::TrashUnsupported)
    };
    let offer = &sheet.intermediates;
    assert_eq!(offer.n, 3, "{offer:#?}");
    let [refused] = offer.refused.as_slice() else {
        panic!("one intermediate is refused: {offer:#?}");
    };
    assert_eq!(refused.path.to_path_buf().unwrap(), files[3]);
    assert!(no_trash(&refused.custody), "{refused:#?}");
    let frames = &sheet.rejected_frames;
    assert_eq!((frames.n, frames.size_bytes), (0, 0), "{frames:#?}");
    let [frame] = frames.refused.as_slice() else { panic!("one refused frame: {frames:#?}") };
    assert_eq!(frame.frame_key, ha_1.id);
    assert!(frame.reasons.is_empty() && no_trash(&frame.custody), "{frame:#?}");
}

/// D19, STO-AC-19, STO-AC-14: a file changed in place with its size and
/// modification time preserved is refused just before it would move, naming
/// the drift, and stays; the other approved frame moves. Archive refuses the
/// drifted source the same way: nothing is retired or repointed for it.
#[tokio::test]
async fn drift_before_move_refused() {
    let world = world().await;
    let [ha_1, ha_2, oiii_1, _] = lights(&world).await;
    for asset in [&ha_1, &oiii_1] {
        set_quality(&world, asset, Quality::Unusable).await;
    }
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    assert_eq!(offered.rejected_frames.n, 2);
    let drifted = file_of(&world.captures, &ha_1);
    overwrite_in_place(&drifted);
    let bin = Bin::new(&world);

    let summary = world
        .library
        .trash_rejected_execute(project, &approve_rejected(&offered), bin.trash())
        .await
        .unwrap();
    assert_eq!(summary.moved.iter().map(|moved| moved.id).collect::<Vec<_>>(), vec![oiii_1.id]);
    assert_eq!(summary.refused.len(), 1, "{summary:#?}");
    assert_eq!(summary.refused[0].id, ha_1.id);
    assert_eq!(custody_codes(&summary.refused[0]), vec![ReasonCode::SourceDrift]);
    assert!(drifted.exists() && bin.kept(&drifted).is_none(), "the drifted frame stays in place");
    assert_ne!(record(&world, ha_1.id).await.availability, Availability::Trashed);

    let archive = archive_location(&world).await;
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    let transfer = world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    let held = item(&transfer, &ha_1);
    assert_eq!(held.outcome, Some(ArchiveOutcome::Blocked), "{held:#?}");
    assert_eq!(held.reason.as_ref().map(|reason| reason.code), Some(ReasonCode::SourceDrift));
    assert!(drifted.exists() && !held.repointed);
    assert_eq!(record(&world, ha_1.id).await.location_id, world.captures.id);
    assert_eq!(item(&transfer, &ha_2).outcome, Some(ArchiveOutcome::Archived));
}

/// LIB-FR-18, LIB-AC-19, PRJ-AC-17: moved rejected frames keep their records
/// as Trashed, each with the operation that trashed it, its verified digest
/// and the Complete run whose fixed membership still lists it. They leave
/// the Project's candidates and the sheet, the Sessions "Trashed" filter lists
/// them, and their bytes are in the OS Trash.
#[tokio::test]
async fn moved_frames_marked_trashed() {
    let world = world().await;
    let [ha_1, ha_2, ..] = lights(&world).await;
    for asset in [&ha_1, &ha_2] {
        set_quality(&world, asset, Quality::Unusable).await;
    }
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    let bin = Bin::new(&world);
    let summary = world
        .library
        .trash_rejected_execute(project, &approve_rejected(&offered), bin.trash())
        .await
        .unwrap();
    assert_eq!(summary.moved.len(), 2, "{summary:#?}");
    let operation = summary.operation_id.expect("the move is journaled");

    let catalog = world.catalog();
    for frame in [&ha_1, &ha_2] {
        let trashed = record(&world, frame.id).await;
        assert_eq!(trashed.availability, Availability::Trashed);
        assert_eq!(trashed.quality, Quality::Unusable, "the record keeps its quality");
        let episodes = catalog.trash_episodes(frame.id).await.unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].storage_operation_id, operation);
        assert_eq!(episodes[0].complete_view_ids, vec![world.run]);
        let kept = bin.kept(&file_of(&world.captures, frame)).expect("nothing is deleted");
        assert_eq!(episodes[0].sha256, support::digest(&kept));
    }
    let listed: BTreeSet<Uuid> = catalog
        .trashed_assets(&TrashedQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|trashed| trashed.asset.id)
        .collect();
    assert_eq!(listed, BTreeSet::from([ha_1.id, ha_2.id]));
    let candidates: BTreeSet<Uuid> = catalog
        .project_candidates(project)
        .await
        .unwrap()
        .into_iter()
        .flat_map(|candidate| candidate.asset_ids)
        .collect();
    assert!(!candidates.contains(&ha_1.id) && !candidates.contains(&ha_2.id), "{candidates:?}");
    let after = sheet(&world, project).await.rejected_frames;
    assert_eq!(after.n, 0, "{after:#?}");
    let again = world
        .library
        .trash_rejected_execute(project, &approve_rejected(&offered), bin.trash())
        .await
        .unwrap();
    assert!(
        again.moved.is_empty() && again.refused.len() == 2,
        "a stale approval moves nothing: {again:#?}"
    );
}

/// STO-AC-23, STO-FR-16, D-W74: each extra copy moves on its own after its
/// rehash and its kept copy's re-verification both match. A copy changed in
/// place and a copy whose kept copy became unreadable are refused and stay.
/// The moved copy's frame keeps its record, quality and memberships and lists
/// one copy fewer.
#[tokio::test]
async fn duplicate_copy_moves_alone_kept_copy_reverified() {
    let world = world().await;
    let (location, extras) =
        copies_in(&world, "Astro-T7/Captures B", &[HA_LIGHTS[0], HA_LIGHTS[1], OIII_LIGHTS[0]])
            .await;
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    assert_eq!(offered.duplicates.n, 3, "{:#?}", offered.duplicates);
    let members_before = json(&world.catalog().view_revision(world.run, 1).await.unwrap());
    let drifted = file_of(&location, &extras[0]);
    overwrite_in_place(&drifted);
    let unreadable = world.light(HA_LIGHTS[1]);
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
    let bin = Bin::new(&world);

    let summary = world
        .library
        .trash_duplicates_execute(project, &approve_duplicates(&offered), bin.trash())
        .await;
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o644)).unwrap();
    let summary = summary.unwrap();
    assert_eq!(summary.offer, TrashOffer::DuplicateCopies);
    assert_eq!(
        summary.moved.iter().map(|moved| moved.id).collect::<Vec<_>>(),
        vec![extras[2].id],
        "{summary:#?}"
    );
    let reasons = |id: Uuid| {
        let refused = summary.refused.iter().find(|refused| refused.id == id).expect("refused");
        custody_codes(refused)
    };
    assert_eq!(reasons(extras[0].id), vec![ReasonCode::SourceDrift]);
    assert_eq!(reasons(extras[1].id), vec![ReasonCode::KeptCopyUnproven]);
    assert!(drifted.exists() && file_of(&location, &extras[1]).exists());
    let moved = file_of(&location, &extras[2]);
    assert!(!moved.exists() && bin.kept(&moved).is_some(), "the copy went to the OS Trash");

    let kept = light(&world, OIII_LIGHTS[0]).await;
    assert_eq!(kept.availability, Availability::Available);
    assert_eq!(record(&world, extras[2].id).await.availability, Availability::Trashed);
    assert_eq!(json(&world.catalog().view_revision(world.run, 1).await.unwrap()), members_before);
    let after = sheet(&world, project).await.duplicates;
    assert!(after.frames.iter().all(|frame| frame.kept.asset_id != kept.id), "{after:#?}");
    let candidates = world.catalog().project_candidates(project).await.unwrap();
    assert!(candidates.iter().flat_map(|candidate| &candidate.asset_ids).any(|id| *id == kept.id));
    assert!(!candidates
        .iter()
        .flat_map(|candidate| &candidate.asset_ids)
        .any(|id| *id == extras[2].id));
}

/// STO-AC-22, PRJ-AC-27, STO-FR-13, D-W69: reopening the Project after
/// Archive moves no file; its archived sessions show Archived at their
/// archive paths until a reviewed restore transfers them back.
#[tokio::test]
async fn reopen_shows_archived_until_restored() {
    let world = world().await;
    let ha = session_of(&world, HA_LIGHTS[0]).await;
    let oiii = session_of(&world, OIII_LIGHTS[0]).await;
    let [_, _, oiii_1, _] = lights(&world).await;
    let project = done(&world).await;
    let archive = archive_location(&world).await;
    let bin = Bin::new(&world);
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    world.library.archive_execute(review.id, bin.trash()).await.unwrap();
    let before = (
        tree(&world.captures.path.to_path_buf().unwrap()),
        tree(&archive.path.to_path_buf().unwrap()),
    );

    let catalog = world.catalog();
    let revision = catalog.project(project).await.unwrap().revision;
    catalog.reopen_project(project, revision).await.unwrap();
    let after = (
        tree(&world.captures.path.to_path_buf().unwrap()),
        tree(&archive.path.to_path_buf().unwrap()),
    );
    assert_eq!(after, before, "Reopen moves no file");
    let states = world.library.session_archive_state(&[ha, oiii]).await.unwrap();
    for state in &states {
        assert_eq!(state.status, SessionArchiveStatus::Archived, "{state:#?}");
        assert_eq!(state.archived.len(), 2);
        for frame in &state.archived {
            assert_eq!(frame.location_id, archive.id);
            assert_eq!(frame.transfer_id, review.id);
            assert_eq!(frame.project.id, project);
            assert!(file_in(&archive, &frame.path.display()).exists());
        }
    }

    let restore = world.library.archive_restore_review(&[oiii]).await.unwrap();
    assert_eq!(restore.kind, ArchiveKind::Restore);
    assert_eq!(item(&restore, &oiii_1).destination_location_id, world.captures.id);
    assert_eq!(
        item(&restore, &oiii_1).destination_path,
        NativePath::from_path(Path::new(OIII_LIGHTS[0]))
    );
    let restored = world.library.archive_execute(restore.id, bin.trash()).await.unwrap();
    assert_eq!(restored.state, ArchiveState::Settled);
    assert!(
        restored.items.iter().all(|item| item.outcome == Some(ArchiveOutcome::Archived)),
        "{restored:#?}"
    );
    for path in OIII_LIGHTS {
        assert!(world.light(path).exists(), "{path} is back at its path");
    }
    let record = record(&world, oiii_1.id).await;
    assert_eq!(
        (record.location_id, record.relative_path.display()),
        (world.captures.id, OIII_LIGHTS[0].to_owned())
    );
    let states = world.library.session_archive_state(&[ha, oiii]).await.unwrap();
    let shown =
        |session: Uuid| states.iter().find(|state| state.session_id == session).unwrap().status;
    assert_eq!(shown(oiii), SessionArchiveStatus::NotArchived);
    assert_eq!(shown(ha), SessionArchiveStatus::Archived);
}

/// STO-FR-14, STO-FR-16: each offer is its own approval. Moving the rejected
/// frames trashes no duplicate copy and archives nothing, and an approval
/// naming another offer's item is refused as stale. While an archive
/// transfer is running, every trash move is refused and nothing moves.
#[tokio::test]
async fn separate_approvals_and_running_transfer_refuses_trash() {
    let world = world().await;
    let (location, extras) = copies_in(&world, "Astro-T7/Captures B", &[OIII_LIGHTS[1]]).await;
    let ha_1 = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &ha_1, Quality::Unusable).await;
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    assert_eq!((offered.rejected_frames.n, offered.duplicates.n), (1, 1));
    let bin = Bin::new(&world);

    let mut approval = approve_rejected(&offered);
    approval.frames.push(ApprovedFrame { frame_key: extras[0].id, copies: vec![extras[0].id] });
    let summary =
        world.library.trash_rejected_execute(project, &approval, bin.trash()).await.unwrap();
    assert_eq!(summary.moved.iter().map(|moved| moved.id).collect::<Vec<_>>(), vec![ha_1.id]);
    assert_eq!(summary.refused.len(), 1, "{summary:#?}");
    assert_eq!(summary.refused[0].id, extras[0].id);
    assert!(matches!(summary.refused[0].reasons[..], [MoveRefusal::Stale { .. }]));
    let duplicate = file_of(&location, &extras[0]);
    assert!(duplicate.exists(), "the duplicates offer needs its own approval");
    assert_eq!(record(&world, extras[0].id).await.availability, Availability::Available);
    let sessions = [session_of(&world, OIII_LIGHTS[0]).await];
    let states = world.library.session_archive_state(&sessions).await.unwrap();
    assert_eq!(states[0].status, SessionArchiveStatus::NotArchived, "nothing was archived");

    let archive = archive_location(&world).await;
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    let (reached, release) = bin.hold_next();
    let running = {
        let library = Arc::clone(&world.library);
        let trash = bin.trash();
        tokio::spawn(async move { library.archive_execute(review.id, trash).await })
    };
    tokio::time::timeout(Duration::from_secs(20), reached.notified())
        .await
        .expect("retirement starts");
    let refused = world
        .library
        .trash_duplicates_execute(project, &approve_duplicates(&offered), bin.trash())
        .await
        .unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused}");
    assert!(refused.to_string().contains("running"), "{refused}");
    let refused = world
        .library
        .trash_intermediates_execute(project, &approve_intermediates(&offered), bin.trash())
        .await
        .unwrap_err();
    assert!(refused.to_string().contains("running"), "{refused}");
    assert!(duplicate.exists(), "nothing moves while the transfer runs");
    drop(release);
    let transfer = running.await.unwrap().unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled, "{transfer:#?}");
    assert!(duplicate.exists(), "Archive moves no duplicate copy");
}

async fn running_work(world: &World) -> Vec<RunningWork> {
    let home = world.library.home_dashboard(false, &home_support::tonight()).await.unwrap();
    home.running_work
}

/// PRJ-FR-17 section 6, STO-FR-11: a running Done / Archive trash move and a
/// running Archive are each listed once on Home, never again as their bare
/// storage operation, and Storage names the Archive its verified transfer
/// carries.
#[tokio::test]
async fn home_and_storage_name_trash_moves_and_archive_transfers() {
    let world = world().await;
    let ha_1 = light(&world, HA_LIGHTS[0]).await;
    set_quality(&world, &ha_1, Quality::Unusable).await;
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    let bin = Bin::new(&world);

    let (reached, release) = bin.hold_next();
    let moving = {
        let (library, trash, approval) =
            (Arc::clone(&world.library), bin.trash(), approve_rejected(&offered));
        tokio::spawn(async move { library.trash_rejected_execute(project, &approval, trash).await })
    };
    tokio::time::timeout(Duration::from_secs(20), reached.notified())
        .await
        .expect("the move starts");
    let work = running_work(&world).await;
    let [RunningWork::TrashMove { offer, project_id, items, .. }] = work.as_slice() else {
        panic!("one trash move and no bare storage operation: {work:#?}");
    };
    assert_eq!((*offer, *project_id, *items), (TrashOffer::RejectedFrames, project, 1));
    drop(release);
    assert_eq!(moving.await.unwrap().unwrap().moved.len(), 1);
    assert!(running_work(&world).await.is_empty());

    let archive = archive_location(&world).await;
    let review = world.library.archive_review(project, archive.id).await.unwrap();
    let (reached, release) = bin.hold_next();
    let running = {
        let (library, trash) = (Arc::clone(&world.library), bin.trash());
        tokio::spawn(async move { library.archive_execute(review.id, trash).await })
    };
    tokio::time::timeout(Duration::from_secs(20), reached.notified())
        .await
        .expect("retirement starts");
    let work = running_work(&world).await;
    let [RunningWork::Archive { transfer_id, action, project_id, operation_id, .. }] =
        work.as_slice()
    else {
        panic!("one Archive and no bare storage operation: {work:#?}");
    };
    assert_eq!((*transfer_id, *action, *project_id), (review.id, ArchiveKind::Archive, project));
    assert!(operation_id.is_some(), "{work:#?}");
    drop(release);
    let transfer = running.await.unwrap().unwrap();
    assert_eq!(transfer.state, ArchiveState::Settled, "{transfer:#?}");
    assert!(running_work(&world).await.is_empty());

    let overview = world.library.storage_overview().await.unwrap();
    let operation = transfer.storage_operation_id.expect("the transfer was journaled");
    let shown = overview.transfers.iter().find(|view| view.operation_id == operation).unwrap();
    let expected = TransferArchive {
        transfer_id: review.id,
        kind: ArchiveKind::Archive,
        project: transfer.project,
    };
    assert_eq!(shown.archive.as_ref(), Some(&expected), "{shown:#?}");
}

/// STO-FR-17 after STO-FR-15: once a Done / Archive trash move took one of a
/// run's intermediates, Empty Trash of that run, after its Project is
/// reopened and the run trashed, still removes the run record, and the move
/// keeps naming what it moved.
#[tokio::test]
async fn empty_trash_removes_a_run_whose_intermediate_was_trashed() {
    let world = world().await;
    prepared(&world).await;
    stack(&results_dir(&world).join("process/pp_light_00001.fit"), &[("OBJECT", "'NGC 7000'")]);
    world.library.rescan_results(ResultOwner::Run { view_id: world.run }).await.unwrap();
    let project = done(&world).await;
    let offered = sheet(&world, project).await;
    assert_eq!(offered.intermediates.n, 1, "{:#?}", offered.intermediates);
    let bin = Bin::new(&world);
    let summary = world
        .library
        .trash_intermediates_execute(project, &approve_intermediates(&offered), bin.trash())
        .await
        .unwrap();
    assert_eq!(summary.moved.len(), 1, "{summary:#?}");
    let operation = summary.operation_id.expect("the move is journaled");

    let catalog = world.catalog();
    let revision = catalog.project(project).await.unwrap().revision;
    catalog.reopen_project(project, revision).await.unwrap();
    world.library.move_view_to_trash(world.run).await.unwrap();
    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: false };
    let review = world.library.review_cleanup(&request, bin.trash()).await.unwrap();
    let emptied = world.library.empty_trash(review.id.unwrap(), bin.trash()).await.unwrap();
    assert!(emptied.run_removed, "{emptied:#?}");
    let gone = catalog.view(world.run).await.unwrap_err();
    assert!(matches!(gone, LibraryError::NotFound(_)), "{gone}");
    assert_eq!(catalog.trash_move(operation).await.unwrap().items.len(), 1);
}
