// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up and Close IPC (spec 065 PRJ-FR-14, PRJ-FR-15, PRJ-FR-25,
//! PRJ-FR-30; 071 STO-FR-01/04/06/13/14): where Wrap up stands, its Clean
//! up and Trash steps, Archive's review, reopening a step, Close project…,
//! the Closed snapshot and Duplicate….
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `wrap up` block. Each step is reviewed, then confirmed: the
//! confirmation echoes what the review returned (the revisions Clean up
//! read, the digest of the Trash rows or of Archive's layout), and the core
//! refuses it when that moved. Clean up and Trash move entries to the
//! [`WrapUpTrash`] the shell manages and take no stop control: each runs to
//! its end, and a journaled Trash a stop interrupts resumes at the next
//! start. Close records the Closed snapshot, locks the Project for good and
//! runs the selected archive while the Project reads Closing; it runs
//! unattended, and a stop leaves the Project Closing until
//! `Library::recover_wrap_up` resumes it at the next start. A step reopens
//! only while the Project is open; a Closed Project has no Reopen: Duplicate
//! continues it. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use platevault_core::apply::Unattended;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::{
    ArchiveReview, CleanUpReport, CleanUpRequest, CleanUpReview, CloseReport, CloseRequest,
    ClosedSnapshot, DuplicateRequest, Project, TrashReport, TrashRequest, TrashReview,
    WrapUpStatus, WrapUpStep,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The OS Trash Close and wrap-up recovery move entries to: the host's
/// [`platevault_core::custody::trash::SystemTrash`] in the shell, so one
/// adapter keeps its per-folder Trash facts, and a stand-in in tests, which
/// must leave the user's Trash untouched.
#[derive(Clone)]
pub struct WrapUpTrash(Arc<dyn OsTrash>);

impl WrapUpTrash {
    #[must_use]
    pub fn new(trash: Arc<dyn OsTrash>) -> Self {
        Self(trash)
    }

    /// The shared adapter.
    #[must_use]
    pub fn get(&self) -> Arc<dyn OsTrash> {
        Arc::clone(&self.0)
    }
}

/// Where the Project's Wrap up stands: its recorded steps, the current one,
/// and why it doesn't open (pending changes, a running operation or a locked
/// Project). Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_wrap_up_status(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<WrapUpStatus> {
    library.wrap_up_status(project_id).await.map_err(fail(Some(project_id)))
}

/// Close project…, Archive's Proceed: with no session selected the Project
/// closes with no archive. Returns the lifecycle it reached, its Closed
/// snapshot and the archive's progress.
///
/// # Errors
/// `Conflict` when the Project or the archive review moved since the user saw
/// it; `InvalidInput` while Wrap up doesn't open, before Trash is recorded, or
/// for a session that can't move; catalog and journal failures.
#[tauri::command]
#[specta::specta]
pub async fn project_close(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    request: CloseRequest,
) -> Reply<CloseReport> {
    library
        .close_project(&request, trash.get(), &Unattended)
        .await
        .map_err(fail(Some(request.project_id)))
}

/// Duplicate…: a new open Project with what the user kept ticked, its
/// sessions on their current calibration pins, no files and no link to the
/// original.
///
/// # Errors
/// `InvalidInput` for a blank name, a session the source doesn't hold or one
/// the admission rule refuses now, naming its blockers; `Conflict` for a
/// session regrouped since; `NotFound` for an unknown Project.
#[tauri::command]
#[specta::specta]
pub async fn project_duplicate(
    library: State<'_, Arc<Library>>,
    request: DuplicateRequest,
) -> Reply<Project> {
    library.duplicate_project(&request).await.map_err(fail(Some(request.project_id)))
}

/// Reopen `step` from the step strip: it and the later steps are no longer
/// recorded, until the Project is closed. Returns where Wrap up stands then.
///
/// # Errors
/// `InvalidInput` for a Project that is not open or that an operation runs
/// on; `NotFound` for an unknown Project.
#[tauri::command]
#[specta::specta]
pub async fn project_reopen_wrap_up_step(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    step: WrapUpStep,
) -> Reply<WrapUpStatus> {
    library.reopen_wrap_up_step(project_id, step).await.map_err(fail(Some(project_id)))
}

/// What a Closed, Closing or Archived Project reads for good: its basis with
/// the calibration each session used, and its goals frozen at Close. `null`
/// for a Project that never closed. Read-only.
///
/// # Errors
/// `PersistenceFailure` for an unreadable or corrupt record.
#[tauri::command]
#[specta::specta]
pub async fn project_closed_snapshot(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<Option<ClosedSnapshot>> {
    library.closed_snapshot(project_id).await.map_err(fail(Some(project_id)))
}

/// Clean up as it opens (STO-FR-01): every entry still in the installed
/// View, Copies ticked and Symlinks unticked, and every file
/// `View (previous)/` still holds, unticked. Read-only; it hashes nothing.
///
/// # Errors
/// `InvalidInput` for a Project that is not open; `NotFound` for an unknown
/// Project.
#[tauri::command]
#[specta::specta]
pub async fn project_clean_up_review(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<CleanUpReview> {
    library.clean_up_review(project_id).await.map_err(fail(Some(project_id)))
}

/// Clean up the rows the user confirmed (STO-FR-04/05), echoing the
/// review's revisions: a placed link is deleted, a copy or leftover goes to
/// the OS Trash, each once it re-verifies, and anything else stays, named.
/// Records the step: Finished, or Skipped when nothing was selected though
/// something was offered.
///
/// # Errors
/// `Conflict` when the Project or its View moved since the review;
/// `InvalidInput` for a row the review doesn't offer, while Wrap up doesn't
/// open or out of order; `NotFound` for an unknown Project.
#[tauri::command]
#[specta::specta]
pub async fn project_clean_up(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    request: CleanUpRequest,
) -> Reply<CleanUpReport> {
    library.clean_up(&request, trash.get()).await.map_err(fail(Some(request.project_id)))
}

/// The Trash step as it opens (PRJ-FR-15, STO-FR-14): its three rows with
/// what each moves, keeps and refuses, the OS Trash's refusals included, and
/// the digest Trash echoes. It hashes the `Processing/` files; it moves and
/// records nothing.
///
/// # Errors
/// `InvalidInput` for a Project that is not open; `NotFound` for an unknown
/// Project.
#[tauri::command]
#[specta::specta]
pub async fn project_trash_review(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    project_id: Uuid,
) -> Reply<TrashReview> {
    library.trash_review(project_id, trash.get()).await.map_err(fail(Some(project_id)))
}

/// Move the rows the user ticked to the OS Trash (D-W43: an unticked row
/// moves nothing), each copy re-verified first, and record the step:
/// Finished, or Skipped when nothing was ticked though something was
/// offered. Returns what moved and every approved item that stayed.
///
/// # Errors
/// `Conflict` when the review moved since the user saw it; `InvalidInput`
/// while Wrap up doesn't open or before Clean up is recorded; `NotFound` for
/// an unknown Project; journal and catalog failures.
#[tauri::command]
#[specta::specta]
pub async fn project_wrap_up_trash(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    request: TrashRequest,
) -> Reply<TrashReport> {
    library.wrap_up_trash(&request, trash.get()).await.map_err(fail(Some(request.project_id)))
}

/// Archive's review of the Project's sessions for `destination`
/// (STO-FR-06/13): every file's from and to path, the sessions other open
/// Projects keep, and the kept-View links the archive repoints. Close
/// project…'s archive selection echoes its digest. Read-only.
///
/// # Errors
/// `InvalidInput` for a Project that is not open or a retired destination;
/// `NotFound` for an unknown Project or destination.
#[tauri::command]
#[specta::specta]
pub async fn project_wrap_up_archive_review(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    destination: Uuid,
) -> Reply<ArchiveReview> {
    library.wrap_up_archive_review(project_id, destination).await.map_err(fail(Some(project_id)))
}
