// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The default reminder lead time over the library facade (spec 072
//! PLAN-FR-06): 12 hours at revision 0 until the user changes it; a save
//! checks its revision, takes a lead time longer than 30 minutes and at most
//! 7 days, as every reminder's, and survives reopening the catalog; and its
//! revision is its own, apart from the planning settings' and Home's criteria.

use std::path::Path;
use std::sync::Arc;

use persistence_library::REMINDER_LEAD_TIME_ID;
use platevault_core::library::Library;
use platevault_core::*;

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

/// A new catalog reads the spec's default of 12 hours at revision 0.
#[tokio::test]
async fn unsaved_lead_time_reads_twelve_hours_at_revision_zero() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    assert_eq!(
        library.reminder_lead_time().await.unwrap(),
        ReminderLeadTime { lead_minutes: 12 * 60, revision: 0 }
    );
}

/// A save over the current revision stores the lead time at the next
/// revision, it reads back after reopening, and a stale revision is a
/// Conflict naming the lead time that changes nothing.
#[tokio::test]
async fn save_checks_revision_and_persists() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    let library = open(&database).await;
    let first = library.save_reminder_lead_time(0, 90).await.unwrap();
    assert_eq!(first, ReminderLeadTime { lead_minutes: 90, revision: 1 });

    let stale = library.save_reminder_lead_time(0, 120).await.unwrap_err();
    assert!(
        matches!(stale, LibraryError::Conflict { id, current: 1, .. } if id == REMINDER_LEAD_TIME_ID),
        "{stale:?}"
    );
    assert_eq!(library.reminder_lead_time().await.unwrap(), first);

    let second = library.save_reminder_lead_time(1, 24 * 60).await.unwrap();
    assert_eq!(second, ReminderLeadTime { lead_minutes: 24 * 60, revision: 2 });
    drop(library);
    assert_eq!(open(&database).await.reminder_lead_time().await.unwrap(), second);
}

/// Every lead time is longer than 30 minutes and at most 7 days; others are
/// refused naming the field, and nothing is stored.
#[tokio::test]
async fn lead_times_run_from_over_thirty_minutes_to_seven_days() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    for minutes in [0, 30, 10_081] {
        let error = library.save_reminder_lead_time(0, minutes).await.unwrap_err();
        assert!(
            matches!(&error, LibraryError::InvalidField { field, .. } if field.as_str() == "leadMinutes"),
            "{minutes}: {error:?}"
        );
    }
    assert_eq!(library.reminder_lead_time().await.unwrap().revision, 0);
    assert_eq!(library.save_reminder_lead_time(0, 31).await.unwrap().lead_minutes, 31);
    assert_eq!(library.save_reminder_lead_time(1, 10_080).await.unwrap().lead_minutes, 10_080);
}

/// The lead time keeps its own revision: saving it leaves the settings
/// revision a reminder review confirmed and Home's criteria revision.
#[tokio::test]
async fn lead_time_revision_is_apart_from_planning_settings_and_home_criteria() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let settings = library.catalog().list_sites().await.unwrap().settings_revision;
    let criteria = library.home_criteria().await.unwrap().revision;
    library.save_reminder_lead_time(0, 60).await.unwrap();
    assert_eq!(library.catalog().list_sites().await.unwrap().settings_revision, settings);
    assert_eq!(library.home_criteria().await.unwrap().revision, criteria);
}
