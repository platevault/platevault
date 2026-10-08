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
                basis: None,
                header_changes: Vec::new(),
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

/// PREP-FR-09, D19: Retry verifies each entry against the basis Prepare
/// recorded, never one rebuilt from the run's current calibration. A dark
/// blocked for drift whose assignment changed afterwards stays blocked,
/// named as no longer in the reviewed selection, and the revision is never
/// Prepared.
#[tokio::test]
async fn retry_keeps_entry_whose_basis_left_the_selection() {
    let world = world().await;
    let dark = world.calibration_file("darks/Dark_300s_001.fits");
    overwrite_in_place(&dark);
    let profile = world.siril(QUIET).await;
    let outcome =
        world.prepare(&world.request(&profile, InputMode::Copy, None), &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Partial, "{outcome:#?}");
    assert_eq!(outcome.blocked[0].reason.as_ref().unwrap().code, ReasonCode::SourceDrift);
    let recorded = outcome.blocked[0].basis.as_ref().expect("Prepare records the basis");
    assert_eq!(recorded.origin, BasisOrigin::CalibrationAssignment);

    let plan = world.library.calibration_view_plan(world.run, 1).await.unwrap();
    let darks: Vec<RequirementKey> = plan
        .requirements
        .iter()
        .filter(|requirement| requirement.kind == InputKind::Dark)
        .map(Requirement::key)
        .collect();
    world
        .library
        .calibration_exclude(world.run, 1, plan.plan_revision, &darks, Some("darks re-shot"))
        .await
        .unwrap();
    let retried =
        world.library.retry_preparation(outcome.revision.id, &Watch::quiet()).await.unwrap();
    assert_ne!(retried.revision.state, PreparationState::Prepared, "{retried:#?}");
    // The drifted dark stays blocked; the dark prepared before the change
    // leaves the selection too and is blocked at the terminal check.
    assert_eq!(retried.blocked.len(), 2, "{retried:#?}");
    for blocked in &retried.blocked {
        assert_eq!(blocked.input, PreparedInput::Dark);
        let reason = blocked.reason.as_ref().unwrap();
        assert_eq!(reason.code, ReasonCode::SourceDrift);
        assert!(
            reason.detail.contains("no longer in the reviewed selection; review again"),
            "{reason:?}"
        );
    }
    assert!(retried
        .blocked
        .iter()
        .any(|entry| entry.source.as_ref().map(path) == Some(dark.clone())));
    assert!(!retried.offers.contains(&PreparationOffer::Open));
}

/// PREP-FR-06/10: the revision records the parent in the form the user
/// chose and hands that form to the application; the canonical form only
/// answers containment, so a parent inside the prepared folder is still
/// refused when written another way.
#[tokio::test]
async fn chosen_parent_form_is_recorded() {
    let world = world().await;
    let linked = world.temp.path().join("Linked work");
    std::os::unix::fs::symlink(world.output.parent().unwrap(), &linked).unwrap();
    let chosen = linked.join("Processing");
    let profile = world.siril(QUIET).await;
    let mut request = world.request(&profile, InputMode::Copy, None);
    request.output = Some(NativePath::from_path(&chosen));
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let location = review.location.clone().unwrap();
    assert_eq!(path(&location.output), chosen);
    assert_eq!(path(&location.folder), chosen.join(PROJECT).join(RUN));
    assert_eq!(path(&location.results), chosen.join(PROJECT).join(format!("{RUN} Results")));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert_eq!(path(&outcome.revision.output), chosen);
    assert!(path(&outcome.revision.folder).starts_with(&chosen));
    assert!(path(&outcome.revision.results_folder).starts_with(&chosen));
    assert!(outcome.prepared.iter().all(|entry| path(&entry.path).starts_with(&chosen)));

    let inside = fs::canonicalize(path(&outcome.revision.folder)).unwrap().join("Lights");
    request.output = Some(NativePath::from_path(&inside));
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert!(
        matches!(review.location_check, LocationCheck::InsidePreparedFolder { .. }),
        "{:?}",
        review.location_check
    );
}

/// PREP-FR-03, PREP-AC-06, D15: review shows a confirmed FILTER correction
/// next to the header value. Prepare waits for a choice; a patched Copy
/// carries the catalog value in the copy's header only, differs from the
/// source by that card alone and re-verifies at Open; the source is
/// unchanged. Excluding the input leaves it out of the revision.
#[tokio::test]
async fn catalog_correction_patched_copy_or_excluded() {
    let world = world().await;
    let source = world.light(HA_LIGHTS[0]);
    let original = fs::read(&source).unwrap();
    let asset = world.correct(HA_LIGHTS[0], "filter", serde_json::json!("OIII")).await;
    let profile = world.siril(QUIET).await;
    let mut request = world.request(&profile, InputMode::Copy, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let [correction] = review.corrections.as_slice() else {
        panic!("one corrected input: {:#?}", review.corrections);
    };
    assert_eq!(correction.asset_id, asset);
    assert_eq!(path(&correction.source), source);
    let [field] = correction.fields.as_slice() else { panic!("{correction:#?}") };
    assert_eq!(
        (field.field.as_str(), field.header.as_deref(), field.catalog.as_deref()),
        ("filter", Some("Ha"), Some("OIII"))
    );
    assert_eq!(field.keywords, ["FILTER"]);
    assert!(!correction.delivered);
    assert!(correction.options.iter().all(|option| option.refusal.is_none()), "{correction:#?}");
    assert!(review.refusals.iter().any(|r| r.contains("choose a patched Copy")), "{review:#?}");
    let revision = world.membership_revision().await;
    let error = world
        .library
        .prepare_run(world.run, &request, revision, &Watch::quiet())
        .await
        .unwrap_err();
    refused(&error, "the application reads the header");

    request.corrections.insert(asset, CorrectionChoice::Patch);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert!(review.corrections[0].delivered);
    assert!(review.refusals.is_empty(), "{:?}", review.refusals);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let entry = outcome.prepared.iter().find(|e| e.asset_id == Some(asset)).unwrap();
    assert_eq!(entry.header_changes.len(), 1);
    let patched = fs::read(path(&entry.path)).unwrap();
    assert_eq!(fs::read(&source).unwrap(), original, "the source is never written");
    assert_eq!(patched.len(), original.len());
    let differing: Vec<usize> =
        (0..original.len()).filter(|i| patched[*i] != original[*i]).collect();
    let card = original.chunks(80).position(|card| card.starts_with(b"FILTER  =")).unwrap();
    assert!(differing.iter().all(|i| i / 80 == card), "only the FILTER card differs");
    assert!(String::from_utf8_lossy(&patched[card * 80..card * 80 + 80])
        .starts_with("FILTER  = 'OIII    '"));
    let other = outcome.prepared.iter().find(|e| e.asset_id != Some(asset)).unwrap();
    assert!(other.header_changes.is_empty());
    assert_eq!(digest(&path(&other.path)), digest(&path(other.source.as_ref().unwrap())));
    let opened = world.library.open_preparation(outcome.revision.id).await.unwrap();
    assert!(matches!(opened, OpenOutcome::Launched { .. }), "{opened:?}");

    request.corrections.insert(asset, CorrectionChoice::Exclude);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert!(review.entries.iter().all(|entry| entry.asset_id != Some(asset)));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert!(outcome
        .prepared
        .iter()
        .all(|entry| entry.source.as_ref().map(path) != Some(source.clone())));
    let lights = outcome.prepared.iter().filter(|entry| entry.input == PreparedInput::Light);
    assert_eq!(lights.count(), 3, "the three other lights");
}

/// PREP-FR-03, PREP-AC-06: Linked View never patches: the correction is
/// listed as not delivered, a patch is refused naming why, and accepting
/// the source value links the original unchanged.
#[tokio::test]
async fn catalog_correction_never_patches_links() {
    let world = world().await;
    let source = world.light(HA_LIGHTS[0]);
    let before = digest(&source);
    let asset = world.correct(HA_LIGHTS[0], "filter", serde_json::json!("OIII")).await;
    let profile = world.siril(QUIET).await;
    let mut request = world.request(&profile, InputMode::LinkedView, None);
    request.corrections.insert(asset, CorrectionChoice::Patch);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let correction = &review.corrections[0];
    assert!(!correction.delivered);
    let patch = correction.options.iter().find(|o| o.choice == CorrectionChoice::Patch).unwrap();
    assert!(patch.refusal.as_ref().unwrap().contains("never patched"), "{patch:?}");
    assert!(review.refusals.iter().any(|r| r.contains("never patched")), "{:?}", review.refusals);
    let revision = world.membership_revision().await;
    let error = world
        .library
        .prepare_run(world.run, &request, revision, &Watch::quiet())
        .await
        .unwrap_err();
    refused(&error, "links and Direct-source originals are never patched");

    request.corrections.insert(asset, CorrectionChoice::AcceptSource);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let entry = outcome.prepared.iter().find(|e| e.asset_id == Some(asset)).unwrap();
    assert_eq!(entry.kind, PreparedEntryKind::Symlink);
    assert!(entry.header_changes.is_empty());
    assert_eq!(fs::read_link(path(&entry.path)).unwrap(), source);
    assert_eq!(digest(&source), before);
}

/// PREP-FR-06/07: a run's first Results folder takes the chosen folder
/// name, and a folder the catalog records for another run collides even
/// when it is missing on disk: review names it `FolderExists`, Prepare
/// refuses it as never reused, and another name resolves it.
#[tokio::test]
async fn recorded_results_folder_collision_named_and_resolved() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let view = world.view().await;
    let other = world
        .catalog()
        .create_view(&NewView {
            project_id: view.project_id,
            subject_id: view.subject_id,
            rig_id: view.rig_id,
            name: "Other".into(),
        })
        .await
        .unwrap()
        .view
        .id;
    world.catalog().save_view(other, 0, 1).await.unwrap();
    let project = world.output.join(PROJECT);
    let taken_results = project.join(format!("{RUN} Results"));
    let taken_folder = project.join("Other");
    let recorded = world
        .catalog()
        .start_preparation(&persistence_library::NewPreparation {
            view_id: other,
            n: 1,
            membership_revision: 1,
            profile_id: profile.id,
            mode: InputMode::Copy,
            link: None,
            output: NativePath::from_path(&world.output),
            folder: NativePath::from_path(&taken_folder),
            results_folder: NativePath::from_path(&taken_results),
            entries: vec![persistence_library::NewPreparedEntry {
                member_key: None,
                asset_id: None,
                master_id: None,
                input: PreparedInput::Light,
                kind: PreparedEntryKind::Copy,
                path: NativePath::from_path(&taken_folder.join("Lights/a.fits")),
                source: None,
                size_bytes: 1,
                basis: None,
                header_changes: Vec::new(),
                blocked: Some(ItemReason::new(ReasonCode::SourceUnavailable, "fixture")),
            }],
        })
        .await
        .unwrap();
    world
        .catalog()
        .finish_preparation(recorded.revision.id, PreparationState::Failed, Some("fixture"))
        .await
        .unwrap();
    assert!(!taken_results.exists() && !taken_folder.exists());

    let mut request = world.request(&profile, InputMode::Copy, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert_eq!(
        review.location_check,
        LocationCheck::FolderExists { folder: NativePath::from_path(&taken_results) }
    );
    let revision = world.membership_revision().await;
    let error = world
        .library
        .prepare_run(world.run, &request, revision, &Watch::quiet())
        .await
        .unwrap_err();
    refused(&error, "never reused");

    request.folder_name = Some("Other".into());
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert_eq!(
        review.location_check,
        LocationCheck::FolderExists { folder: NativePath::from_path(&taken_folder) }
    );

    request.folder_name = Some(format!("{RUN} B"));
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    assert_eq!(review.location_check, LocationCheck::Ready);
    let location = review.location.unwrap();
    assert_eq!(path(&location.results), project.join(format!("{RUN} B Results")));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert_eq!(path(&outcome.revision.results_folder), project.join(format!("{RUN} B Results")));
}
