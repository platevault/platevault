// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody IPC (spec 071).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `storage` block. Each feature keeps its own labelled region
//! below. Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions.

use std::sync::Arc;

use platevault_core::custody::trash::{OsTrash, SystemTrash};
use platevault_core::library::Library;
use platevault_core::storage::StorageOverview;
use platevault_core::{CleanupOutcome, CleanupRequest, CleanupReview};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

// ---------------------------------------------------------------------------
// Storage overview (STO-FR-11, STO-FR-12, STO-AC-12)
// ---------------------------------------------------------------------------

/// Storage: location availability, run footprints, live content-identity
/// duplicate candidates and archive transfers, each in its own section. Reads
/// only: showing a candidate records no operation and authorizes no removal,
/// and an app-written entry changed outside `PlateVault` reads blocked.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn storage_overview(library: State<'_, Arc<Library>>) -> Reply<StorageOverview> {
    library.storage_overview().await.map_err(fail(None))
}

// ---------------------------------------------------------------------------
// Clean up and Empty Trash (STO-FR-01..05/10/17, PREP-FR-14, RES-FR-10)
// ---------------------------------------------------------------------------

/// The host OS Trash: the only way an item leaves its path. There is no
/// permanent-delete fallback.
fn os_trash() -> Arc<dyn OsTrash> {
    Arc::new(SystemTrash::default())
}

/// Review run Clean up, or Empty Trash for a run in its Project's Trash, and
/// record what Confirm executes: each moving entry with its identity, SHA-256
/// and the retained original it relies on, and every item that stays in
/// place with its reason. Clean up lists only prepared entries, grouped and
/// preselected; the Results folder joins Empty Trash only when ticked.
/// Nothing moves.
///
/// # Errors
/// `NotFound` for an unknown run; `InvalidInput` while a preparation or
/// another removal of the run is running, for Clean up of a trashed run, for
/// Empty Trash of a run outside its Project's Trash or of one whose accepted
/// Result another run uses.
#[tauri::command]
pub async fn cleanup_review(
    library: State<'_, Arc<Library>>,
    request: CleanupRequest,
) -> Reply<CleanupReview> {
    let view_id = request.view_id();
    library.review_cleanup(&request, os_trash()).await.map_err(fail(Some(view_id)))
}

/// Execute, or resume after an interruption, a recorded Clean up: each
/// entry goes to the OS Trash only after it and its retained original
/// re-verify; the outcome names what moved and every item left in place.
///
/// # Errors
/// `NotFound` for an unknown review; `InvalidInput` for an Empty Trash
/// review, one already executing, or a run moved to its Project's Trash
/// since the review.
#[tauri::command]
pub async fn cleanup_execute(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
) -> Reply<CleanupOutcome> {
    library.run_cleanup(review_id, os_trash()).await.map_err(fail(Some(review_id)))
}

/// Execute, or resume after an interruption, a recorded Empty Trash: the
/// prepared folders and, only when ticked, the Results folder go to the OS
/// Trash entry by entry after re-verification, then the run record is
/// removed. Items that cannot go stay in place and are named; library
/// frames and quality decisions never change.
///
/// # Errors
/// `NotFound` for an unknown review; `InvalidInput` for a Clean up review,
/// one already executing, a run restored since the review, or a run whose
/// accepted Result became another run's input.
#[tauri::command]
pub async fn empty_trash_execute(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
) -> Reply<CleanupOutcome> {
    library.empty_trash(review_id, os_trash()).await.map_err(fail(Some(review_id)))
}
