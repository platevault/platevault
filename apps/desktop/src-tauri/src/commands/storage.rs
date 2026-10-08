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
use platevault_core::{
    ArchiveTransfer, DuplicatesApproval, IntermediatesApproval, RejectedFramesApproval,
    SessionArchiveState, TrashMoveSummary,
};
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
// Done / Archive (STO-FR-06/07/08/13/14/15/16, PRJ-AC-17/27, LIB-AC-19)
// ---------------------------------------------------------------------------

fn host_trash() -> Arc<dyn OsTrash> {
    Arc::new(SystemTrash::default())
}

/// Review Archive of a Done Project's member sessions to a registered
/// location: templated destination paths, source identities, the prepared
/// entries each frame's references update, the destination volume, free
/// space and writability, and the sessions kept for open Projects. Records
/// the review; moves nothing.
///
/// # Errors
/// `InvalidInput` for a Project that is not Done, a retired destination or
/// nothing to archive; `NotFound` for an unknown Project or location.
#[tauri::command]
pub async fn archive_review(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    location_id: Uuid,
) -> Reply<ArchiveTransfer> {
    library.archive_review(project_id, location_id).await.map_err(fail(Some(project_id)))
}

/// Review the restore of archived sessions to the paths their frames left.
/// Records the review; moves nothing.
///
/// # Errors
/// `InvalidInput` for a session with no archived frame, or sessions that
/// different Projects archived.
#[tauri::command]
pub async fn archive_restore_review(
    library: State<'_, Arc<Library>>,
    session_ids: Vec<Uuid>,
) -> Reply<ArchiveTransfer> {
    library.archive_restore_review(&session_ids).await.map_err(fail(None))
}

/// Approve and execute a reviewed Archive or restore on the host OS Trash, or
/// resume one an interruption left running. Every source is retired only
/// after its destination and references re-verify; nothing is permanently
/// deleted.
///
/// # Errors
/// `InvalidInput` while another custody step of the Project runs or once the
/// Project of an Archive is no longer Done; `IdentityConflict` when the
/// destination volume changed since review.
#[tauri::command]
pub async fn archive_execute(
    library: State<'_, Arc<Library>>,
    transfer_id: Uuid,
) -> Reply<ArchiveTransfer> {
    library.archive_execute(transfer_id, host_trash()).await.map_err(fail(Some(transfer_id)))
}

/// A transfer's recorded phases: destination-verified, reference-updated,
/// source-retained, pending and uncertain work.
///
/// # Errors
/// `NotFound` for an unknown transfer.
#[tauri::command]
pub async fn archive_status(
    library: State<'_, Arc<Library>>,
    transfer_id: Uuid,
) -> Reply<ArchiveTransfer> {
    library.archive_transfer(transfer_id).await.map_err(fail(Some(transfer_id)))
}

/// Whether each session shows as Archived, with its frames at their archive
/// paths; Reopen changes nothing here until a reviewed restore.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn session_archive_state(
    library: State<'_, Arc<Library>>,
    session_ids: Vec<Uuid>,
) -> Reply<Vec<SessionArchiveState>> {
    library.session_archive_state(&session_ids).await.map_err(fail(None))
}

/// Execute the approved "Move N rejected frames to Trash (size)": every copy
/// of a frame or none, to the host OS Trash only; moved frames read Trashed.
///
/// # Errors
/// `InvalidInput` while an Archive transfer or another move of the Project
/// runs; `Conflict` when the Project changed since the approved sheet.
#[tauri::command]
pub async fn trash_rejected_execute(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    approval: RejectedFramesApproval,
) -> Reply<TrashMoveSummary> {
    library
        .trash_rejected_execute(project_id, &approval, host_trash())
        .await
        .map_err(fail(Some(project_id)))
}

/// Execute the approved "Move N processing intermediates to Trash (size)".
///
/// # Errors
/// As [`trash_rejected_execute`].
#[tauri::command]
pub async fn trash_intermediates_execute(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    approval: IntermediatesApproval,
) -> Reply<TrashMoveSummary> {
    library
        .trash_intermediates_execute(project_id, &approval, host_trash())
        .await
        .map_err(fail(Some(project_id)))
}

/// Execute the approved "Move N duplicate copies to Trash (size)".
///
/// # Errors
/// As [`trash_rejected_execute`].
#[tauri::command]
pub async fn trash_duplicates_execute(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    approval: DuplicatesApproval,
) -> Reply<TrashMoveSummary> {
    library
        .trash_duplicates_execute(project_id, &approval, host_trash())
        .await
        .map_err(fail(Some(project_id)))
}
