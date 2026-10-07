// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation IPC (spec 069 PREP-FR-01..11/14): profiles,
//! review, Prepare, Retry, stop, the outcome view and Open.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `preparation` block. Review only reads. Prepare and Retry run
//! until the revision ends; while they run, `prepare_outcome` reads progress
//! and `prepare_stop` asks them to cancel or pause before the next entry.
//! Open re-verifies every entry before it launches and never marks the run
//! Complete. Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions, naming the run, revision or profile.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use platevault_core::library::Library;
use platevault_core::prepare::PrepareControl;
use platevault_core::{
    OpenOutcome, PreparationFailed, PreparationOutcome, PreparationReview, PreparationRevision,
    PrepareRequest, PrepareStep, PreparedEntry, Profile, ProfileInput, Revision,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Stop requests per run, read before each entry of its Running revision.
static STOPS: LazyLock<Mutex<HashMap<Uuid, PrepareStep>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The stop requests; a panicked holder left only plain data behind.
fn stops() -> MutexGuard<'static, HashMap<Uuid, PrepareStep>> {
    STOPS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The control of one run's Prepare or Retry: it stops where `prepare_stop`
/// asked, and progress is read from the catalog.
struct Stoppable {
    view_id: Uuid,
}

impl Stoppable {
    fn new(view_id: Uuid) -> Self {
        stops().remove(&view_id);
        Self { view_id }
    }
}

impl Drop for Stoppable {
    fn drop(&mut self) {
        stops().remove(&self.view_id);
    }
}

impl PrepareControl for Stoppable {
    fn step(&self) -> PrepareStep {
        stops().get(&self.view_id).copied().unwrap_or_default()
    }

    fn settled(&self, _entry: &PreparedEntry) {}
}

/// Every handoff profile by name.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn prepare_profiles(library: State<'_, Arc<Library>>) -> Reply<Vec<Profile>> {
    library.catalog().profiles().await.map_err(fail(None))
}

/// Record a profile with its executable, launch arguments and capability
/// evidence (D04).
///
/// # Errors
/// `InvalidInput` for a blank name, an unknown placeholder or a claim
/// without its evidence.
#[tauri::command]
pub async fn prepare_profile_create(
    library: State<'_, Arc<Library>>,
    input: ProfileInput,
) -> Reply<Profile> {
    library.catalog().create_profile(&input).await.map_err(fail(None))
}

/// Replace a profile at `expected_revision`.
///
/// # Errors
/// As `prepare_profile_create`; `Conflict` for a stale revision.
#[tauri::command]
pub async fn prepare_profile_update(
    library: State<'_, Arc<Library>>,
    profile_id: Uuid,
    expected_revision: Revision,
    input: ProfileInput,
) -> Reply<Profile> {
    library
        .catalog()
        .update_profile(profile_id, expected_revision, &input)
        .await
        .map_err(fail(Some(profile_id)))
}

/// Review preparation of a run. Read-only.
///
/// # Errors
/// `InvalidInput` for a run in the Trash, a panel run or an unsaved run;
/// `NotFound` for an unknown run or profile.
#[tauri::command]
pub async fn prepare_review(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    request: PrepareRequest,
) -> Reply<PreparationReview> {
    library.review_preparation(view_id, &request).await.map_err(fail(Some(view_id)))
}

/// Prepare the run's committed membership at `membership_revision`.
///
/// # Errors
/// `Conflict` when the membership moved on; `InvalidInput` naming every
/// refusal of the review.
#[tauri::command]
pub async fn prepare_run(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    request: PrepareRequest,
    membership_revision: Revision,
) -> Reply<PreparationOutcome> {
    let control = Stoppable::new(view_id);
    library
        .prepare_run(view_id, &request, membership_revision, &control)
        .await
        .map_err(fail(Some(view_id)))
}

/// Retry a Partial or Paused revision in its own folder.
///
/// # Errors
/// `InvalidInput` for another state, or a run whose membership moved on.
#[tauri::command]
pub async fn prepare_retry(
    library: State<'_, Arc<Library>>,
    preparation_id: Uuid,
) -> Reply<PreparationOutcome> {
    let outcome = library.preparation_outcome(preparation_id).await;
    let view_id = outcome.map_err(fail(Some(preparation_id)))?.revision.view_id;
    let control = Stoppable::new(view_id);
    library.retry_preparation(preparation_id, &control).await.map_err(fail(Some(preparation_id)))
}

/// Ask the run's Running revision to cancel or pause before its next entry.
#[tauri::command]
pub fn prepare_stop(view_id: Uuid, step: PrepareStep) {
    stops().insert(view_id, step);
}

/// Every preparation revision of a run, by number.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn prepare_list(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<Vec<PreparationRevision>> {
    library.catalog().view_preparations(view_id).await.map_err(fail(Some(view_id)))
}

/// The outcome view of a revision: prepared, blocked, pending and drifted
/// entries and its offers; a Running one reads as progress.
///
/// # Errors
/// `NotFound` for an unknown revision.
#[tauri::command]
pub async fn prepare_outcome(
    library: State<'_, Arc<Library>>,
    preparation_id: Uuid,
) -> Reply<PreparationOutcome> {
    library.preparation_outcome(preparation_id).await.map_err(fail(Some(preparation_id)))
}

/// The run blocker preparation feeds Home.
///
/// # Errors
/// Catalog errors.
#[tauri::command]
pub async fn prepare_blocker(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<Option<PreparationFailed>> {
    library.preparation_blocker(view_id).await.map_err(fail(Some(view_id)))
}

/// Open a Prepared revision in its profile's application after re-verifying
/// every entry.
///
/// # Errors
/// `InvalidInput` for a revision that is not Prepared or a run in the Trash.
#[tauri::command]
pub async fn prepare_open(
    library: State<'_, Arc<Library>>,
    preparation_id: Uuid,
) -> Reply<OpenOutcome> {
    library.open_preparation(preparation_id).await.map_err(fail(Some(preparation_id)))
}
