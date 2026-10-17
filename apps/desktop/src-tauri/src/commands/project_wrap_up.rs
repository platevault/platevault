// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up and Close IPC (spec 065 PRJ-FR-14, PRJ-FR-25, PRJ-FR-30; 071
//! STO-FR-01/04): where Wrap up stands, Close project… and Duplicate….
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `wrap up` block. Close records the Closed snapshot, locks the
//! Project for good and runs the selected archive while the Project reads
//! Closing; it runs unattended, and a stop leaves the Project Closing until
//! `Library::recover_wrap_up` resumes it at the next start. Close moves
//! entries to the [`WrapUpTrash`] the shell manages. There is no Reopen:
//! Duplicate continues a Closed Project. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use platevault_core::apply::Unattended;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::{CloseReport, CloseRequest, DuplicateRequest, Project, WrapUpStatus};
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
