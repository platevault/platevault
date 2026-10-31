// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Wrap up and Close (spec 065 PRJ-FR-14/15/25/30, PRJ-AC-15/21/27/31/
//! 34/43, 071 STO-FR-01/04/06/13/14; D-W43, D-W80, D-W97, D-W111, D-W112;
//! astro-plan-i1an5) on the Apply world: real files, a real catalog and a
//! stand-in OS Trash. Clean up and Trash retire only what the user reviewed
//! and ticked and never `Output/`; Close locks the Project with the
//! calibration its View used; Archive repoints the kept View and a stop while
//! Closing resumes to Archived; Duplicate takes the sessions' current pins.

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;

use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

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

/// Pause an active archive at its next durable-step boundary so status can be read concurrently.
struct GatedArchive {
    entered: mpsc::Sender<()>,
    resume: Mutex<mpsc::Receiver<()>>,
    pause: AtomicBool,
}

impl ArchiveControl for GatedArchive {
    fn interrupted(&self) -> bool {
        if self.pause.swap(false, Ordering::SeqCst) {
            self.entered.send(()).unwrap();
            self.resume.lock().unwrap().recv().unwrap();
        }
        false
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
/// Clean up removes every View copy without changing originals or work output.
#[tokio::test]
async fn clean_up_removes_every_view_copy_without_changing_originals_output_or_processing() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let output = write(&world, "Output/NGC7000_final.xisf");
    let processing = write(&world, "Processing/WBPP/master/masterLight_Ha.xisf");
    let output_before = fs::read(&output).unwrap();
    let processing_before = fs::read(&processing).unwrap();
    let originals_before = [HA[0], OIII[0]].map(|path| fs::read(world.light(path)).unwrap());
    let trash = bin(&world);

    let review = world.library.clean_up_review(world.project).await.unwrap();
    assert!(!review.entries.is_empty(), "the View has copies to remove");
    assert!(review.entries.iter().all(|entry| entry.preselected), "every Copy is ticked");
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: review.entries.iter().map(|entry| entry.path.clone()).collect(),
    };
    let report = world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();

    assert_eq!(report.results.len(), review.entries.len(), "every View copy was handled");
    assert!(report.results.iter().all(|result| result.outcome == CleanUpOutcome::Trashed));
    assert!(report.view_removed, "the emptied View is removed");
    assert!(!world.view().exists());
    assert_eq!(fs::read(&output).unwrap(), output_before, "Output stays byte-identical");
    assert_eq!(
        fs::read(&processing).unwrap(),
        processing_before,
        "Processing stays byte-identical"
    );
    assert_eq!(
        [HA[0], OIII[0]].map(|path| fs::read(world.light(path)).unwrap()),
        originals_before,
        "originals stay byte-identical",
    );
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
#[cfg(unix)] // The test retargets with std::os::unix::fs::symlink.
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

/// A Project whose `Processing/WBPP/master/` holds a generated flat master
/// the user adopted into the calibration library (`masters/masterFlat_Ha.fit`).
/// Returns the source in `Processing/` and its offer, read adopted.
/// Unix only, as are the tests that use it: master adoption refuses on any
/// other platform (`contained_write::require_supported`), since only Unix
/// syncs the folder after a no-replace install.
#[cfg(unix)]
async fn adopted_master() -> (World, std::path::PathBuf, ProcessingMasterOffer) {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let processing_root = world.folder().join("Processing");
    let source_relative = "WBPP/master/masterFlat_Ha.fit";
    let source = processing_root.join(source_relative);
    let mut metadata = apply_support::meta("FLAT", Some("Ha"), 2.0, 100.0, "2026-10-12");
    metadata.stack_count = Some(30);
    let bytes = apply_support::frame(
        source_relative,
        true,
        &["IMAGETYP= 'FLAT    '", "FILTER  = 'Ha      '", "STACKCNT=                   30"],
    );
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, &bytes).unwrap();
    let location = world
        .library
        .register_location(
            NativePath::from_path(&processing_root),
            "NGC 7000 Processing".into(),
            LocationRole::Results,
        )
        .await
        .unwrap();
    apply_support::scan_files(
        &world.library,
        &location,
        &processing_root,
        &[(source_relative.into(), metadata, bytes)],
    )
    .await;
    let asset = world
        .catalog()
        .location_assets(location.id)
        .await
        .unwrap()
        .into_iter()
        .find(|asset| asset.relative_path.display() == source_relative)
        .unwrap();
    let digest = apply_support::digest(&source);
    let offer = world
        .catalog()
        .offer_processing_master(
            world.project,
            &NativePath::from_path(Path::new("WBPP/master/masterFlat_Ha.fit")),
            &digest,
            &Classification {
                kind: InputKind::Flat,
                master: Some(MasterEvidence {
                    basis: MasterBasis::HeaderStackCount,
                    stack_count: Some(30),
                    detector: "test".into(),
                }),
            },
        )
        .await
        .unwrap()
        .unwrap();
    fs::create_dir_all(world.calibration.path.to_path_buf().unwrap().join("masters")).unwrap();
    let adoption = world
        .library
        .calibration_review_adoption(
            &AdoptionSource::Asset {
                asset_id: asset.id,
                expected: ExpectedAsset {
                    asset_id: asset.id,
                    decision_revision: asset.decision_revision,
                    fingerprint: asset.fingerprint.clone(),
                },
            },
            &AdoptionDestination {
                location_id: world.calibration.id,
                relative_path: NativePath::from_path(Path::new("masters/masterFlat_Ha.fit")),
            },
        )
        .await
        .unwrap();
    let adopted = world.library.calibration_adopt(adoption.id, adoption.revision).await.unwrap();
    assert_eq!(adopted.state, AdoptionState::Completed, "{adopted:#?}");
    assert_eq!(offer.sha256, digest);
    let offer = world.catalog().processing_master_offer(offer.id).await.unwrap();
    assert_eq!(offer.state, MasterOfferState::Adopted);
    (world, source, offer)
}

/// [`adopted_master`] at the Trash step.
#[cfg(unix)]
async fn adopted_master_at_trash() -> (World, std::path::PathBuf) {
    let (world, source, _) = Box::pin(adopted_master()).await;
    let cleanup = world.library.clean_up_review(world.project).await.unwrap();
    world
        .library
        .clean_up(
            &CleanUpRequest {
                project_id: world.project,
                desired_revision: cleanup.desired_revision,
                generation: cleanup.generation,
                selected: Vec::new(),
            },
            bin(&world).dyn_trash(),
        )
        .await
        .unwrap();
    (world, source)
}

/// CAL-FR-06: the Output step's Hide and Restore are for a generated offer
/// only; an adopted master's offer is neither hidden nor restored, and stays
/// adopted.
#[cfg(unix)]
#[tokio::test]
async fn an_adopted_master_offer_is_neither_hidden_nor_restored() {
    let (world, _, offer) = Box::pin(adopted_master()).await;

    let hidden = world.library.dismiss_processing_master(offer.id, &offer.sha256).await;
    assert_eq!(hidden.unwrap_err().code(), LibraryErrorCode::InvalidInput);
    let restored = world.library.restore_processing_master(offer.id, &offer.sha256).await;
    assert_eq!(restored.unwrap_err().code(), LibraryErrorCode::InvalidInput);
    let offer = world.catalog().processing_master_offer(offer.id).await.unwrap();
    assert_eq!(offer.state, MasterOfferState::Adopted);
}

/// The kept library copy of [`adopted_master_at_trash`].
#[cfg(unix)]
fn adopted_copy(world: &World) -> NativePath {
    NativePath::from_path(
        &world.calibration.path.to_path_buf().unwrap().join("masters/masterFlat_Ha.fit"),
    )
}

/// PRJ-AC-28, D-W70/D-W80/D-W97/D-W98: an adopted master's generated source
/// is listed as a verified duplicate of its retained Calibration copy.
#[tokio::test]
#[cfg(unix)] // Adopts a master, which only Unix supports.
async fn trash_offers_an_adopted_master_source_as_a_duplicate_and_never_output() {
    let (world, source) = Box::pin(adopted_master_at_trash()).await;
    let source_native = NativePath::from_path(&source);
    let output = write(&world, "Output/NGC7000_final.xisf");
    let registered = write(&world, "Processing/WBPP/registered/r_Ha_0001.xisf");
    let review = world.library.trash_review(world.project, bin(&world).dyn_trash()).await.unwrap();
    let processing_group =
        review.groups.iter().find(|group| group.group == TrashGroup::ProcessingFiles).unwrap();
    let duplicate =
        processing_group.items.iter().find(|item| item.files == [source_native.clone()]).unwrap();
    assert_eq!(
        duplicate.kept,
        Some(adopted_copy(&world)),
        "processing group: {processing_group:#?}"
    );
    assert!(!review
        .groups
        .iter()
        .find(|group| group.group == TrashGroup::DuplicateCopies)
        .unwrap()
        .items
        .iter()
        .any(|item| item.files.contains(&source_native)));
    assert!(review.protected_masters.is_empty(), "adopted sources are not protected");
    assert!(output.exists());
    assert!(processing_group
        .items
        .iter()
        .all(|item| !item.files.iter().any(|path| path.display().contains("Output"))));
    let intermediate = processing_group
        .items
        .iter()
        .find(|item| item.files == [NativePath::from_path(&registered)])
        .unwrap();
    assert_eq!(intermediate.kept, None, "an intermediate names no kept copy");
    assert_eq!(processing_group.items.len(), 2, "the source counts in N: {review:#?}");
    let trash = bin(&world);
    let report = world
        .library
        .wrap_up_trash(
            &TrashRequest {
                project_id: world.project,
                digest: review.digest,
                ticked: vec![TrashGroup::ProcessingFiles],
            },
            trash.dyn_trash(),
        )
        .await
        .unwrap();
    assert_eq!(
        report.moved.len(),
        processing_group.items.len(),
        "all Processing files move under one confirmation: {report:#?}",
    );
    assert!(report.moved.contains(&source_native));
    assert!(!source.exists());
    assert!(!registered.exists());
    assert_eq!(fs::read(&output).unwrap(), b"Output/NGC7000_final.xisf");
    assert!(adopted_copy(&world).to_path_buf().unwrap().exists(), "the adopted copy stays");
}

/// PRJ-AC-28's verified duplicate is checked against the source's bytes: a
/// source rewritten after its master was adopted no longer duplicates the
/// kept copy, so it is refused by name, never offered without one.
#[tokio::test]
#[cfg(unix)] // Adopts a master, which only Unix supports.
async fn trash_refuses_an_adopted_master_source_rewritten_since_adoption() {
    let (world, source) = Box::pin(adopted_master_at_trash()).await;
    fs::OpenOptions::new().append(true).open(&source).unwrap().write_all(b"rewritten").unwrap();
    let review = world.library.trash_review(world.project, bin(&world).dyn_trash()).await.unwrap();
    let processing_group =
        review.groups.iter().find(|group| group.group == TrashGroup::ProcessingFiles).unwrap();
    let source_native = NativePath::from_path(&source);
    assert!(processing_group.items.iter().all(|item| !item.files.contains(&source_native)));
    assert!(
        processing_group.refused.iter().any(|refusal| refusal.path == source_native
            && refusal.reason.code == ReasonCode::SourceDrift),
        "{processing_group:#?}"
    );
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
    let query = ProjectQuery { include_closed: true, ..ProjectQuery::default() };
    let id = world.project;
    let row = move |rows: Vec<ProjectRow>| rows.into_iter().find(|row| row.project.id == id);
    let closing = row(world.library.project_rows(&query).await.unwrap()).unwrap();
    assert_eq!(closing.project.lifecycle, ProjectLifecycle::Closing);
    assert_eq!(closing.work, None);
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(
        status.blocker,
        Some(WrapUpBlocker::NotOpen { lifecycle: ProjectLifecycle::Closing })
    );

    world.reopen().await;
    let stopped = world.library.project_close_status(world.project).await.unwrap().unwrap();
    assert_eq!(stopped, ProjectCloseStatus::Stopped { progress: report.archive.clone().unwrap() });
    let settled = world.library.recover_wrap_up(trash.dyn_trash()).await.unwrap();
    assert_eq!(settled.len(), 1);
    let progress = &settled[0];
    assert!(progress.settled, "{progress:#?}");
    assert!(progress.moves.iter().all(|step| step.outcome == Some(ArchiveMoveOutcome::Archived)));
    assert_eq!(progress.repointed_links.len(), 4);
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Archived);
    let archived = row(world.library.project_rows(&query).await.unwrap()).unwrap();
    assert_eq!(archived.project.lifecycle, ProjectLifecycle::Archived);
    assert_eq!(archived.work, None);
    let steps: Vec<_> = status.records.iter().map(|record| (record.step, record.outcome)).collect();
    assert_eq!(steps[2], (WrapUpStep::Archive, WrapUpOutcome::Finished));

    for link in &review.links {
        let path = link.link.to_path_buf().unwrap();
        assert!(reads_below(&path, &archive_root), "{} reads outside the archive", path.display());
        assert!(fs::read_link(&path).unwrap().exists());
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

/// STO-IMP-FR-07, D-W107, D-W129: `{target}` is the session's confirmed
/// Target. A different OBJECT stays an informational label.
#[tokio::test]
async fn archive_target_folder_uses_confirmed_target_not_object() {
    let world = world(ViewMode::Copies).await;
    world.correct(HA[0], &[("object", serde_json::json!("M31"))]).await;
    let (archive, _) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;

    let session = world.session_of(&world.captures, HA[0]).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let offer = review.sessions.iter().find(|offer| offer.session_id == session.id).unwrap();
    let file = offer
        .files
        .iter()
        .find(|file| file.from.to_path_buf().unwrap() == world.light(HA[0]))
        .unwrap();
    assert!(
        file.to
            .to_path_buf()
            .unwrap()
            .ends_with(Path::new("NGC 7000").join("Ha/2026-10-12/light/Light_001.fits")),
        "the confirmed Target, not the M31 OBJECT label, names the archive folder: {}",
        file.to.display()
    );
}

/// D-W129: a session without a confirmed Target archives under Unclassified,
/// even when its OBJECT label names a Target.
#[tokio::test]
async fn archive_unclassified_target_uses_unclassified_folder_not_object() {
    let world = world(ViewMode::Copies).await;
    world.correct(OIII[0], &[("object", serde_json::json!("M31"))]).await;
    let session = world.session_of(&world.captures, OIII[0]).await;
    world
        .sql(
            "UPDATE associations SET state = 'unresolved', evidence = '[]' \
             WHERE session_id = ?1 AND kind = 'target'",
            &[&session.id.to_string()],
        )
        .await;
    let (archive, _) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;

    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let offer = review.sessions.iter().find(|offer| offer.session_id == session.id).unwrap();
    let file = offer
        .files
        .iter()
        .find(|file| file.from.to_path_buf().unwrap() == world.light(OIII[0]))
        .unwrap();
    assert!(
        file.to
            .to_path_buf()
            .unwrap()
            .ends_with(Path::new("unclassified").join("OIII/2026-10-13/light/Light_001.fits")),
        "an Unclassified session uses the import fallback, not its M31 OBJECT label: {}",
        file.to.display()
    );
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

/// Put a new, empty folder at `root`'s path, the old one moved beside it:
/// what a remount or a replaced folder leaves at a registered path.
fn replace_folder(root: &Path) {
    fs::rename(root, root.with_file_name("Archive-T7 (old)")).unwrap();
    fs::create_dir(root).unwrap();
}

/// Close with Archive of every reviewed session to `archive`.
async fn close_all(world: &World, archive: &Location, review: &ArchiveReview) -> CloseRequest {
    CloseRequest {
        project_id: world.project,
        desired_revision: revision(world).await,
        archive: Some(ArchiveSelection {
            destination: archive.id,
            sessions: review.sessions.iter().map(|offer| offer.session_id).collect(),
            digest: review.digest.clone(),
        }),
    }
}

/// Whether the catalog still records `asset` at the captures location.
async fn catalogued_at_source(world: &World, asset: Uuid) -> bool {
    let assets = world.catalog().location_assets(world.captures.id).await.unwrap();
    assets.iter().any(|record| record.id == asset)
}

/// Every kept-View link of the review still reads a captures original.
fn links_read_originals(world: &World, review: &ArchiveReview) {
    let captures = world.captures.path.to_path_buf().unwrap();
    for link in &review.links {
        let path = link.link.to_path_buf().unwrap();
        assert!(reads_below(&path, &captures), "{} reads outside captures", path.display());
    }
}

/// A Close/archive's read state is durable and includes its per-file report.
#[tokio::test]
async fn close_status_reads_durable_archive_progress_before_and_after_restart() {
    let mut world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let (archive, _) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let request = close_all(&world, &archive, &review).await;

    let (entered, wait_for_release) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let gated = Arc::new(GatedArchive {
        entered,
        resume: Mutex::new(resume),
        pause: AtomicBool::new(true),
    });
    let library = Arc::clone(&world.library);
    let worker_trash = trash.clone();
    let worker_control = gated.clone();
    drop(gated);
    let close = thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(
            library.close_project(&request, worker_trash.dyn_trash(), worker_control.as_ref()),
        )
    });
    wait_for_release.recv().expect("archive reached its first durable step");

    let running = world.library.project_close_status(world.project).await.unwrap().unwrap();
    let ProjectCloseStatus::Running { progress } = running else { panic!("{running:#?}") };
    assert!(!progress.settled);
    assert_eq!(progress.moves.len(), 4);
    assert!(progress.moves.iter().all(|step| step.outcome.is_none()));

    release.send(()).unwrap();
    let report = close.join().unwrap().unwrap();
    assert_eq!(report.lifecycle, ProjectLifecycle::Archived);
    let settled = world.library.project_close_status(world.project).await.unwrap().unwrap();
    let ProjectCloseStatus::Settled { report } = settled else { panic!("{settled:#?}") };
    assert!(report.settled);
    assert_eq!(report.moves.len(), 4);
    assert!(report.moves.iter().all(|step| step.outcome == Some(ArchiveMoveOutcome::Archived)));

    // Reopening the Library must recover this report from the catalog/journal,
    // rather than the process-local archive run registry.
    world.reopen().await;
    let reopened = world.library.project_close_status(world.project).await.unwrap().unwrap();
    assert_eq!(reopened, ProjectCloseStatus::Settled { report });
}

/// Whether the link at `path` reads an entry below `root`, compared in the
/// form that names one entry exactly: Windows reports a target in its plain
/// spelling though the roots are canonical `\\?\` paths there.
fn reads_below(path: &Path, root: &Path) -> bool {
    let target = fs::read_link(path).unwrap();
    fs_pathsafe::long_path(&target).starts_with(fs_pathsafe::long_path(root))
}

/// STO-FR-06/07 (C5): a folder replaced at the destination's path is not
/// the registered location. Close refuses the reviewed archive before
/// anything is written, and a fresh review holds every session on it.
#[tokio::test]
async fn archive_refuses_a_destination_folder_replaced_at_its_path() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let (archive, archive_root) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    assert!(review.sessions.iter().all(|offer| offer.hold.is_none()), "{review:#?}");
    replace_folder(&archive_root);

    let request = close_all(&world, &archive, &review).await;
    let refused =
        world.library.close_project(&request, trash.dyn_trash(), &Unattended).await.unwrap_err();
    assert!(matches!(refused, LibraryError::Conflict { .. }), "{refused}");
    assert_eq!(World::tree(&archive_root), Vec::<String>::new(), "nothing is written");
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Open);
    assert!(world.light(HA[0]).exists() && world.light(OIII[0]).exists(), "nothing moved");
    links_read_originals(&world, &review);

    let again = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    assert!(
        again.sessions.iter().all(|offer| offer
            .hold
            .as_ref()
            .is_some_and(|hold| hold.code == ReasonCode::DestinationChanged)),
        "{again:#?}"
    );
}

/// STO-FR-06/07 (C5): the destination root is checked again before each
/// write. A folder replaced while Close was stopped receives nothing: every
/// file is Blocked with its source catalogued and its links unchanged, and
/// the Project closes without an archive.
#[tokio::test]
async fn a_resumed_archive_writes_nothing_into_a_replaced_destination_folder() {
    let mut world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let (archive, archive_root) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let request = close_all(&world, &archive, &review).await;
    let stop = StopAfter(AtomicUsize::new(1));
    let report = world.library.close_project(&request, trash.dyn_trash(), &stop).await.unwrap();
    assert_eq!(report.lifecycle, ProjectLifecycle::Closing, "{report:#?}");
    assert_eq!(World::tree(&archive_root), Vec::<String>::new(), "stopped before any write");
    replace_folder(&archive_root);

    world.reopen().await;
    let settled = world.library.recover_wrap_up(trash.dyn_trash()).await.unwrap();
    let [progress] = settled.as_slice() else { panic!("{settled:#?}") };
    assert!(progress.settled, "{progress:#?}");
    for step in &progress.moves {
        assert_eq!(step.outcome, Some(ArchiveMoveOutcome::Blocked), "{step:#?}");
        assert_eq!(
            step.reason.as_ref().map(|reason| reason.code),
            Some(ReasonCode::DestinationChanged)
        );
        assert!(!step.repointed);
        assert!(catalogued_at_source(&world, step.file.asset_id).await, "{step:#?}");
    }
    assert_eq!(World::tree(&archive_root), Vec::<String>::new(), "nothing is written");
    let status = world.library.wrap_up_status(world.project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Closed);
    assert!(world.light(HA[0]).exists() && world.light(OIII[0]).exists(), "originals stay");
    assert_eq!(trash.moved(), Vec::<std::path::PathBuf>::new());
    links_read_originals(&world, &review);
}

/// STO-FR-06/07 (C6): the archive copy is hashed again through a handle
/// proven to be it before its record or any kept-View link moves. A copy
/// changed in place after its verification is refused: the original stays
/// catalogued and at its path, and every link still reads it.
#[tokio::test]
async fn a_copy_changed_after_its_verification_moves_no_record_or_link() {
    let mut world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let (archive, _) = archive_location(&world).await;
    let trash = bin(&world);
    skip_to_archive(&world, &trash).await;
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let request = close_all(&world, &archive, &review).await;
    // Stops with the first file installed, before its verification.
    let installed = StopAfter(AtomicUsize::new(3));
    let report =
        world.library.close_project(&request, trash.dyn_trash(), &installed).await.unwrap();
    let progress = report.archive.unwrap();
    let first = progress.moves[0].clone();
    let operation = world
        .library
        .step_storage_operation(progress.storage_operation_id, trash.dyn_trash())
        .await
        .unwrap();
    let item = operation.items.iter().find(|item| item.seq == first.seq).unwrap();
    assert_eq!(item.phase, ItemPhase::DestinationVerified, "{item:#?}");
    // The verified copy is rewritten in place: same file, same size.
    let copy = first.file.to.to_path_buf().unwrap();
    let mut bytes = fs::read(&copy).unwrap();
    bytes[0] ^= 0xFF;
    fs::OpenOptions::new().write(true).open(&copy).unwrap().write_all(&bytes).unwrap();

    world.reopen().await;
    let settled = world.library.recover_wrap_up(trash.dyn_trash()).await.unwrap();
    let [progress] = settled.as_slice() else { panic!("{settled:#?}") };
    let step = progress.moves.iter().find(|step| step.seq == first.seq).unwrap();
    assert_eq!(step.outcome, Some(ArchiveMoveOutcome::Blocked), "{step:#?}");
    assert_eq!(
        step.reason.as_ref().map(|reason| reason.code),
        Some(ReasonCode::DestinationMismatch)
    );
    assert!(!step.repointed, "the record never moved to the changed copy");
    assert!(catalogued_at_source(&world, step.file.asset_id).await, "{step:#?}");
    assert!(first.file.from.to_path_buf().unwrap().exists(), "the original stays");
    let captures = world.captures.path.to_path_buf().unwrap();
    for link in review.links.iter().filter(|link| link.asset_id == step.file.asset_id) {
        let path = link.link.to_path_buf().unwrap();
        assert!(reads_below(&path, &captures), "{} was repointed", link.link.display());
    }
    assert!(
        !progress.repointed_links.iter().any(|link| link.asset_id == step.file.asset_id),
        "{progress:#?}"
    );
}
