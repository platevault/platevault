// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run Clean up and Empty Trash (spec 071 STO-FR-01..05/10/17, STO-AC-01..04,
//! STO-AC-08/09/11/20/24, PREP-FR-14, RES-FR-10, RES-AC-22, PV-PREP-SC-04;
//! D-W26, D-W72, D-W75) on the composed library over real files and a
//! stand-in OS Trash: only prepared entries are listed and preselected, a
//! hardlink holding the last copy stays, items without an OS Trash stay and
//! are named, Empty Trash moves the prepared folders and the Results folder
//! only when ticked and removes the run record, and library frames with their
//! quality decisions never change.
#![cfg(unix)]

#[path = "support/cleanup.rs"]
mod cleanup_support;
#[path = "support/prepare_group.rs"]
mod group_support;
#[path = "support/prepare.rs"]
mod prepare_support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cleanup_support::{
    decide, frames, index_folder, items, paths, stays_for, try_raw_sql, ScopedTrash,
};
use platevault_core::*;
use prepare_support::{digest, tree, world, Watch, World, HA_LIGHTS, PROJECT, RUN};
use uuid::Uuid;

const QUIET: &str = "exit 0";

fn path(native: &NativePath) -> PathBuf {
    native.to_path_buf().unwrap()
}

/// Review Clean up of the world's run with `selection` on `trash`.
async fn review_clean_up(
    world: &World,
    selection: CleanupSelection,
    trash: &Arc<ScopedTrash>,
) -> Result<CleanupReview, LibraryError> {
    let request = CleanupRequest::CleanUp { view_id: world.run, selection };
    world.library.review_cleanup(&request, trash.dyn_trash()).await
}

fn results_folder(world: &World) -> PathBuf {
    world.output.join(PROJECT).join(format!("{RUN} Results"))
}

/// Every source and Results file with its SHA-256.
fn untouched(world: &World) -> Vec<(PathBuf, String)> {
    let mut files: Vec<(PathBuf, String)> =
        world.sources().iter().map(|source| (source.clone(), digest(source))).collect();
    let results = results_folder(world);
    if results.exists() {
        files.extend(tree(&results));
    }
    files
}

/// Write an intermediate, a final image and an unknown file into the
/// Results folder, as the processing application would.
fn write_results(world: &World) -> Vec<PathBuf> {
    let results = results_folder(world);
    let written = ["process/pp_light_001.fits", "NGC7000_HOO_final.fits", "notes.txt"]
        .iter()
        .map(|name| {
            let file = results.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, format!("{name} written by the application")).unwrap();
            file
        })
        .collect();
    written
}

/// Rev 1 Linked View (symlinks), rev 2 Copy without one OIII frame.
async fn two_revisions(world: &World) -> (PreparationOutcome, PreparationOutcome) {
    let profile = world.siril(QUIET).await;
    let linked = world.request(&profile, InputMode::LinkedView, None);
    let first = world.prepare(&linked, &Watch::quiet()).await;
    assert_eq!(first.revision.state, PreparationState::Prepared, "{first:#?}");
    world.drop_one_oiii_frame().await;
    let copy = world.request(&profile, InputMode::Copy, None);
    let second = world.prepare(&copy, &Watch::quiet()).await;
    assert_eq!(second.revision.state, PreparationState::Prepared, "{second:#?}");
    (first, second)
}

/// STO-AC-01, STO-AC-20, STO-FR-01/02, PV-PREP-SC-04: a Complete run's Clean
/// up lists its symlink and copy groups, preselected, and nothing else: no
/// Results file and no original frame. Deselecting a group keeps its entries
/// out of the recorded review.
#[tokio::test]
async fn cleanup_lists_only_prepared_entries_preselected() {
    let world = world().await;
    let (first, second) = two_revisions(&world).await;
    write_results(&world);
    world.library.mark_view_complete(world.run).await.unwrap();
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));

    let review = review_clean_up(&world, CleanupSelection::default(), &trash);
    let review = review.await.unwrap();
    let roles: Vec<(CleanupRole, bool, u32)> =
        review.groups.iter().map(|group| (group.role, group.selected, group.count)).collect();
    assert_eq!(
        roles,
        vec![(CleanupRole::Symlink, true, 10), (CleanupRole::Copy, true, 9)],
        "{review:#?}"
    );
    let folders = [path(&first.revision.folder), path(&second.revision.folder)];
    let listed = paths(items(&review));
    assert!(listed.iter().all(|item| folders.iter().any(|folder| item.starts_with(folder))));
    let sources = world.sources();
    assert!(listed.iter().all(|item| !sources.contains(item)), "no original frame is listed");
    assert!(listed.iter().all(|item| !item.starts_with(results_folder(&world))));
    assert!(items(&review).iter().all(|item| item.state == CleanupItemState::Moves));
    let symlinks = &review.groups[0];
    assert!(!symlinks.reclaim_guaranteed, "a link size is never guaranteed reclaim");
    assert!(review.groups[1].reclaim_guaranteed);
    assert!(items(&review)
        .iter()
        .filter(|item| item.role == CleanupRole::Copy)
        .all(|item| item.relies_on.as_ref().is_some_and(|kept| sources.contains(&path(kept)))));
    assert_eq!(review.moves, 19);
    assert!(review.staying.is_empty());

    let selection =
        CleanupSelection { excluded_roles: vec![CleanupRole::Copy], ..CleanupSelection::default() };
    let review = review_clean_up(&world, selection, &trash);
    let review = review.await.unwrap();
    let copies = review.groups.iter().find(|group| group.role == CleanupRole::Copy).unwrap();
    assert!(!copies.selected);
    assert!(copies.items.iter().all(|item| item.state == CleanupItemState::NotSelected));
    assert_eq!(review.moves, 10, "only the symlinks are reviewed");
    let recorded = world.catalog().run_cleanup(review.id.unwrap()).await.unwrap();
    let operation = world.catalog().storage_operation(recorded.operation_id.unwrap()).await;
    let operation = operation.unwrap();
    assert_eq!(operation.items.len(), 10);
    assert!(operation.items.iter().all(|item| matches!(item.source.kind, EntryKind::Link { .. })));
    assert!(trash.moved().is_empty(), "the review moves nothing");
}

/// A verified read-only profile that takes its inputs as a list, so it can
/// open a Direct-source run.
async fn direct_profile(world: &World) -> Profile {
    let proofs = Capability::ALL
        .into_iter()
        .map(|capability| CapabilityProof { capability, evidence: format!("fixture {capability}") })
        .collect();
    let input = ProfileInput {
        name: "Siril list".into(),
        kind: ProfileKind::Siril,
        executable: Some(NativePath::from_path(Path::new("/bin/sh"))),
        args: vec!["-c".into(), QUIET.into(), "sh".into(), "{results}".into(), "{inputs}".into()],
        capability_evidence: CapabilityEvidence {
            input_behavior: InputBehavior::ReadOnly,
            input_list: true,
            proofs,
        },
    };
    world.catalog().create_profile(&input).await.unwrap()
}

/// STO-AC-02, STO-FR-03, PREP-AC-20: a Direct-source run's Clean up lists
/// nothing, so no original sub is ever a candidate, and its Empty Trash
/// leaves every original where it is.
#[tokio::test]
async fn direct_source_cleanup_empty() {
    let world = world().await;
    let profile = direct_profile(&world).await;
    let request = world.request(&profile, InputMode::DirectSource, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    assert!(outcome.prepared.iter().all(|entry| entry.kind == PreparedEntryKind::DirectSource));
    world.library.mark_view_complete(world.run).await.unwrap();
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));
    let originals = untouched(&world);

    let review = review_clean_up(&world, CleanupSelection::default(), &trash);
    let review = review.await.unwrap();
    assert!(review.groups.is_empty(), "{review:#?}");
    assert_eq!((review.id, review.moves), (None, 0));
    assert!(review.statement.contains("created no entries"), "{}", review.statement);

    world.library.move_view_to_trash(world.run).await.unwrap();
    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: false };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    let sources = world.sources();
    assert!(paths(items(&review)).iter().all(|item| !sources.contains(item)), "{review:#?}");
    let emptied = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed);
    assert!(trash.moved().iter().all(|moved| !sources.contains(moved)));
    assert_eq!(untouched(&world), originals, "every original stays in place");
}

/// STO-AC-04, STO-AC-24: a prepared hardlink whose original was deleted
/// externally holds the last copy; insufficient retained-original proof
/// keeps it in place, named, both in Clean up and in Empty Trash, and the
/// other hardlinks go once their originals re-verify.
#[tokio::test]
async fn hardlink_last_copy_blocked() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::LinkedView, Some(LinkKind::Hardlink));
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    world.library.mark_view_complete(world.run).await.unwrap();
    let last = path(&outcome.revision.folder).join("Lights").join("Ha_001.fits");
    let bytes = fs::read(&last).unwrap();
    fs::remove_file(world.light(HA_LIGHTS[0])).unwrap();
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));

    let review = review_clean_up(&world, CleanupSelection::default(), &trash);
    let review = review.await.unwrap();
    let hardlinks = items(&review);
    assert!(hardlinks.iter().all(|item| item.role == CleanupRole::Hardlink));
    let staying: Vec<&&CleanupItem> =
        hardlinks.iter().filter(|item| item.state != CleanupItemState::Moves).collect();
    assert_eq!(staying.len(), 1, "{review:#?}");
    assert_eq!(path(&staying[0].path), last);
    assert_eq!(stays_for(staying[0]), Some(ReasonCode::KeptCopyUnproven));
    assert_eq!(review.staying.len(), 1);
    assert!(review.staying[0].reason.detail.contains("insufficient retained-original proof"));

    // A started Clean up is a storage mutation: it blocks Move run to Trash
    // until it settles, and resumes from its journal (RES-FR-07).
    world.catalog().start_run_cleanup(review.id.unwrap()).await.unwrap();
    let blocked = world.library.move_view_to_trash(world.run).await.unwrap_err();
    assert!(blocked.to_string().contains("Clean up"), "{blocked}");
    let done = world.library.run_cleanup(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert_eq!(done.state, CleanupState::Settled);
    assert_eq!(fs::read(&last).unwrap(), bytes, "the last copy stays in place");
    assert_eq!(done.moved.len(), hardlinks.len() - 1);
    assert_eq!(
        done.left.iter().map(|item| path(&item.path)).collect::<Vec<_>>(),
        vec![last.clone()]
    );
    assert!(done.summary.contains(&last.display().to_string()), "{}", done.summary);
    assert!(!done.complete());

    world.library.move_view_to_trash(world.run).await.unwrap();
    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: false };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    assert_eq!(review.staying.len(), 1, "{review:#?}");
    assert_eq!(path(&review.staying[0].path), last);
    let emptied = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed);
    assert_eq!(fs::read(&last).unwrap(), bytes, "Empty Trash keeps the last copy too");
    assert_eq!(emptied.left.iter().map(|item| path(&item.path)).collect::<Vec<_>>(), vec![last]);
    assert_eq!(trash.bin_len(), trash.moved().len(), "nothing is permanently deleted");
}

/// STO-AC-03, STO-AC-09, STO-AC-24, STO-FR-05: items on a location with no
/// OS Trash stay in place and are named, at review and again when the
/// location loses its Trash after approval; the summary names both sets.
/// Empty Trash names a prepared folder without an OS Trash as one item.
#[tokio::test]
async fn no_trash_location_items_stay_and_are_named() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    world.library.mark_view_complete(world.run).await.unwrap();
    let folder = path(&outcome.revision.folder);
    let (lights, darks) = (folder.join("Lights"), folder.join("Calibration").join("Darks"));
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));
    trash.without_trash(&lights);

    let review = review_clean_up(&world, CleanupSelection::default(), &trash);
    let review = review.await.unwrap();
    let named: Vec<PathBuf> = review.staying.iter().map(|item| path(&item.path)).collect();
    assert_eq!(named.len(), 4, "{review:#?}");
    assert!(named.iter().all(|item| item.starts_with(&lights)));
    assert!(review.staying.iter().all(|item| item.reason.code == ReasonCode::TrashUnsupported));
    assert!(review.staying[0].reason.detail.contains("Reveal location"));
    assert_eq!(review.moves, 6);
    let before: Vec<(PathBuf, String)> = tree(&lights).into_iter().chain(tree(&darks)).collect();

    // Approved; then the Darks location loses its Trash too.
    trash.without_trash(&darks);
    let done = world.library.run_cleanup(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    let left: Vec<(PathBuf, ReasonCode)> =
        done.left.iter().map(|item| (path(&item.path), item.reason.code)).collect();
    assert_eq!(left.len(), 6, "{done:#?}");
    assert!(left
        .iter()
        .all(|(item, code)| (item.starts_with(&lights) || item.starts_with(&darks))
            && *code == ReasonCode::TrashUnsupported));
    assert_eq!(done.moved.len(), 4, "only the flats went");
    assert!(done.moved.iter().all(|item| path(item).starts_with(folder.join("Calibration/Flats"))));
    assert!(done.summary.contains("moved 4 of 10"), "{}", done.summary);
    let after: Vec<(PathBuf, String)> = tree(&lights).into_iter().chain(tree(&darks)).collect();
    assert_eq!(after, before, "unsupported Trash removes zero files even after approval");

    world.library.move_view_to_trash(world.run).await.unwrap();
    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: false };
    let scratch = ScopedTrash::new(&world.temp.path().join("OS Trash 2"));
    scratch.without_trash(&folder);
    let review = world.library.review_cleanup(&request, scratch.dyn_trash()).await.unwrap();
    assert_eq!(review.staying.len(), 1, "{review:#?}");
    assert!(review.staying[0].folder);
    assert_eq!(path(&review.staying[0].path), folder);
    let emptied = world.library.empty_trash(review.id.unwrap(), scratch.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed);
    assert!(scratch.moved().is_empty());
    assert_eq!(emptied.left.len(), 1);
    assert!(emptied.summary.contains(&folder.display().to_string()), "{}", emptied.summary);
    assert!(folder.join("Lights").is_dir(), "the folder stays where it is");
}

/// RES-AC-22, STO-FR-17, PREP-FR-14: Empty Trash lists both prepared
/// folders and the Results folder unticked; confirming moves both prepared
/// folders to the OS Trash entry by entry and then as folders, leaves the
/// Results folder at its path, and removes the run record. Ticking adds the
/// Results files to the review.
#[tokio::test]
async fn empty_trash_moves_prepared_folders_and_results_only_when_ticked_and_removes_run_record() {
    let world = world().await;
    let (first, second) = two_revisions(&world).await;
    let written = write_results(&world);
    let project = world.view().await.project_id;
    world.library.move_view_to_trash(world.run).await.unwrap();
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));
    let sources: Vec<(PathBuf, String)> =
        world.sources().iter().map(|source| (source.clone(), digest(source))).collect();
    let results_before = tree(&results_folder(&world));

    let ticked = CleanupRequest::EmptyTrash { view_id: world.run, results: true };
    let review = world.library.review_cleanup(&ticked, trash.dyn_trash()).await.unwrap();
    let listed = paths(items(&review));
    assert!(written.iter().all(|file| listed.contains(file)), "ticked lists the Results files");
    assert!(review.folders.iter().any(|folder| folder.role == CleanupFolderRole::Results));

    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: false };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    assert_eq!(review.results_folder.as_ref().map(path), Some(results_folder(&world)));
    assert!(!review.results_ticked);
    let listed = paths(items(&review));
    assert!(listed.iter().all(|item| !item.starts_with(results_folder(&world))), "{review:#?}");
    let prepared = [path(&first.revision.folder), path(&second.revision.folder)];
    let folders: Vec<(PathBuf, bool)> =
        review.folders.iter().map(|folder| (path(&folder.path), folder.folder_moves)).collect();
    assert_eq!(folders, vec![(prepared[0].clone(), true), (prepared[1].clone(), true)]);
    assert_eq!(review.moves, 19);
    assert!(review.staying.is_empty(), "{review:#?}");

    let emptied = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert_eq!(emptied.state, CleanupState::Settled);
    assert!(emptied.run_removed && emptied.left.is_empty(), "{emptied:#?}");
    assert!(emptied.complete());
    for folder in &prepared {
        assert!(!folder.exists(), "{} is in the OS Trash", folder.display());
        assert!(emptied.moved.contains(&NativePath::from_path(folder)));
    }
    assert_eq!(tree(&results_folder(&world)), results_before, "the Results folder stays");
    assert_eq!(trash.bin_len(), 19 + 2, "nothing is permanently deleted");
    let links = trash.moved();
    assert!(sources.iter().all(|(source, sha)| digest(source) == *sha), "targets byte-identical");
    assert!(links.iter().all(|moved| !world.sources().contains(moved)));

    let gone = world.catalog().view(world.run).await.unwrap_err();
    assert!(matches!(gone, LibraryError::NotFound(_)), "{gone}");
    assert!(world.catalog().trashed_views(project).await.unwrap().is_empty());
    assert!(world.catalog().view_preparations(world.run).await.unwrap().is_empty());
    assert!(world.library.empty_trash_review(project, &[]).await.unwrap().runs.is_empty());
    // The outcome stays readable after the record is gone, and a resumed
    // Empty Trash moves nothing more.
    let again = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert_eq!(again, emptied);
}

/// STO-FR-17, PV-PREP-SC-04: Clean up and Empty Trash never touch library
/// frames or their quality decisions, even a frame indexed inside the
/// ticked Results folder; zero files go to the OS Trash outside the run's
/// prepared entries and its ticked Results.
#[tokio::test]
async fn library_frames_and_quality_untouched() {
    let world = world().await;
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let results = results_folder(&world);
    fs::write(results.join("master_light.fits"), "an indexed library frame").unwrap();
    let processed = index_folder(&world.library, &results, "Processed").await;
    decide(&world.library, &processed, &["master_light.fits"], Quality::Usable).await;
    decide(&world.library, &world.captures, &[HA_LIGHTS[0]], Quality::Unusable).await;
    fs::write(results.join("pp_light_001.fits"), "an intermediate").unwrap();
    let library_frames = frames(&world.library).await;
    let indexed = results.join("master_light.fits");
    let sources = untouched(&world);
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));

    world.library.mark_view_complete(world.run).await.unwrap();
    let review = review_clean_up(&world, CleanupSelection::default(), &trash);
    let review = review.await.unwrap();
    assert_eq!(review.moves, 10);
    world.library.run_cleanup(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert_eq!(untouched(&world), sources, "Clean up moves no original and no Result");
    assert_eq!(frames(&world.library).await, library_frames);
    let prepared = path(&outcome.revision.folder);
    assert!(trash.moved().iter().all(|moved| moved.starts_with(&prepared)));

    world.library.move_view_to_trash(world.run).await.unwrap();
    let request = CleanupRequest::EmptyTrash { view_id: world.run, results: true };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    let frame = items(&review).into_iter().find(|item| path(&item.path) == indexed).unwrap();
    assert_eq!(stays_for(frame), Some(ReasonCode::Protected), "{review:#?}");
    let emptied = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed);
    assert_eq!(fs::read_to_string(&indexed).unwrap(), "an indexed library frame");
    assert!(!results.join("pp_light_001.fits").exists(), "the ticked intermediate went");
    assert_eq!(emptied.left.iter().map(|item| path(&item.path)).collect::<Vec<_>>(), vec![indexed]);
    assert_eq!(
        frames(&world.library).await,
        library_frames,
        "no frame or quality decision changed"
    );
    let originals: Vec<(PathBuf, String)> =
        world.sources().iter().map(|source| (source.clone(), digest(source))).collect();
    assert!(sources.iter().filter(|(file, _)| world.sources().contains(file)).eq(originals.iter()));
    assert!(trash
        .moved()
        .iter()
        .all(|moved| moved.starts_with(&prepared) || moved.starts_with(&results)));
}

/// D-W75: Empty Trash of a trashed panel run removes its record; the group
/// keeps its other panel runs, their folders and their Results untouched.
#[tokio::test]
async fn empty_trash_removes_trashed_panel_run_record() {
    let world = group_support::group_world().await;
    let profile = world.wbpp(QUIET).await;
    let request = world.setup(&profile, InputMode::LinkedView).await;
    let outcome = world.prepare_all(&request, &Watch::quiet()).await;
    assert_eq!(outcome.preparation.outcome, PreparationState::Prepared, "{outcome:#?}");
    let mosaic = world.group_folder(group_support::MOSAIC);
    let others = |tree_of: &dyn Fn(&Path) -> Vec<(PathBuf, String)>| {
        [1, 3]
            .iter()
            .flat_map(|n| {
                tree_of(&mosaic.join(format!("Panel {n}")))
                    .into_iter()
                    .chain(tree_of(&world.results().join(format!("Panel {n}"))))
            })
            .collect::<Vec<_>>()
    };
    let before = others(&tree);
    let panel2 = world.run(2);
    fs::write(world.results().join("Panel 2").join("pp_panel2.fits"), "intermediate").unwrap();
    world.library.move_view_to_trash(panel2).await.unwrap();
    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));

    let request = CleanupRequest::EmptyTrash { view_id: panel2, results: true };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    assert!(review.staying.is_empty(), "{review:#?}");
    let emptied = world.library.empty_trash(review.id.unwrap(), trash.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed && emptied.left.is_empty(), "{emptied:#?}");
    assert!(!mosaic.join("Panel 2").exists());
    assert!(!world.results().join("Panel 2").exists(), "the ticked Results folder went");

    let gone = world.catalog().view(panel2).await.unwrap_err();
    assert!(matches!(gone, LibraryError::NotFound(_)), "{gone}");
    let query = ViewQuery { project_id: Some(world.project), offset: 0, limit: 0 };
    let runs: Vec<Uuid> =
        world.catalog().list_views(&query).await.unwrap().iter().map(|r| r.id).collect();
    let mut kept = vec![world.run(1), world.run(3)];
    kept.sort_unstable();
    let mut runs = runs;
    runs.sort_unstable();
    assert_eq!(runs, kept, "the group keeps its other panel runs");
    assert!(world.catalog().trashed_views(world.project).await.unwrap().is_empty());
    assert_eq!(others(&tree), before, "other panels' folders and Results are untouched");
}

/// The immutability triggers keep their protection outside Empty Trash: a
/// committed revision and a calibration decision of a trashed run still
/// refuse deletion, no permit is taken for a run outside the Trash, and
/// Restore is refused while Empty Trash removes the run.
#[tokio::test]
async fn immutability_holds_outside_empty_trash() {
    let world = world().await;
    let database = world.temp.path().join("library.sqlite");
    let run = world.run;
    let error =
        try_raw_sql(&database, &format!("DELETE FROM view_revisions WHERE view_id = '{run}'"))
            .await
            .unwrap_err();
    assert!(error.to_string().contains("immutable"), "{error}");
    let permit = format!("INSERT INTO run_record_removals (view_id) VALUES ('{run}')");
    let error = try_raw_sql(&database, &permit).await.unwrap_err();
    assert!(error.to_string().contains("Empty Trash"), "{error}");

    world.library.move_view_to_trash(run).await.unwrap();
    for (statement, needle) in [
        (format!("DELETE FROM view_revisions WHERE view_id = '{run}'"), "immutable"),
        (format!("DELETE FROM view_members WHERE revision_row IN (SELECT id FROM view_revisions WHERE view_id = '{run}')"), "immutable"),
        (format!("DELETE FROM calibration_decisions WHERE view_id = '{run}'"), "append-only"),
    ] {
        let error = try_raw_sql(&database, &statement).await.unwrap_err();
        assert!(error.to_string().contains(needle), "{statement}: {error}");
    }

    let trash = ScopedTrash::new(&world.temp.path().join("OS Trash"));
    let request = CleanupRequest::EmptyTrash { view_id: run, results: false };
    let review = world.library.review_cleanup(&request, trash.dyn_trash()).await.unwrap();
    let id = review.id.unwrap();
    world.catalog().start_run_cleanup(id).await.unwrap();
    let refused = world.library.catalog().restore_view(run).await.unwrap_err();
    assert!(refused.to_string().contains("cannot be restored"), "{refused}");
    let emptied = world.library.empty_trash(id, trash.dyn_trash()).await.unwrap();
    assert!(emptied.run_removed, "the started Empty Trash resumes and removes the run");
}
