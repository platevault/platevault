// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up and Close IPC (spec 065 PRJ-FR-14, PRJ-FR-25, PRJ-FR-30; 071
//! STO-FR-01/04): where Wrap up stands, reopening a step, Close project…, the
//! Closed snapshot and Duplicate….
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `wrap up` block. Close records the Closed snapshot, locks the
//! Project for good and runs the selected archive while the Project reads
//! Closing; it runs unattended, and a stop leaves the Project Closing until
//! `Library::recover_wrap_up` resumes it at the next start. Close moves
//! entries to the [`WrapUpTrash`] the shell manages. A step reopens only while
//! the Project is open; a Closed Project has no Reopen: Duplicate continues it.
//! Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions, naming the Project.

use std::sync::Arc;

use platevault_core::apply::Unattended;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::{
    CloseReport, CloseRequest, ClosedSnapshot, DuplicateRequest, Project, WrapUpStatus, WrapUpStep,
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
