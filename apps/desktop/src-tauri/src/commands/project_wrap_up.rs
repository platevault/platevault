// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up and Close IPC (spec 065 PRJ-FR-14, PRJ-FR-25, PRJ-FR-30; 071
//! STO-FR-01/04/08): where Wrap up stands, Close project…, its Stop, and
//! Duplicate….
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `wrap up` block. Close records the Closed snapshot, locks the
//! Project for good and runs the selected archive while the Project reads
//! Closing. Each Close runs under the shell's [`CloseRuns`]:
//! `project_close_stop` stops it before its archive's next durable step, and
//! a stop, or the app closing, leaves the Project Closing until
//! `Library::recover_wrap_up` resumes it at the next start. Close moves
//! entries to the [`WrapUpTrash`] the shell manages. There is no Reopen:
//! Duplicate continues a Closed Project. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

#[cfg(feature = "e2e")]
use std::path::Path;
use std::sync::Arc;

use platevault_core::custody::trash::OsTrash;
#[cfg(not(feature = "e2e"))]
use platevault_core::custody::trash::SystemTrash;
use platevault_core::library::Library;
use platevault_core::wrap_up::ArchiveControl;
use platevault_core::LibraryError;
#[cfg(feature = "e2e")]
use platevault_core::TrashSupport;
use platevault_core::{CloseReport, CloseRequest, DuplicateRequest, Project, WrapUpStatus};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};
use super::stops::{Entered, Stops};

/// The OS Trash Close and wrap-up recovery move entries to: one adapter for
/// the shell ([`Self::host`]), so it keeps its per-folder Trash facts, and a
/// stand-in in tests, which must leave the user's Trash untouched.
#[derive(Clone)]
pub struct WrapUpTrash(Arc<dyn OsTrash>);

impl WrapUpTrash {
    #[must_use]
    pub fn new(trash: Arc<dyn OsTrash>) -> Self {
        Self(trash)
    }

    /// The host's [`platevault_core::custody::trash::SystemTrash`]; in an
    /// `e2e` build the headless double instead, so an e2e run never touches
    /// the OS Trash.
    #[must_use]
    pub fn host() -> Self {
        #[cfg(not(feature = "e2e"))]
        let trash = SystemTrash::default();
        #[cfg(feature = "e2e")]
        let trash = HeadlessTrash;
        Self::new(Arc::new(trash))
    }

    /// The shared adapter.
    #[must_use]
    pub fn get(&self) -> Arc<dyn OsTrash> {
        Arc::clone(&self.0)
    }
}

/// The e2e build's headless OS Trash double (spec 037), as the executor's
/// `fs_executor::ops::trash_op::fake` is for plans: a headless runner has no
/// usable OS Trash, so it removes the entry itself, never a link's target,
/// and takes every entry without asking the OS. Only the `e2e` feature
/// compiles it, so a release binary always moves entries to the OS Trash.
#[cfg(feature = "e2e")]
struct HeadlessTrash;

#[cfg(feature = "e2e")]
impl OsTrash for HeadlessTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        TrashSupport::Supported
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        std::fs::remove_file(entry)
            .map_err(|error| format!("the e2e Trash double kept {}: {error}", entry.display()))
    }
}

/// The Closes this shell runs, by Project.
#[derive(Default)]
pub struct CloseRuns(Stops);

/// One Close; a stop interrupts its archive before the next durable step.
struct Attended<'a>(Entered<'a>);

impl ArchiveControl for Attended<'_> {
    fn interrupted(&self) -> bool {
        self.0.stopped()
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
/// snapshot and the archive's progress: Closing, unsettled, after a stop.
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
    runs: State<'_, CloseRuns>,
    request: CloseRequest,
) -> Reply<CloseReport> {
    let control = Attended(runs.0.enter(request.project_id));
    library
        .close_project(&request, trash.get(), &control)
        .await
        .map_err(fail(Some(request.project_id)))
}

/// Stop the running Close of `project_id` before its archive's next durable
/// step (STO-FR-08). The Project stays Closing and locked, `project_close`
/// reports the archive's progress, and the next start resumes it from what
/// it recorded.
///
/// # Errors
/// `NotFound` when no Close of that Project runs in this shell.
#[tauri::command]
#[specta::specta]
pub async fn project_close_stop(runs: State<'_, CloseRuns>, project_id: Uuid) -> Reply<()> {
    if runs.0.stop(project_id) {
        Ok(())
    } else {
        Err(fail(Some(project_id))(LibraryError::NotFound(format!(
            "no Close of Project {project_id} is running"
        ))))
    }
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
