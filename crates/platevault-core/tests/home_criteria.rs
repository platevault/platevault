// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's stored planning criteria over the library facade (spec 072
//! PLAN-FR-11/12, spec 065 PRJ-FR-17): none at revision 0 until saved,
//! because no spec gives every criterion a default; a save checks its
//! revision, refuses invalid criteria and survives reopening the catalog;
//! and its revision is its own, apart from the planning settings'.

use std::path::Path;
use std::sync::Arc;

use persistence_library::HOME_CRITERIA_ID;
use platevault_core::library::Library;
use platevault_core::*;

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    }
}

/// A new catalog stores no Home criteria: Home asks the user to set them.
#[tokio::test]
async fn unsaved_criteria_read_none_at_revision_zero() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    assert_eq!(
        library.home_criteria().await.unwrap(),
        HomeCriteria { criteria: None, revision: 0 }
    );
}

/// A save over the current revision stores the criteria at the next revision,
/// they read back after reopening, and a stale revision is a Conflict naming
/// Home's criteria that changes nothing.
#[tokio::test]
async fn save_checks_revision_and_persists() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    let library = open(&database).await;
    let first = library.save_home_criteria(0, &criteria()).await.unwrap();
    assert_eq!(first, HomeCriteria { criteria: Some(criteria()), revision: 1 });

    let nautical = PlanCriteria { darkness: Darkness::Nautical, ..criteria() };
    let stale = library.save_home_criteria(0, &nautical).await.unwrap_err();
    assert!(
        matches!(stale, LibraryError::Conflict { id, current: 1, .. } if id == HOME_CRITERIA_ID),
        "{stale:?}"
    );
    assert_eq!(library.home_criteria().await.unwrap(), first);

    let second = library.save_home_criteria(1, &nautical).await.unwrap();
    assert_eq!(second, HomeCriteria { criteria: Some(nautical), revision: 2 });
    drop(library);
    assert_eq!(open(&database).await.home_criteria().await.unwrap(), second);
}

/// Invalid criteria are refused naming the field, and nothing is stored.
#[tokio::test]
async fn invalid_criteria_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let invalid = PlanCriteria { min_duration_minutes: 0, ..criteria() };
    let error = library.save_home_criteria(0, &invalid).await.unwrap_err();
    assert!(
        matches!(&error, LibraryError::InvalidInput(message) if message.contains("minDurationMinutes")),
        "{error:?}"
    );
    assert_eq!(library.home_criteria().await.unwrap().revision, 0);
}

/// Home's criteria and the planning settings keep separate revisions: saving
/// the criteria leaves the settings revision a reminder review confirmed.
#[tokio::test]
async fn criteria_revision_is_apart_from_planning_settings() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let before = library.catalog().list_sites().await.unwrap().settings_revision;
    library.save_home_criteria(0, &criteria()).await.unwrap();
    assert_eq!(library.catalog().list_sites().await.unwrap().settings_revision, before);
}
