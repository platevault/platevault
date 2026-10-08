// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! PREP Prepare all on a run group (spec 069 PREP-FR-07/12/13,
//! PREP-AC-16/17/18; D-W38, D-W51, D-W67, D-W73) on the composed library over
//! real files: the group folder with one `Panel N/` per panel run, each panel
//! run's Results folder and the Assembled folder outside every group folder,
//! the group outcome from the panel outcomes, Open on the group only when
//! every panel run is verified, a later group revision in its own group
//! folder, and the run lifecycle ports Prepare all registers.
#![cfg(unix)]

#[path = "support/prepare_group.rs"]
mod group_support;
#[path = "support/prepare.rs"]
mod prepare_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use group_support::{group_world, panel, panel_states, GroupWorld, LIGHTS, MOSAIC, PROJECT};
use platevault_core::layout::{self, PanelPaths};
use platevault_core::prepare::PrepareControl;
use platevault_core::*;
use prepare_support::{appears, digest, overwrite_in_place, restore_in_place, tree, Watch};

const QUIET: &str = "exit 0";
const MARK: &str = "echo launched >> \"$1/launched.txt\"";

/// Entries per panel run: three lights, two darks and two flats.
const ENTRIES: usize = 7;

fn path(native: &NativePath) -> PathBuf {
    native.to_path_buf().unwrap()
}

fn refused(error: &LibraryError, needle: &str) {
    assert!(matches!(error, LibraryError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains(needle), "{error} should name {needle}");
}

fn names(folder: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Make panel 2's first two lights unreadable as soon as any entry settles.
fn lock_panel2(world: &GroupWorld) -> (Watch, Vec<PathBuf>) {
    let locked = vec![world.light(2, 1), world.light(2, 2)];
    let sources = locked.clone();
    let watch = Watch::on(move |_| {
        for source in &sources {
            fs::set_permissions(source, fs::Permissions::from_mode(0o000)).unwrap();
        }
    });
    (watch, locked)
}

fn unlock(locked: &[PathBuf]) {
    for source in locked {
        fs::set_permissions(source, fs::Permissions::from_mode(0o644)).unwrap();
    }
}

/// A Prepare control that pauses at its `at`-th step.
struct PauseAt {
    steps: AtomicUsize,
    at: usize,
}

impl PrepareControl for PauseAt {
    fn step(&self) -> PrepareStep {
        if self.steps.fetch_add(1, Ordering::SeqCst) + 1 == self.at {
            PrepareStep::Pause
        } else {
            PrepareStep::Continue
        }
    }

    fn settled(&self, _entry: &PreparedEntry) {}
}

/// PREP-AC-16, PREP-FR-07/12: `<Project>/<Mosaic>/Panel 1/` to `Panel 3/`,
/// each panel run's `<Mosaic> Results/Panel N/` and the group's
/// `<Mosaic> Results/Assembled/`; no Results folder inside the group folder,
/// which holds only the `Panel N/` folders. Each panel shows its entries and
/// own calibration; the shared setup shows once with one total footprint.
#[tokio::test]
async fn group_layout_panels_under_mosaic_and_results_outside() {
    let world = group_world().await;
    let profile = world.wbpp(QUIET).await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let review = world.review(&request).await;
    assert!(review.refusals.is_empty(), "{:?}", review.refusals);
    assert_eq!(review.location_check, LocationCheck::Ready);
    assert_eq!((review.project_name.as_str(), review.mosaic_name.as_str()), (PROJECT, MOSAIC));
    let mosaic = world.group_folder(MOSAIC);
    let results = world.results();
    let location = review.location.clone().unwrap();
    assert_eq!(path(&location.folder), mosaic);
    assert_eq!(location.panels.len(), 3);
    for (place, number) in location.panels.iter().zip(1..) {
        assert_eq!(place.number, number);
        assert_eq!(place.view_id, world.run(number));
        assert_eq!(path(&place.folder), mosaic.join(format!("Panel {number}")));
        assert_eq!(path(&place.results), results.join(format!("Panel {number}")));
        assert!(!path(&place.results).starts_with(&mosaic), "Results outside the group folder");
    }
    assert_eq!(path(&location.assembled), results.join("Assembled"));
    assert!(!path(&location.assembled).starts_with(&mosaic));
    assert_eq!(
        (review.profile.id, review.mode, review.calibration_policy),
        (profile.id, InputMode::Copy, CalibrationPolicy::Automatic),
        "the shared setup, once"
    );
    for panel in &review.panels {
        assert_eq!(panel.entries.len(), ENTRIES, "Panel {}", panel.number);
        assert!(panel.blocked.is_empty() && panel.refusals.is_empty(), "{panel:#?}");
        let calibration = panel.calibration.as_ref().unwrap();
        assert!(calibration.ready && calibration.view_id == panel.view_id, "its own calibration");
        assert!(panel.calibration_review.is_none());
        assert!(panel
            .entries
            .iter()
            .all(|e| path(&e.path).starts_with(mosaic.join(format!("Panel {}", panel.number)))));
    }
    let flats = |number: u32| -> Vec<PathBuf> {
        let panel = review.panels.iter().find(|p| p.number == number).unwrap();
        panel
            .entries
            .iter()
            .filter(|e| e.input == PreparedInput::Flat)
            .map(|e| path(&e.source))
            .collect()
    };
    assert!(flats(1).iter().all(|source| source.to_string_lossy().contains("flats/A")));
    assert!(flats(3).iter().all(|source| source.to_string_lossy().contains("flats/B")));
    let total: u64 = review.panels.iter().map(|panel| panel.footprint_bytes).sum();
    assert!(total > 0 && review.footprint_bytes == total, "one total footprint");
    assert!(review.free_bytes.is_some());
    assert!(!mosaic.exists() && !results.exists(), "review creates nothing");

    let outcome = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(outcome.preparation.outcome, PreparationState::Prepared, "{outcome:#?}");
    assert_eq!(panel_states(&outcome), vec![PreparationState::Prepared; 3]);
    assert_eq!(names(&mosaic), vec!["Panel 1", "Panel 2", "Panel 3"], "only Panel N folders");
    assert_eq!(names(&results), vec!["Assembled", "Panel 1", "Panel 2", "Panel 3"]);
    assert_eq!(results.parent(), mosaic.parent(), "beside the group folder");
    for prepared in &outcome.panels {
        let revision = &prepared.outcome.revision;
        assert_eq!(revision.group_preparation_id, Some(outcome.preparation.id));
        assert_eq!(path(&revision.folder), mosaic.join(format!("Panel {}", prepared.number)));
        assert_eq!(
            path(&revision.results_folder),
            results.join(format!("Panel {}", prepared.number))
        );
        assert_eq!(prepared.outcome.prepared.len(), ENTRIES);
    }
    assert!(mosaic.join("Panel 2/Lights/Ha_001.fits").is_file());
    assert_eq!(digest(&mosaic.join("Panel 2/Lights/Ha_001.fits")), digest(&world.light(2, 1)));

    // A parent inside the group folder is refused; so is a Results folder
    // that would lie inside a group folder.
    let mut inside = request.clone();
    inside.output = Some(NativePath::from_path(&mosaic));
    let review = world.review(&inside).await;
    assert!(
        matches!(review.location_check, LocationCheck::InsidePreparedFolder { .. }),
        "{:?}",
        review.location_check
    );
    let nested = NativePath::from_path(&mosaic.join("Panel 1").join("Results"));
    let paths = [PanelPaths { number: 1, view_id: world.run(1), results: Some(&nested) }];
    let error =
        layout::group_location(&world.output, PROJECT, MOSAIC, 1, None, &paths, None).unwrap_err();
    refused(&error, "cannot be both a prepared folder and the Results folder");
    let paths = [PanelPaths { number: 1, view_id: world.run(1), results: None }];
    let error =
        layout::group_location(&world.output, PROJECT, MOSAIC, 1, None, &paths, Some(&nested))
            .unwrap_err();
    refused(&error, "cannot be both a prepared folder and the Results folder");
    let third =
        layout::group_location(&world.output, PROJECT, MOSAIC, 3, None, &paths, None).unwrap();
    assert_eq!(path(&third.folder), world.group_folder(&format!("{MOSAIC} (rev 3)")));
    assert_eq!(path(&third.panels[0].results), results.join("Panel 1"));
}

/// PREP-FR-07/13, PREP-AC-16: the group Result's folder
/// `<Mosaic> Results/Assembled/` is listed by review, created and recorded by
/// Prepare all, kept by every later group revision, outside every group
/// folder, and handed to the application as `{results}` by Open on the group.
#[tokio::test]
async fn assembled_folder_listed() {
    let world = group_world().await;
    let profile = world.wbpp(MARK).await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let assembled = world.results().join("Assembled");
    let review = world.review(&request).await;
    assert_eq!(path(&review.location.unwrap().assembled), assembled);
    assert!(world.catalog().group_assembled_folder(world.group).await.unwrap().is_none());

    let first = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(first.preparation.outcome, PreparationState::Prepared, "{first:#?}");
    assert_eq!(path(&first.assembled), assembled);
    assert!(assembled.is_dir());
    let native = NativePath::from_path(&assembled);
    assert_eq!(
        world.catalog().group_assembled_folder(world.group).await.unwrap(),
        Some(native.clone())
    );
    let recorded = world.catalog().recorded_preparation_folders().await.unwrap();
    assert!(recorded.results.contains(&native), "{recorded:?}");
    assert!(recorded.prepared.contains(&first.preparation.folder), "the group folder is recorded");

    let second = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(second.preparation.n, 2);
    assert_eq!(path(&second.preparation.folder), world.group_folder(&format!("{MOSAIC} (rev 2)")));
    assert_eq!(second.assembled, first.assembled, "every group revision keeps it");
    for folder in [&first.preparation.folder, &second.preparation.folder] {
        assert!(!assembled.starts_with(path(folder)));
    }
    assert_eq!(
        world.catalog().group_preparations(world.group).await.unwrap().len(),
        2,
        "both group revisions are listed"
    );

    let opened = world.library.open_group_preparation(second.preparation.id).await.unwrap();
    let OpenOutcome::Launched { folder, .. } = opened else {
        panic!("a verified group opens: {opened:?}");
    };
    assert_eq!(folder, second.preparation.folder);
    assert!(appears(&assembled.join("launched.txt")).await, "{{results}} is the Assembled folder");
}

/// PREP-AC-17, PREP-FR-12: two Panel 2 inputs unreadable during Prepare all
/// leave Panels 1 and 3 Prepared, Panel 2 Partial with the two blocked and
/// the group Partial; the sources are untouched. The group outcome follows
/// the panel outcomes; a pause stops every panel run not done, Retry
/// continues them, and a Running Prepare all blocks its panel runs' lifecycle
/// actions until closing `PlateVault` leaves it Paused.
#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn group_outcome_partial_when_one_panel_partial() {
    use PreparationState::{Canceled, Failed, Partial, Paused, Prepared, Running};
    let mut world = group_world().await;
    let profile = world.wbpp(QUIET).await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let digests: Vec<String> = world.sources().iter().map(|source| digest(source)).collect();
    let (watch, locked) = lock_panel2(&world);
    let outcome = world.prepare_all(&request, &watch).await;
    unlock(&locked);
    assert_eq!(outcome.preparation.outcome, PreparationState::Partial, "{outcome:#?}");
    assert_eq!(
        panel_states(&outcome),
        vec![PreparationState::Prepared, PreparationState::Partial, PreparationState::Prepared]
    );
    let panel2 = panel(&outcome, 2);
    assert_eq!((panel2.prepared.len(), panel2.blocked.len()), (ENTRIES - 2, 2));
    for entry in &panel2.blocked {
        assert!(locked.contains(&path(entry.source.as_ref().unwrap())));
        assert_eq!(entry.reason.as_ref().unwrap().code, ReasonCode::SourceUnavailable);
    }
    for number in [1, 3] {
        let other = panel(&outcome, number);
        assert!(other.blocked.is_empty(), "Panel 2's blocked items never block Panel {number}");
        assert_eq!(other.prepared.len(), ENTRIES);
    }
    let after: Vec<String> = world.sources().iter().map(|source| digest(source)).collect();
    assert_eq!(after, digests, "sources are untouched");

    for (panels, group) in [
        (vec![Prepared, Prepared, Prepared], Prepared),
        (vec![Failed, Failed, Failed], Failed),
        (vec![Prepared, Failed, Prepared], Partial),
        (vec![Prepared, Partial, Prepared], Partial),
        (vec![Prepared, Running, Prepared], Partial),
        (vec![Prepared, Canceled, Canceled], Canceled),
        (vec![Prepared, Paused, Paused], Paused),
    ] {
        assert_eq!(GroupPreparation::outcome_for(panels.clone()), group, "{panels:?}");
    }

    // Pausing in Panel 2 leaves Panel 2 and Panel 3 Paused; Retry continues.
    let pause = PauseAt { steps: AtomicUsize::new(0), at: ENTRIES + 2 };
    let paused = world.prepare_all(&request, &pause).await;
    assert_eq!(paused.preparation.outcome, Paused, "{paused:#?}");
    assert_eq!(panel_states(&paused), vec![Prepared, Paused, Paused]);
    assert_eq!(panel(&paused, 2).prepared.len(), 1);
    assert_eq!(panel(&paused, 3).pending.len(), ENTRIES);
    assert!(paused.offers.contains(&PreparationOffer::Retry));
    let retried = world
        .library
        .retry_group_preparation(paused.preparation.id, &Watch::quiet())
        .await
        .unwrap();
    assert_eq!(retried.preparation.outcome, Prepared, "{retried:#?}");
    assert_eq!(panel_states(&retried), vec![Prepared; 3]);

    // A Running Prepare all blocks Mark Complete and Move run to Trash on
    // each of its panel runs; closing PlateVault leaves it Paused.
    let review = world.review(&request).await;
    let location = review.location.clone().unwrap();
    let input = persistence_library::NewGroupPreparation {
        group_id: world.group,
        n: review.preparation_number,
        profile_id: profile.id,
        mode: InputMode::Copy,
        link: None,
        output: location.output.clone(),
        folder: location.folder.clone(),
        assembled: location.assembled.clone(),
        panels: review
            .panels
            .iter()
            .zip(&location.panels)
            .map(|(panel, place)| persistence_library::NewPanelPreparation {
                view_id: panel.view_id,
                n: panel.preparation_number,
                membership_revision: panel.membership_revision,
                folder: place.folder.clone(),
                results_folder: place.results.clone(),
                entries: vec![persistence_library::NewPreparedEntry {
                    member_key: panel.entries[0].member_key,
                    asset_id: panel.entries[0].asset_id,
                    master_id: None,
                    input: PreparedInput::Light,
                    kind: PreparedEntryKind::Copy,
                    path: panel.entries[0].path.clone(),
                    source: Some(panel.entries[0].source.clone()),
                    size_bytes: panel.entries[0].size_bytes,
                    blocked: None,
                }],
            })
            .collect(),
    };
    let running = world.catalog().start_group_preparation(&input).await.unwrap();
    assert_eq!(running.preparation.outcome, Running);
    let name = format!("{MOSAIC} (rev 3)");
    let error = world.library.mark_view_complete(world.run(1)).await.unwrap_err();
    refused(&error, &name);
    let error = world.library.move_view_to_trash(world.run(3)).await.unwrap_err();
    refused(&error, &name);
    let error = world.catalog().start_group_preparation(&input).await.unwrap_err();
    refused(&error, "is Running");
    let catalog_path = world.temp.path().join("library.sqlite");
    drop(std::mem::replace(
        &mut world.library,
        platevault_core::library::Library::open(&catalog_path, None).await.unwrap(),
    ));
    let closed = world.library.group_preparation_outcome(running.preparation.id).await.unwrap();
    assert_eq!(closed.preparation.outcome, Paused, "closing never completes it");
    assert_eq!(panel_states(&closed), vec![Paused; 3]);
    world.library.mark_view_complete(world.run(1)).await.unwrap();
}

/// PREP-AC-17, PREP-FR-13: Open on the group is not offered while a panel
/// run is Partial, and Open on a verified panel run stays available. Once
/// every panel run is verified the group offers Open, re-verifies every
/// panel's entries before launch, refuses on drift naming the entry, and
/// launches once the bytes return.
#[tokio::test]
async fn open_on_group_only_when_every_panel_verified() {
    let world = group_world().await;
    let profile = world.wbpp(MARK).await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let (watch, locked) = lock_panel2(&world);
    let outcome = world.prepare_all(&request, &watch).await;
    unlock(&locked);
    assert_eq!(outcome.preparation.outcome, PreparationState::Partial, "{outcome:#?}");
    assert!(!outcome.offers.contains(&PreparationOffer::Open), "{:?}", outcome.offers);
    let id = outcome.preparation.id;
    let error = world.library.open_group_preparation(id).await.unwrap_err();
    refused(&error, "every panel run verified");
    assert!(!panel(&outcome, 2).offers.contains(&PreparationOffer::Open));
    for number in [1, 3] {
        assert!(panel(&outcome, number).offers.contains(&PreparationOffer::Open), "Panel {number}");
    }
    let panel1 = panel(&outcome, 1);
    let opened = world.library.open_preparation(panel1.revision.id).await.unwrap();
    assert!(matches!(opened, OpenOutcome::Launched { .. }), "{opened:?}");
    assert!(appears(&path(&panel1.revision.results_folder).join("launched.txt")).await);

    let panel2 = panel(&outcome, 2).revision.id;
    let retried = world.library.retry_preparation(panel2, &Watch::quiet()).await.unwrap();
    assert_eq!(retried.revision.state, PreparationState::Prepared, "{retried:#?}");
    let verified = world.library.group_preparation_outcome(id).await.unwrap();
    assert_eq!(verified.preparation.outcome, PreparationState::Prepared, "{verified:#?}");
    assert!(verified.offers.contains(&PreparationOffer::Open));

    let entry = panel(&verified, 3)
        .prepared
        .iter()
        .find(|entry| entry.input == PreparedInput::Light)
        .unwrap()
        .clone();
    overwrite_in_place(&path(&entry.path));
    let refused_open = world.library.open_group_preparation(id).await.unwrap();
    let OpenOutcome::Refused { drifted } = refused_open else {
        panic!("drift in Panel 3 refuses the group launch: {refused_open:?}");
    };
    assert_eq!(
        drifted.iter().map(|e| e.path.clone()).collect::<Vec<_>>(),
        vec![entry.path.clone()]
    );
    let unverified = world.library.group_preparation_outcome(id).await.unwrap();
    assert!(!unverified.offers.contains(&PreparationOffer::Open), "Panel 3 reads unverified");
    assert_eq!(panel(&unverified, 3).drifted.len(), 1);
    let marker = world.results().join("Assembled").join("launched.txt");
    assert!(!marker.exists(), "nothing was launched");

    restore_in_place(&path(&entry.path));
    let opened = world.library.open_group_preparation(id).await.unwrap();
    assert!(matches!(opened, OpenOutcome::Launched { .. }), "{opened:?}");
    assert!(appears(&marker).await);
    let view = world.catalog().view(world.run(2)).await.unwrap().view;
    assert_eq!(view.completion, RunCompletion::Open, "launching never completes a panel run");
}

/// PREP-AC-18, PREP-FR-13: repreparing Panel 2's new membership revision
/// leaves `<Mosaic>/` and its Panel N folders as they are and proposes
/// `<Mosaic> (rev 2)/` with a `Panel N/` folder for every panel run; the
/// Results folders are kept. Review names Panel 2's calibration needing
/// review until it is matched again. Empty Trash names each of a panel run's
/// `Panel N/` folders and its Results folder; Prepare all skips a panel run
/// in the Trash.
#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn reprepare_panel_proposes_mosaic_rev2_with_all_panels() {
    let world = group_world().await;
    let profile = world.wbpp(QUIET).await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let first = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(first.preparation.outcome, PreparationState::Prepared, "{first:#?}");
    let mosaic = world.group_folder(MOSAIC);
    let before = tree(&mosaic);

    world.drop_last_light(2).await;
    let review = world.review(&request).await;
    assert_eq!(review.preparation_number, 2);
    let rev2 = world.group_folder(&format!("{MOSAIC} (rev 2)"));
    let location = review.location.clone().unwrap();
    assert_eq!(path(&location.folder), rev2);
    assert_eq!(rev2.parent(), mosaic.parent(), "beside the first group folder");
    let folders: Vec<PathBuf> = location.panels.iter().map(|place| path(&place.folder)).collect();
    assert_eq!(folders, (1..=3).map(|n| rev2.join(format!("Panel {n}"))).collect::<Vec<_>>());
    for (place, prepared) in location.panels.iter().zip(&first.panels) {
        assert_eq!(place.results, prepared.outcome.revision.results_folder, "Results are kept");
    }
    assert_eq!(location.assembled, first.assembled);
    let changed: Vec<bool> = review.panels.iter().map(|panel| panel.membership_changed).collect();
    assert_eq!(changed, vec![false, true, false]);
    let panel2 = &review.panels[1];
    assert_eq!(panel2.membership_revision, 2);
    let needs = panel2.calibration_review.expect("Panel 2's calibration needs review");
    assert_eq!(needs.view_id, world.run(2));
    assert!(!panel2.calibration.as_ref().unwrap().ready);
    assert!(review.panels[0].calibration_review.is_none());
    assert!(panel2.blocked.iter().all(|blocked| blocked.input != PreparedInput::Light));
    let error = world.library.review_preparation(world.run(2), &request).await.unwrap_err();
    refused(&error, "prepared with its run group");

    world.assign(2, 2).await;
    let review = world.review(&request).await;
    assert!(review.refusals.is_empty(), "{:?}", review.refusals);
    assert!(review.panels[1].calibration_review.is_none());
    let second = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(second.preparation.outcome, PreparationState::Prepared, "{second:#?}");
    assert_eq!(path(&second.preparation.folder), rev2);
    assert_eq!(tree(&mosaic), before, "the first group folder is untouched");
    assert_eq!(names(&rev2), vec!["Panel 1", "Panel 2", "Panel 3"]);
    let lights = |number: u32| names(&rev2.join(format!("Panel {number}")).join("Lights")).len();
    assert_eq!((lights(1), lights(2), lights(3)), (3, LIGHTS as usize - 1, 3));
    for prepared in &second.panels {
        assert_eq!(prepared.outcome.revision.n, 2, "Panel {}", prepared.number);
    }
    assert_eq!(names(&world.results()), vec!["Assembled", "Panel 1", "Panel 2", "Panel 3"]);

    world.library.move_view_to_trash(world.run(2)).await.unwrap();
    let trash = world.library.empty_trash_review(world.project, &[world.run(2)]).await.unwrap();
    let run = &trash.runs[0];
    let prepared: Vec<(Revision, PathBuf)> =
        run.prepared_folders.iter().map(|f| (f.preparation_revision, path(&f.path))).collect();
    assert_eq!(prepared, vec![(1, mosaic.join("Panel 2")), (2, rev2.join("Panel 2"))]);
    assert_eq!(run.results_folders, vec![NativePath::from_path(&world.results().join("Panel 2"))]);
    let review = world.review(&request).await;
    assert_eq!(review.panels.iter().map(|panel| panel.number).collect::<Vec<_>>(), vec![1, 3]);
    assert_eq!(review.skipped.len(), 1);
    assert_eq!((review.skipped[0].number, review.skipped[0].view_id), (2, world.run(2)));
    assert_eq!(review.preparation_number, 3);
}
