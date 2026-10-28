// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Issues on rows (spec 063 FR-032, 064 LIB-FR-17/22, D-W92, D-W144,
//! D-W158) on the composed library over real catalogs and files: each issue
//! on its row and page with its count, the counters over the issues not
//! dismissed, Dismiss and Restore kept across a restart, and a dismissed
//! issue counting again when its count or bytes change or when it ends and
//! returns. A Project's own waiting work can't be dismissed.

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

use std::fs;

use apply_support::{world, World, DARKS};
use home_support::{indexed, quiet};
use overview_support::{register, Duplicates};
use persistence_library::SessionQuery;
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

/// D-W158: a dismissed issue whose count changes counts again, and its old
/// dismissal is forgotten.
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
    assert!(catalog.issue_dismissals().await.unwrap().is_empty(), "the old dismissal is forgotten");
}

/// D-W158: "a location going offline again brings it back". A dismissed
/// offline issue stays hidden while the location stays offline, ends when it
/// is back, and counts again when it goes offline again.
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
    library.dismiss_issue(&issue.fingerprint).await.unwrap();
    let view = library.issues().await.unwrap();
    assert_eq!(kinds(&view.dismissed), [IssueKind::LocationOffline]);
    assert_eq!(view.counts.warning, 2);

    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    assert_eq!(catalog.location(location.id).await.unwrap().availability, Availability::Available);
    let view = library.issues().await.unwrap();
    assert!(!kinds(&view.issues).contains(&IssueKind::LocationOffline));
    assert!(view.dismissed.is_empty(), "the issue ended, so its dismissal is forgotten");

    offline().await;
    let view = library.issues().await.unwrap();
    assert!(view.dismissed.is_empty(), "{view:#?}");
    let again = find(&view, IssueKind::LocationOffline);
    assert_eq!(again.fingerprint, issue.fingerprint);
    assert_eq!(view.counts.warning, 3, "it counts again");
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
/// dismissed one: a stale or unknown fingerprint records nothing.
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
    assert!(library.catalog().issue_dismissals().await.unwrap().is_empty());
    let listed = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(listed.len(), 8, "nothing else changed");
}
