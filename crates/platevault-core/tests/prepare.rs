// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! PREP single run (spec 069 PREP-FR-01..11/14, PREP-AC-01..15/19/20/21,
//! PV-PREP-SC-03) on the composed library over real files: the run and
//! Results folder layout, revisions beside the first, never-reused folders,
//! override parents, D04 mode refusals, Partial outcomes, D19 snapshots and
//! terminal re-verification (automatic calibration included), Open's
//! re-verification and the run lifecycle ports PREP registers.
#![cfg(unix)]

#[path = "support/prepare.rs"]
mod prepare_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use platevault_core::layout;
use platevault_core::*;
use prepare_support::{
    appears, digest, overwrite_in_place, restore_in_place, tree, world, Watch, HA_LIGHTS,
    OIII_LIGHTS, PROJECT, RUN,
};

const QUIET: &str = "exit 0";
const MARK: &str = "echo launched >> \"$1/launched.txt\"";

fn path(native: &NativePath) -> PathBuf {
    native.to_path_buf().unwrap()
}

fn refused(error: &LibraryError, needle: &str) {
    assert!(matches!(error, LibraryError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains(needle), "{error} should name {needle}");
}

/// PREP-AC-01, PREP-FR-06/07: `<output>/<Project>/<Run>/` with its sibling
/// `<Run> Results/`, outside the prepared folder.
#[tokio::test]
async fn layout_run_folder_and_sibling_results() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let folder = world.output.join(PROJECT).join(RUN);
    let results = world.output.join(PROJECT).join(format!("{RUN} Results"));
    let location = review.location.clone().unwrap();
    assert_eq!(path(&location.folder), folder);
    assert_eq!(path(&location.results), results);
    assert_eq!(review.location_check, LocationCheck::Ready);
    assert!(review.refusals.is_empty(), "{:?}", review.refusals);
    assert_eq!(review.entries.len(), 10, "four lights and six calibration frames");
    assert_eq!(review.link, Some(LinkKind::Symlink));
    assert_eq!(review.suggested_mode, InputMode::LinkedView);
    assert_eq!(review.footprint_bytes, 0);
    assert!(review.free_bytes.is_some());
    let third = layout::run_location(&world.output, PROJECT, RUN, 3, None, None).unwrap();
    assert_eq!(path(&third.folder), world.output.join(PROJECT).join(format!("{RUN} (rev 3)")));
    assert_eq!(path(&third.results), results, "every revision shares one Results folder");

    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert_eq!(path(&outcome.revision.folder), folder);
    assert!(results.is_dir() && !results.starts_with(&folder));
    assert_eq!(results.parent(), folder.parent());
    let light = folder.join("Lights").join("Ha_001.fits");
    assert_eq!(fs::read_link(&light).unwrap(), world.light(HA_LIGHTS[0]));
    assert!(outcome.offers.contains(&PreparationOffer::Open));
}

/// PREP-AC-21, PREP-FR-11: a later revision goes to `<Run> (rev 2)/` beside
/// the first, which stays unchanged; both share one Results folder, and
/// Empty Trash names both prepared folders through `RunFolders`.
#[tokio::test]
async fn rev2_folder_beside_first_and_shared_results() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let first = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(first.revision.state, PreparationState::Prepared, "{first:#?}");
    let before = tree(&path(&first.revision.folder));
    world.drop_one_oiii_frame().await;
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert_eq!(review.preparation_number, 2);
    let second = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(second.revision.state, PreparationState::Prepared, "{second:#?}");
    let rev2 = world.output.join(PROJECT).join(format!("{RUN} (rev 2)"));
    assert_eq!(path(&second.revision.folder), rev2);
    assert_eq!(rev2.parent().unwrap(), path(&first.revision.folder).parent().unwrap());
    assert_eq!(second.revision.results_folder, first.revision.results_folder);
    assert_eq!(second.prepared.len(), 9, "three lights and six calibration frames");
    assert_eq!(tree(&path(&first.revision.folder)), before, "the first revision is untouched");

    let project = world.view().await.project_id;
    world.library.move_view_to_trash(world.run).await.unwrap();
    let review = world.library.empty_trash_review(project, &[]).await.unwrap();
    let run = &review.runs[0];
    let folders: Vec<(Revision, PathBuf)> =
        run.prepared_folders.iter().map(|f| (f.preparation_revision, path(&f.path))).collect();
    assert_eq!(folders, vec![(1, path(&first.revision.folder)), (2, rev2)]);
    assert_eq!(run.results_folders, vec![first.revision.results_folder.clone()]);
}

/// PREP-AC-02, PREP-FR-06: an existing folder is never reused; another
/// name prepares beside it and the existing folder is unchanged.
#[tokio::test]
async fn existing_folder_never_reused() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let existing = world.output.join(PROJECT).join(RUN);
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("notes.txt"), "unrelated").unwrap();
    let before = tree(&existing);
    let mut request = world.request(&profile, InputMode::LinkedView, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert!(matches!(review.location_check, LocationCheck::FolderExists { .. }), "{review:#?}");
    let revision = world.membership_revision().await;
    let error = world
        .library
        .prepare_run(world.run, &request, revision, &Watch::quiet())
        .await
        .unwrap_err();
    refused(&error, "never reused");
    assert!(world.catalog().view_preparations(world.run).await.unwrap().is_empty());
    assert_eq!(tree(&existing), before);

    request.folder_name = Some(format!("{RUN} B"));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert_eq!(path(&outcome.revision.folder), world.output.join(PROJECT).join(format!("{RUN} B")));
    assert_eq!(tree(&existing), before, "the existing folder is unchanged");
}

/// PREP-FR-06, D-W67: an override parent inside a prepared folder (or the
/// Results folder) is refused; one outside keeps the `<Project>/` level.
#[tokio::test]
async fn override_parent_inside_prepared_folder_refused() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let first = world.prepare(&request, &Watch::quiet()).await;
    let inside = path(&first.revision.folder).join("Lights");
    for parent in [inside.clone(), path(&first.revision.results_folder)] {
        let mut request = request.clone();
        request.output = Some(NativePath::from_path(&parent));
        let review = world.library.review_preparation(world.run, &request).await.unwrap();
        assert!(
            matches!(review.location_check, LocationCheck::InsidePreparedFolder { .. }),
            "{:?}",
            review.location_check
        );
        let revision = world.membership_revision().await;
        let error = world
            .library
            .prepare_run(world.run, &request, revision, &Watch::quiet())
            .await
            .unwrap_err();
        refused(&error, "inside the prepared folder");
        assert!(!parent.join(PROJECT).exists());
    }
    let elsewhere = fs::canonicalize(world.temp.path()).unwrap().join("Elsewhere");
    fs::create_dir(&elsewhere).unwrap();
    let mut request = request.clone();
    request.output = Some(NativePath::from_path(&elsewhere));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(
        path(&outcome.revision.folder),
        elsewhere.join(PROJECT).join(format!("{RUN} (rev 2)"))
    );
}

/// PREP-AC-11, PREP-FR-04, D04: a write-prone profile refuses Linked View
/// and Direct source naming the input-write risk, offers isolated Copy, and
/// never changes the mode by itself.
#[tokio::test]
async fn write_prone_profile_refuses_linked_and_direct() {
    let world = world().await;
    let profile = world.write_prone().await;
    for mode in [InputMode::LinkedView, InputMode::DirectSource] {
        let request = world.request(&profile, mode, None);
        let review = world.library.review_preparation(world.run, &request).await.unwrap();
        assert_eq!(review.mode, mode, "the mode is never changed automatically");
        assert_eq!(review.suggested_mode, InputMode::Copy);
        assert!(review.refusals.iter().any(|r| r.contains("input-write risk")), "{review:#?}");
        let copy = review.modes.iter().find(|option| option.mode == InputMode::Copy).unwrap();
        assert!(copy.refusal.is_none());
        let revision = world.membership_revision().await;
        let error = world
            .library
            .prepare_run(world.run, &request, revision, &Watch::quiet())
            .await
            .unwrap_err();
        refused(&error, "input-write risk");
    }
    assert!(!world.output.join(PROJECT).exists(), "nothing was created");
    let request = world.request(&profile, InputMode::Copy, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert!(outcome.prepared.iter().all(|entry| entry.kind == PreparedEntryKind::Copy));
}

/// PREP-AC-05, PREP-FR-09: inputs unreadable during Prepare are blocked;
/// the outcome is Partial listing prepared and blocked items, offers no
/// Open, feeds the run blocker, and the sources are untouched.
#[tokio::test]
async fn partial_lists_prepared_and_blocked() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let unreadable: Vec<PathBuf> =
        review.entries.iter().rev().take(3).map(|entry| path(&entry.source)).collect();
    let digests: Vec<String> = world.sources().iter().map(|source| digest(source)).collect();
    let locked = unreadable.clone();
    let watch = Watch::on(move |_| {
        for source in &locked {
            fs::set_permissions(source, fs::Permissions::from_mode(0o000)).unwrap();
        }
    });
    let outcome = world.prepare(&request, &watch).await;
    for source in &unreadable {
        fs::set_permissions(source, fs::Permissions::from_mode(0o644)).unwrap();
    }
    assert_eq!(outcome.revision.state, PreparationState::Partial, "{outcome:#?}");
    assert_eq!((outcome.prepared.len(), outcome.blocked.len()), (7, 3));
    for entry in &outcome.blocked {
        assert!(unreadable.contains(&path(entry.source.as_ref().unwrap())));
        assert_eq!(entry.reason.as_ref().unwrap().code, ReasonCode::SourceUnavailable);
    }
    assert!(!outcome.offers.contains(&PreparationOffer::Open));
    assert!(outcome.offers.contains(&PreparationOffer::Retry));
    let blocker = world.library.preparation_blocker(world.run).await.unwrap().unwrap();
    assert_eq!((blocker.state, blocker.blocked), (PreparationState::Partial, 3));
    let error = world.library.open_preparation(outcome.revision.id).await.unwrap_err();
    refused(&error, "only a verified Prepared revision opens");
    let after: Vec<String> = world.sources().iter().map(|source| digest(source)).collect();
    assert_eq!(after, digests, "sources are untouched");
}

/// PREP-AC-14: a source changed after its snapshot (size and time kept)
/// blocks its copy with source drift; `PlateVault` never writes it. Retry
/// prepares it only once its bytes match a fresh snapshot again.
#[tokio::test]
async fn copy_drift_blocks_item() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let source = world.light(HA_LIGHTS[0]);
    let original = digest(&source);
    let modified = prepare_support::modified(&source);
    let target = NativePath::from_path(&source);
    let watch = Watch::on(move |entry| {
        if entry.source.as_ref() == Some(&target) && entry.state == EntryState::Prepared {
            overwrite_in_place(&target.to_path_buf().unwrap());
        }
    });
    let outcome = world.prepare(&request, &watch).await;
    assert_eq!(outcome.revision.state, PreparationState::Partial, "{outcome:#?}");
    assert_eq!(outcome.blocked.len(), 1);
    let blocked = &outcome.blocked[0];
    assert_eq!(blocked.source.as_ref(), Some(&NativePath::from_path(&source)));
    let reason = blocked.reason.as_ref().unwrap();
    assert_eq!(reason.code, ReasonCode::SourceDrift, "{reason:?}");
    assert!(reason.detail.contains(&source.display().to_string()), "{reason:?}");
    assert!(!outcome.offers.contains(&PreparationOffer::Open));
    assert_ne!(digest(&source), original, "PlateVault did not write the changed source");
    assert_eq!(prepare_support::modified(&source), modified);
    assert_eq!(digest(&path(&blocked.path)), original, "the copy holds the snapshot");

    let again =
        world.library.retry_preparation(outcome.revision.id, &Watch::quiet()).await.unwrap();
    assert_eq!(again.revision.state, PreparationState::Partial, "still drifted: {again:#?}");
    restore_in_place(&source);
    assert_eq!(digest(&source), original);
    let retried =
        world.library.retry_preparation(outcome.revision.id, &Watch::quiet()).await.unwrap();
    assert_eq!(retried.revision.state, PreparationState::Prepared, "{retried:#?}");
    assert!(retried.blocked.is_empty());
}

/// PREP-AC-15, PREP-FR-10: Open re-verifies every entry before launch; a
/// hardlinked input overwritten in place (size and time kept) refuses the
/// launch naming it, and once the bytes return Open re-verifies and launches.
#[tokio::test]
async fn open_reverifies_and_refuses_on_drift() {
    let world = world().await;
    let profile = world.siril(MARK).await;
    let request = world.request(&profile, InputMode::LinkedView, Some(LinkKind::Hardlink));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let entry = outcome.prepared.iter().find(|e| e.input == PreparedInput::Light).unwrap();
    assert_eq!(entry.kind, PreparedEntryKind::Hardlink);
    let linked = path(&entry.path);
    let marker = path(&outcome.revision.results_folder).join("launched.txt");
    overwrite_in_place(&linked);
    let refused = world.library.open_preparation(outcome.revision.id).await.unwrap();
    let OpenOutcome::Refused { drifted } = refused else {
        panic!("drift must refuse the launch: {refused:?}");
    };
    assert_eq!(
        drifted.iter().map(|e| e.path.clone()).collect::<Vec<_>>(),
        vec![entry.path.clone()]
    );
    assert!(!marker.exists(), "nothing was launched");
    let blocker = world.library.preparation_blocker(world.run).await.unwrap().unwrap();
    assert_eq!(blocker.drifted, 1);
    let unverified = world.library.preparation_outcome(outcome.revision.id).await.unwrap();
    assert!(!unverified.offers.contains(&PreparationOffer::Open));

    restore_in_place(&linked);
    let opened = world.library.open_preparation(outcome.revision.id).await.unwrap();
    assert!(matches!(opened, OpenOutcome::Launched { .. }), "{opened:?}");
    assert!(appears(&marker).await, "the application ran");
    assert!(world.library.preparation_blocker(world.run).await.unwrap().is_none());
}

/// CAL-FR-08, PREP-FR-09: an automatic calibration assignment is
/// re-verified like an accepted one: a dark whose bytes differ from the
/// assignment's digest is blocked; the lights still prepare.
#[tokio::test]
async fn automatic_calibration_reverified() {
    let world = world().await;
    let handoff = world.library.calibration_handoff(world.run, 1).await.unwrap();
    assert!(handoff.assignments.iter().all(|a| a.resolution == Resolution::Automatic));
    let dark = world.calibration_file("darks/Dark_300s_001.fits");
    let bound = handoff
        .assignments
        .iter()
        .flat_map(|a| &a.inputs)
        .find(|file| file.relative_path.display() == "darks/Dark_300s_001.fits")
        .unwrap();
    assert_eq!(bound.fingerprint.content_sha256.as_deref(), Some(digest(&dark).as_str()));
    overwrite_in_place(&dark);
    let profile = world.siril(QUIET).await;
    let outcome =
        world.prepare(&world.request(&profile, InputMode::Copy, None), &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Partial, "{outcome:#?}");
    assert_eq!(outcome.blocked.len(), 1);
    let blocked = &outcome.blocked[0];
    assert_eq!(blocked.input, PreparedInput::Dark);
    let reason = blocked.reason.as_ref().unwrap();
    assert_eq!(reason.code, ReasonCode::SourceDrift);
    assert!(reason.detail.contains("calibration assignment"), "{reason:?}");
    assert_eq!(
        outcome.prepared.iter().filter(|e| e.input == PreparedInput::Light).count(),
        4,
        "every light is prepared"
    );
}

/// PREP-FR-10, RES-FR-07: launching and the application closing never mark
/// the run Complete; a Running revision blocks Mark Complete through the
/// guard; closing `PlateVault` mid-run leaves it Paused, never Prepared.
#[tokio::test]
async fn closing_app_never_completes_run() {
    let mut world = world().await;
    let profile = world.siril(MARK).await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    let stage = world.view().await.stage;
    let opened = world.library.open_preparation(outcome.revision.id).await.unwrap();
    assert!(matches!(opened, OpenOutcome::Launched { .. }), "{opened:?}");
    let marker = path(&outcome.revision.results_folder).join("launched.txt");
    assert!(appears(&marker).await);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let view = world.view().await;
    assert_eq!((view.completion, view.stage), (RunCompletion::Open, stage));

    let running = world
        .catalog()
        .start_preparation(&persistence_library::NewPreparation {
            view_id: world.run,
            n: 2,
            membership_revision: 1,
            profile_id: profile.id,
            mode: InputMode::Copy,
            link: None,
            output: NativePath::from_path(&world.output),
            folder: NativePath::from_path(
                &world.output.join(PROJECT).join(format!("{RUN} (rev 2)")),
            ),
            results_folder: outcome.revision.results_folder.clone(),
            entries: vec![persistence_library::NewPreparedEntry {
                member_key: None,
                asset_id: None,
                master_id: None,
                input: PreparedInput::Light,
                kind: PreparedEntryKind::Copy,
                path: NativePath::from_path(&world.output.join("pending.fits")),
                source: Some(NativePath::from_path(&world.light(OIII_LIGHTS[0]))),
                size_bytes: 1,
                blocked: None,
            }],
        })
        .await
        .unwrap();
    let error = world.library.mark_view_complete(world.run).await.unwrap_err();
    refused(&error, &format!("{RUN} (rev 2)"));
    let catalog_path = world.temp.path().join("library.sqlite");
    drop(std::mem::replace(
        &mut world.library,
        platevault_core::library::Library::open(&catalog_path, None).await.unwrap(),
    ));
    let paused = world.catalog().preparation(running.revision.id).await.unwrap().revision;
    assert_eq!(paused.state, PreparationState::Paused);
    assert_eq!(world.view().await.completion, RunCompletion::Open);
    world.library.mark_view_complete(world.run).await.unwrap();
}
