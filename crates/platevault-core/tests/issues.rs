// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Issues on rows (spec 063 FR-032, 064 LIB-FR-17/22, D-W92, D-W144,
//! D-W158) on the composed library over real catalogs and files: each kind
//! on its row and page with its count, the counters over the issues not
//! dismissed, Dismiss and Restore kept across a restart, and a dismissed
//! issue counting again when its count or bytes change, when a new failure
//! is a new operation, or when a location or import that ended its episode
//! starts another. Reading writes nothing. A Project's own waiting work
//! can't be dismissed.

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/home.rs"]
mod home_support;
#[path = "support/membership.rs"]
mod membership_support;
#[path = "support/storage_overview.rs"]
mod overview_support;
#[path = "support/scan.rs"]
mod scan_support;
mod support;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use apply_support::{
    calibration_frames, lights, scan_files, world, World, DARKS, HA, HA_FLATS, OIII, PROJECT,
};
use home_support::{indexed, quiet, running_import};
use overview_support::{register, Duplicates};
use persistence_library::SessionQuery;
use platevault_core::apply::Unattended;
use platevault_core::library::Library;
use platevault_core::*;
use scan_support::scan_to_end;

fn find(view: &IssueView, kind: IssueKind) -> &Issue {
    view.issues
        .iter()
        .chain(&view.dismissed)
        .find(|issue| issue.kind == kind)
        .unwrap_or_else(|| panic!("no {kind} issue in {view:#?}"))
}

fn kinds(issues: &[Issue]) -> Vec<IssueKind> {
    issues.iter().map(|issue| issue.kind).collect()
}

fn counter(view: &IssueView, severity: IssueSeverity) -> u64 {
    match severity {
        IssueSeverity::Danger => view.counts.danger,
        IssueSeverity::Warning => view.counts.warning,
        IssueSeverity::Info => view.counts.info,
    }
}

fn page_count(view: &IssueView, severity: IssueSeverity, page: IssuePage) -> u64 {
    view.pages
        .iter()
        .find(|count| count.severity == severity && count.page == page)
        .map_or(0, |count| count.count)
}

/// Dismiss the counting `issue`: it moves to the dismissed list, and its
/// counter and its page's count each drop by one.
async fn dismiss(library: &Library, issue: &Issue) {
    let before = library.issues().await.unwrap();
    assert!(before.issues.contains(issue), "{before:#?}");
    library.dismiss_issue(&issue.fingerprint).await.unwrap();
    let after = library.issues().await.unwrap();
    assert!(after.dismissed.contains(issue), "{after:#?}");
    assert!(!after.issues.contains(issue), "{after:#?}");
    assert_eq!(counter(&after, issue.severity) + 1, counter(&before, issue.severity));
    assert_eq!(
        page_count(&after, issue.severity, issue.page) + 1,
        page_count(&before, issue.severity, issue.page)
    );
}

/// Rewrite `path` with bytes of the same length and modified time.
fn rewrite_same_stat(path: &Path, bytes: &[u8]) {
    assert_eq!(fs::metadata(path).unwrap().len(), bytes.len() as u64);
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    fs::write(path, bytes).unwrap();
    fs::File::options().write(true).open(path).unwrap().set_modified(modified).unwrap();
}

/// Index `location` again with each of `frames` as it is on disk now.
async fn rescan(world: &World, location: &Location, frames: Vec<(String, CaptureMetadata)>) {
    let root = location.path.to_path_buf().unwrap();
    let frames: Vec<(String, CaptureMetadata, Vec<u8>)> = frames
        .into_iter()
        .map(|(relative, metadata)| {
            let bytes = fs::read(root.join(&relative)).unwrap();
            (relative, metadata, bytes)
        })
        .collect();
    scan_files(&world.library, location, &root, &frames).await;
}

/// Every issue's row, page, severity and count: the Sessions filters'
/// counts as Library counts on Sessions, and the counters and per-page
/// counts equal to the issues that count.
#[tokio::test]
async fn issues_name_their_rows_and_pages_with_counts() {
    let indexed = indexed().await;
    let counts = indexed.library.catalog().session_filter_counts().await.unwrap();
    let view = indexed.library.issues().await.unwrap();
    assert_eq!(
        kinds(&view.issues),
        [IssueKind::NeedsTarget, IssueKind::NotInProject, IssueKind::NeedsCalibration]
    );
    assert!(view.dismissed.is_empty(), "{view:#?}");
    for (kind, severity, count) in [
        (IssueKind::NeedsTarget, IssueSeverity::Warning, counts.needs_target),
        (IssueKind::NotInProject, IssueSeverity::Info, counts.not_in_any_project),
        (IssueKind::NeedsCalibration, IssueSeverity::Warning, counts.needs_calibration),
    ] {
        let issue = find(&view, kind);
        assert_eq!(
            (issue.owner, issue.page, issue.severity, issue.count, issue.bytes),
            (IssueOwner::Library, IssuePage::Sessions, severity, count, None),
            "{issue:#?}"
        );
        assert!(issue.dismissable);
        assert_eq!(issue.fingerprint, format!("{kind}|library|{count}|"));
    }
    assert_eq!((counts.needs_target, counts.not_in_any_project), (3, 4));
    assert_eq!(view.counts, IssueCounts { danger: 0, warning: 2, info: 1 });
    assert_eq!(
        view.pages,
        [
            IssuePageCount {
                severity: IssueSeverity::Warning,
                page: IssuePage::Sessions,
                count: 2
            },
            IssuePageCount { severity: IssueSeverity::Info, page: IssuePage::Sessions, count: 1 },
        ]
    );

    // An offline location is an issue on its own row, opening Settings > Locations.
    let catalog = indexed.library.catalog();
    let location = catalog.list_locations().await.unwrap().remove(0);
    catalog
        .mark_location_unavailable(location.id, Availability::Offline, "the drive is unplugged")
        .await
        .unwrap();
    let view = indexed.library.issues().await.unwrap();
    let offline = find(&view, IssueKind::LocationOffline);
    assert_eq!(
        (offline.owner, offline.page, offline.severity, offline.count, offline.name.as_deref()),
        (
            IssueOwner::Location { id: location.id },
            IssuePage::Locations,
            IssueSeverity::Warning,
            1,
            Some("Captures")
        )
    );
    assert_eq!(view.counts.warning, 3);
    assert!(view.pages.contains(&IssuePageCount {
        severity: IssueSeverity::Warning,
        page: IssuePage::Locations,
        count: 1
    }));
}

/// D-W92, D-W158: Dismiss hides the issue from every counter and page count
/// and lists it as dismissed; a restart keeps the dismissal; Restore makes
/// it count again. Neither changes the state behind the issue.
#[tokio::test]
async fn dismiss_and_restore_survive_a_restart_and_counters_exclude_dismissed() {
    let indexed = indexed().await;
    let path = indexed.temp.path().join("library.sqlite");
    let before = indexed.library.catalog().session_filter_counts().await.unwrap();
    let not_in_project =
        find(&indexed.library.issues().await.unwrap(), IssueKind::NotInProject).fingerprint.clone();
    indexed.library.dismiss_issue(&not_in_project).await.unwrap();
    indexed.library.dismiss_issue(&not_in_project).await.unwrap();

    let view = indexed.library.issues().await.unwrap();
    assert_eq!(kinds(&view.dismissed), [IssueKind::NotInProject]);
    assert_eq!(kinds(&view.issues), [IssueKind::NeedsTarget, IssueKind::NeedsCalibration]);
    assert_eq!(view.counts, IssueCounts { danger: 0, warning: 2, info: 0 });
    assert!(view.pages.iter().all(|page| page.severity != IssueSeverity::Info), "{view:#?}");
    assert_eq!(indexed.library.catalog().session_filter_counts().await.unwrap(), before);

    let temp = indexed.temp;
    drop(indexed.library);
    let library = Library::open(&path, None).await.unwrap();
    let view = library.issues().await.unwrap();
    assert_eq!(kinds(&view.dismissed), [IssueKind::NotInProject], "kept across the restart");
    assert_eq!(view.counts.info, 0);

    library.restore_issue(&not_in_project).await.unwrap();
    let view = library.issues().await.unwrap();
    assert!(view.dismissed.is_empty(), "{view:#?}");
    assert_eq!(view.counts, IssueCounts { danger: 0, warning: 2, info: 1 });
    drop(library);
    let library = Library::open(&path, None).await.unwrap();
    assert!(library.issues().await.unwrap().dismissed.is_empty(), "the Restore is kept too");
    drop(temp);
}

/// D-W158: a dismissed issue whose count changes counts again. Reading
/// writes nothing, so the old dismissal stays recorded and hides nothing.
#[tokio::test]
async fn a_changed_count_brings_a_dismissed_issue_back() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let needs = find(&library.issues().await.unwrap(), IssueKind::NeedsTarget).clone();
    assert_eq!(needs.count, 3);
    library.dismiss_issue(&needs.fingerprint).await.unwrap();
    assert_eq!(kinds(&library.issues().await.unwrap().dismissed), [IssueKind::NeedsTarget]);

    let catalog = library.catalog();
    let session = catalog.session(indexed.needs_target[0]).await.unwrap().summary.session;
    let target =
        catalog.save_target(&home_support::target("M 33", 23.46, 30.66), None).await.unwrap();
    let expected = ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    };
    catalog.associate_target(&[expected], target.candidate.id).await.unwrap();

    let view = library.issues().await.unwrap();
    let back = find(&view, IssueKind::NeedsTarget);
    assert_eq!((back.count, back.id.as_str()), (2, needs.id.as_str()), "same issue, new count");
    assert_ne!(back.fingerprint, needs.fingerprint);
    assert!(view.dismissed.is_empty(), "{view:#?}");
    assert_eq!(view.counts.warning, 2);
    assert_eq!(
        catalog.issue_dismissals().await.unwrap(),
        BTreeSet::from([needs.fingerprint.clone()]),
        "reading forgot nothing"
    );
}

/// D-W158: "a location going offline again brings it back". A dismissed
/// offline issue stays hidden while the location stays offline; the scan
/// that finds it back forgets the dismissal in the same write, and it counts
/// again when it goes offline again.
#[tokio::test]
async fn a_location_going_offline_again_counts_again() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let catalog = library.catalog();
    let location = catalog.list_locations().await.unwrap().remove(0);
    let offline = || async {
        catalog
            .mark_location_unavailable(location.id, Availability::Offline, "ejected")
            .await
            .unwrap();
    };
    offline().await;
    let issue = find(&library.issues().await.unwrap(), IssueKind::LocationOffline).clone();
    dismiss(library, &issue).await;
    offline().await;
    let view = library.issues().await.unwrap();
    assert_eq!(kinds(&view.dismissed), [IssueKind::LocationOffline], "still the same episode");
    assert_eq!(view.counts.warning, 2);

    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    assert_eq!(catalog.location(location.id).await.unwrap().availability, Availability::Available);
    assert!(catalog.issue_dismissals().await.unwrap().is_empty(), "the scan forgot it");
    let view = library.issues().await.unwrap();
    assert!(!kinds(&view.issues).contains(&IssueKind::LocationOffline));
    assert!(view.dismissed.is_empty(), "{view:#?}");

    offline().await;
    let view = library.issues().await.unwrap();
    assert!(view.dismissed.is_empty(), "{view:#?}");
    let again = find(&view, IssueKind::LocationOffline);
    assert_eq!(again.fingerprint, issue.fingerprint);
    assert_eq!(view.counts.warning, 3, "it counts again");
}

/// D-W158 with no read in between: the availability writes alone end the
/// dismissed offline issue, so it counts again the first time anything
/// reads after the location went offline again. Offline to unreadable ends
/// the offline issue too.
#[tokio::test]
async fn going_offline_again_counts_again_with_no_read_in_between() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let catalog = library.catalog();
    let location = catalog.list_locations().await.unwrap().remove(0);
    let mark = |availability| async move {
        catalog.mark_location_unavailable(location.id, availability, "ejected").await.unwrap();
    };
    mark(Availability::Offline).await;
    let offline = find(&library.issues().await.unwrap(), IssueKind::LocationOffline).clone();
    library.dismiss_issue(&offline.fingerprint).await.unwrap();

    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    mark(Availability::Offline).await;
    let view = library.issues().await.unwrap();
    assert!(view.issues.contains(&offline), "{view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");

    library.dismiss_issue(&offline.fingerprint).await.unwrap();
    mark(Availability::Unreadable).await;
    mark(Availability::Offline).await;
    let view = library.issues().await.unwrap();
    assert!(view.issues.contains(&offline), "unreadable in between ended it: {view:#?}");
    assert!(catalog.issue_dismissals().await.unwrap().is_empty());
}

/// An unreadable location, or another folder at its root, is a danger on
/// its row opening Settings > Locations. Both are the same issue, so a
/// dismissal holds across them; it ends when the location is back and
/// counts again when it is unreadable again.
#[tokio::test]
async fn an_unreadable_location_is_a_danger_on_its_row() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let catalog = library.catalog();
    let location = catalog.list_locations().await.unwrap().remove(0);
    let mark = |availability| async move {
        catalog.mark_location_unavailable(location.id, availability, "denied").await.unwrap();
    };
    mark(Availability::Unreadable).await;
    let view = library.issues().await.unwrap();
    let denied = find(&view, IssueKind::LocationDenied).clone();
    assert_eq!(
        (denied.owner, denied.page, denied.severity, denied.count, denied.name.as_deref()),
        (
            IssueOwner::Location { id: location.id },
            IssuePage::Locations,
            IssueSeverity::Danger,
            1,
            Some("Captures")
        )
    );
    assert_eq!(page_count(&view, IssueSeverity::Danger, IssuePage::Locations), 1);
    dismiss(library, &denied).await;

    mark(Availability::IdentityConflict).await;
    let view = library.issues().await.unwrap();
    assert_eq!(
        view.dismissed,
        std::slice::from_ref(&denied),
        "another folder at its root: the same issue"
    );
    assert_eq!(view.counts.danger, 0);

    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    mark(Availability::Unreadable).await;
    let view = library.issues().await.unwrap();
    assert!(view.issues.contains(&denied), "{view:#?}");
    assert_eq!(view.counts.danger, 1, "it counts again");
}

/// D-W158 with bytes: the duplicates issue counts the copies beyond one per
/// content and their bytes; another copy changes both, so a dismissed
/// duplicates issue counts again. A Trashed copy is never counted.
#[tokio::test]
async fn another_duplicate_brings_the_duplicates_issue_back() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let duplicates = Duplicates::new(&library, temp.path()).await;
    let size = fs::metadata(&duplicates.paths[0]).unwrap().len();
    let issue = find(&library.issues().await.unwrap(), IssueKind::Duplicates).clone();
    assert_eq!(
        (issue.owner, issue.page, issue.severity, issue.count, issue.bytes),
        (IssueOwner::Library, IssuePage::Sessions, IssueSeverity::Warning, 1, Some(size)),
        "Disk A and Disk B hold one extra copy; Disk C's is Trashed"
    );
    library.dismiss_issue(&issue.fingerprint).await.unwrap();
    assert_eq!(kinds(&library.issues().await.unwrap().dismissed), [IssueKind::Duplicates]);

    let copy = temp.path().join("Disk D/M31/light_001.fits");
    fs::create_dir_all(copy.parent().unwrap()).unwrap();
    fs::copy(&duplicates.paths[0], &copy).unwrap();
    let disk = register(&library, &temp.path().join("Disk D"), "Disk D").await;
    assert_eq!(scan_to_end(&library, disk.id).await.state, ScanState::Completed);

    let view = library.issues().await.unwrap();
    let back = find(&view, IssueKind::Duplicates);
    assert_eq!((back.count, back.bytes), (2, Some(2 * size)));
    assert!(view.dismissed.is_empty(), "{view:#?}");
    assert!(kinds(&view.issues).contains(&IssueKind::Duplicates), "it counts again");
}

/// P-ISS1: a Project's `View (previous)/` files waiting for review are its
/// own waiting work, on its row and page, and can't be dismissed.
#[tokio::test]
async fn previous_view_review_cannot_be_dismissed() {
    let world = world(ViewMode::Symlinks).await;
    quiet(&world).await;
    world.apply().await;
    let tree = World::tree(&world.view());
    let replaced =
        tree.iter().find(|path| std::path::Path::new(path.as_str()).starts_with("Darks")).unwrap();
    fs::remove_file(world.view().join(replaced)).unwrap();
    fs::write(world.view().join(replaced), DARKS[0]).unwrap();
    world
        .sql(
            "UPDATE projects SET view_mode = 'copies' WHERE id = ?1",
            &[&world.project.to_string()],
        )
        .await;
    world.bump().await;
    assert_eq!(world.apply().await.leftovers.len(), 1);

    let view = world.library.issues().await.unwrap();
    let previous = find(&view, IssueKind::PreviousReview);
    assert_eq!(
        (previous.owner, previous.page, previous.count, previous.dismissable),
        (
            IssueOwner::Project { id: world.project },
            IssuePage::Project { id: world.project },
            1,
            false
        )
    );
    let refused = world.library.dismiss_issue(&previous.fingerprint).await.unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    assert!(world.catalog().issue_dismissals().await.unwrap().is_empty());
}

/// Dismiss takes only a current issue's fingerprint, and Restore only a
/// dismissed one: a stale, unknown, empty or oversized fingerprint records
/// nothing.
#[tokio::test]
async fn stale_fingerprints_are_refused() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let stale = "needs-target|library|99|";
    let refused = library.dismiss_issue(stale).await.unwrap_err();
    assert!(matches!(refused, LibraryError::NotFound(_)), "{refused:?}");
    let current =
        find(&library.issues().await.unwrap(), IssueKind::NeedsTarget).fingerprint.clone();
    let refused = library.restore_issue(&current).await.unwrap_err();
    assert!(matches!(refused, LibraryError::NotFound(_)), "{refused:?}");
    for invalid in [String::new(), "x".repeat(513)] {
        let refused = library.restore_issue(&invalid).await.unwrap_err();
        assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    }
    assert!(library.catalog().issue_dismissals().await.unwrap().is_empty());
    let listed = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(listed.len(), 8, "nothing else changed");
}

/// A held session's pinned calibration file that changed is a danger on the
/// session's row, opening Sessions and counting its drifted pins. Another
/// drifted pin is another count, so the dismissed issue counts again.
#[tokio::test]
async fn a_drifted_pin_is_a_danger_on_its_session() {
    let world = world(ViewMode::Symlinks).await;
    let library = &world.library;
    let ha = world.session_of(&world.captures, HA[0]).await.id;
    let oiii = world.session_of(&world.captures, OIII[0]).await.id;
    assert!(!kinds(&library.issues().await.unwrap().issues).contains(&IssueKind::PinDrift));

    fs::write(world.calibration_file(HA_FLATS[0]), "other bytes of another length").unwrap();
    rescan(&world, &world.calibration, calibration_frames()).await;
    let view = library.issues().await.unwrap();
    let drift = find(&view, IssueKind::PinDrift).clone();
    assert_eq!(
        (drift.owner, drift.page, drift.severity, drift.count, drift.bytes),
        (IssueOwner::Session { id: ha }, IssuePage::Sessions, IssueSeverity::Danger, 1, None),
        "the Ha session's flat pin drifted"
    );
    assert_eq!(page_count(&view, IssueSeverity::Danger, IssuePage::Sessions), 1);
    dismiss(library, &drift).await;

    fs::write(world.calibration_file(DARKS[0]), "other dark bytes").unwrap();
    rescan(&world, &world.calibration, calibration_frames()).await;
    let view = library.issues().await.unwrap();
    let drifted: Vec<(IssueOwner, u64)> = view
        .issues
        .iter()
        .filter(|issue| issue.kind == IssueKind::PinDrift)
        .map(|issue| (issue.owner, issue.count))
        .collect();
    assert_eq!(drifted.len(), 2, "{view:#?}");
    assert!(drifted.contains(&(IssueOwner::Session { id: ha }, 2)), "its dark too: counts again");
    assert!(drifted.contains(&(IssueOwner::Session { id: oiii }, 1)), "{drifted:?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");
}

/// Reviewed frames whose bytes changed on disk are a warning on their
/// session's row (Changed content), counting the frames. Another changed
/// frame is another count, so the dismissed issue counts again.
#[tokio::test]
async fn changed_reviewed_frames_are_drift_on_their_session() {
    let world = world(ViewMode::Symlinks).await;
    let library = &world.library;
    let ha = world.session_of(&world.captures, HA[0]).await.id;
    let change = |relative: &str| {
        let path = world.light(relative);
        let mut bytes = fs::read(&path).unwrap();
        *bytes.last_mut().unwrap() ^= 0xff;
        rewrite_same_stat(&path, &bytes);
    };
    change(HA[0]);
    rescan(&world, &world.captures, lights()).await;
    let view = library.issues().await.unwrap();
    let drift = find(&view, IssueKind::Drift).clone();
    assert_eq!(
        (drift.owner, drift.page, drift.severity, drift.count, drift.bytes),
        (IssueOwner::Session { id: ha }, IssuePage::Sessions, IssueSeverity::Warning, 1, None)
    );
    dismiss(library, &drift).await;

    change(HA[1]);
    rescan(&world, &world.captures, lights()).await;
    let view = library.issues().await.unwrap();
    let back = find(&view, IssueKind::Drift);
    assert_eq!((back.owner, back.count), (IssueOwner::Session { id: ha }, 2));
    assert!(view.issues.contains(back), "it counts again: {view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");
}

/// A location's latest scan that failed is a danger on the scan's row,
/// opening Activity and named after the location. Only each location's
/// latest scan counts, so a completed scan ends it; a new failure is a new
/// operation, so it counts though the first was dismissed.
#[tokio::test]
async fn the_latest_failed_scan_of_a_location_is_a_danger() {
    let indexed = indexed().await;
    let library = &indexed.library;
    let catalog = library.catalog();
    let location = catalog.list_locations().await.unwrap().remove(0);
    let root = location.path.to_path_buf().unwrap();
    let unplugged = root.with_file_name("Captures unplugged");
    let fail = || async {
        fs::rename(&root, &unplugged).unwrap();
        let scan = scan_to_end(library, location.id).await;
        fs::rename(&unplugged, &root).unwrap();
        assert_eq!(scan.state, ScanState::Failed);
        scan.id
    };
    let first = fail().await;
    let view = library.issues().await.unwrap();
    let failed = find(&view, IssueKind::WorkFailed).clone();
    assert_eq!(
        (failed.owner, failed.page, failed.severity, failed.count, failed.name.as_deref()),
        (
            IssueOwner::Operation { id: first },
            IssuePage::Activity,
            IssueSeverity::Danger,
            1,
            Some("Captures")
        )
    );
    dismiss(library, &failed).await;

    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    let view = library.issues().await.unwrap();
    assert!(!kinds(&view.issues).contains(&IssueKind::WorkFailed), "{view:#?}");
    assert!(view.dismissed.is_empty(), "the latest scan completed: {view:#?}");

    let second = fail().await;
    assert_ne!(second, first);
    let view = library.issues().await.unwrap();
    let again = find(&view, IssueKind::WorkFailed);
    assert_eq!(again.owner, IssueOwner::Operation { id: second });
    assert!(view.issues.contains(again), "a new failure counts: {view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");
}

/// The latest measurement run is on its row opening Activity when it was
/// interrupted (a warning) or failed (a danger). Only the latest run counts,
/// and each run is its own subject, so a new failure counts though an
/// earlier one was dismissed.
#[tokio::test]
async fn the_latest_measurement_run_that_was_interrupted_or_failed() {
    let indexed = indexed().await;
    let path = indexed.temp.path().join("library.sqlite");
    let method = MeasurementMethod::new("fixture", 1);
    let interrupted =
        indexed.library.catalog().begin_measurement_run(&method, &[], 1).await.unwrap();
    let temp = indexed.temp;
    drop(indexed.library);
    let library = Library::open(&path, None).await.unwrap();
    let catalog = library.catalog();
    let view = library.issues().await.unwrap();
    let issue = find(&view, IssueKind::WorkInterrupted).clone();
    assert_eq!(
        (issue.owner, issue.page, issue.severity, issue.count, issue.name.as_deref()),
        (
            IssueOwner::Operation { id: interrupted.operation_id },
            IssuePage::Activity,
            IssueSeverity::Warning,
            1,
            None
        ),
        "the restart interrupted the run"
    );
    dismiss(&library, &issue).await;

    let method = &method;
    let finished = |state| async move {
        let run = catalog.begin_measurement_run(method, &[], 1).await.unwrap();
        catalog.finish_measurement_run(run.operation_id, state).await.unwrap();
        run.operation_id
    };
    let first = finished(RunState::Failed).await;
    let view = library.issues().await.unwrap();
    let failed = find(&view, IssueKind::WorkFailed).clone();
    assert_eq!(
        (failed.owner, failed.page, failed.severity),
        (IssueOwner::Operation { id: first }, IssuePage::Activity, IssueSeverity::Danger)
    );
    assert!(!kinds(&view.issues).contains(&IssueKind::WorkInterrupted), "only the latest run");
    assert!(view.dismissed.is_empty(), "{view:#?}");
    dismiss(&library, &failed).await;

    finished(RunState::Completed).await;
    let view = library.issues().await.unwrap();
    assert!(!kinds(&view.issues).contains(&IssueKind::WorkFailed), "{view:#?}");
    assert!(view.dismissed.is_empty(), "the latest run completed: {view:#?}");

    let second = finished(RunState::Failed).await;
    let view = library.issues().await.unwrap();
    let again = find(&view, IssueKind::WorkFailed);
    assert_eq!(again.owner, IssueOwner::Operation { id: second });
    assert!(view.issues.contains(again), "a new failure counts: {view:#?}");
    drop(temp);
}

/// An interrupted import is a warning on its row opening Activity. Retry
/// ends the issue in the same write, so interrupting it again counts again
/// with no read in between.
#[tokio::test]
async fn an_interrupted_import_counts_again_when_interrupted_again() {
    let world = world(ViewMode::Symlinks).await;
    let library = &world.library;
    let catalog = world.catalog();
    let import = running_import(&world).await;
    catalog.set_import_state(import.id, ImportState::Interrupted).await.unwrap();
    let view = library.issues().await.unwrap();
    let issue = find(&view, IssueKind::WorkInterrupted).clone();
    assert_eq!(
        (issue.owner, issue.page, issue.severity, issue.count, issue.name.as_deref()),
        (
            IssueOwner::Operation { id: import.id },
            IssuePage::Activity,
            IssueSeverity::Warning,
            1,
            None
        )
    );
    dismiss(library, &issue).await;

    catalog.set_import_state(import.id, ImportState::Running).await.unwrap();
    assert!(catalog.issue_dismissals().await.unwrap().is_empty(), "Retry ended it");
    catalog.set_import_state(import.id, ImportState::Interrupted).await.unwrap();
    let view = library.issues().await.unwrap();
    assert!(view.issues.contains(&issue), "interrupted again: {view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");
}

/// A Project's latest Apply that failed is a danger on the Project's row,
/// opening the Project. A new failure is a new Apply, so it counts though
/// the first was dismissed; an Apply that succeeds ends it.
#[tokio::test]
async fn a_failed_apply_is_a_danger_on_its_project() {
    let world = world(ViewMode::Copies).await;
    let library = &world.library;
    world.apply().await;
    world.bump().await;
    // The original changes after the sheet, before Apply reads it.
    let fail = || async {
        let preview = world.preview().await;
        let ha = world.light(HA[0]);
        let original = fs::read(&ha).unwrap();
        let mut changed = original.clone();
        changed[100] ^= 1;
        rewrite_same_stat(&ha, &changed);
        let report = library.apply(&World::request(&preview), &Unattended).await.unwrap();
        rewrite_same_stat(&ha, &original);
        assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
        let journal = world.catalog().latest_apply_journal(world.project).await.unwrap();
        journal.unwrap().operation_id
    };
    let first = fail().await;
    let view = library.issues().await.unwrap();
    let failed = find(&view, IssueKind::WorkFailed).clone();
    let project = world.project;
    assert_eq!(
        (failed.owner, failed.page, failed.severity, failed.count, failed.name.as_deref()),
        (
            IssueOwner::Project { id: project },
            IssuePage::Project { id: project },
            IssueSeverity::Danger,
            1,
            Some(PROJECT)
        )
    );
    assert_eq!(failed.id, format!("work-failed|{first}"), "the failed Apply is its subject");
    dismiss(library, &failed).await;

    let second = fail().await;
    assert_ne!(second, first);
    let view = library.issues().await.unwrap();
    let again = find(&view, IssueKind::WorkFailed);
    assert_eq!(again.id, format!("work-failed|{second}"));
    assert!(view.issues.contains(again), "a new failure counts: {view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");

    assert_eq!(world.apply().await.outcome, Some(ApplyOutcome::Applied));
    let view = library.issues().await.unwrap();
    assert!(!kinds(&view.issues).contains(&IssueKind::WorkFailed), "{view:#?}");
    assert!(!kinds(&view.dismissed).contains(&IssueKind::WorkFailed), "{view:#?}");
}

/// Masters a Project's `Processing/` offers to the calibration library are
/// info on the Project's row, opening the Project and counting the offers.
/// Another offer is another count, so the dismissed issue counts again.
#[tokio::test]
async fn offered_masters_are_info_on_their_project() {
    let world = world(ViewMode::Symlinks).await;
    let library = &world.library;
    let classification = Classification {
        kind: InputKind::Flat,
        master: Some(MasterEvidence {
            basis: MasterBasis::HeaderStackCount,
            stack_count: Some(20),
            detector: "test".into(),
        }),
    };
    let offer = |path: &'static str, digit: &'static str| {
        let classification = &classification;
        let world = &world;
        async move {
            let path = NativePath::from_path(Path::new(path));
            let sha256 = digit.repeat(64);
            world
                .catalog()
                .offer_processing_master(world.project, &path, &sha256, classification)
                .await
                .unwrap()
                .unwrap();
        }
    };
    offer("WBPP/master/masterFlat_Ha.xisf", "a").await;
    let view = library.issues().await.unwrap();
    let offered = find(&view, IssueKind::MasterOffer).clone();
    let project = world.project;
    assert_eq!(
        (offered.owner, offered.page, offered.severity, offered.count, offered.name.as_deref()),
        (
            IssueOwner::Project { id: project },
            IssuePage::Project { id: project },
            IssueSeverity::Info,
            1,
            Some(PROJECT)
        )
    );
    dismiss(library, &offered).await;

    offer("WBPP/master/masterFlat_OIII.xisf", "b").await;
    let view = library.issues().await.unwrap();
    let back = find(&view, IssueKind::MasterOffer);
    assert_eq!(back.count, 2);
    assert!(view.issues.contains(back), "it counts again: {view:#?}");
    assert!(view.dismissed.is_empty(), "{view:#?}");
}
