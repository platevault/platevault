// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply IPC (spec 066 VSEL-FR-14, 069 PREP-FR-04/06/09/18): the Apply sheet,
//! the Apply that rebuilds the View from the originals, and its Cancel.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `apply` block. The sheet reads originals' fingerprints and writes
//! nothing. Each Apply runs under the shell's [`ApplyRuns`]: by its operation
//! id `project_apply_cancel` cancels it, and while it waits for a tool to
//! release a file in View the shell emits [`APPLY_WAITING_EVENT`]. A stop of
//! the app while an Apply runs is settled by the next start (`Library::open`
//! reconciles every unsettled Apply). Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project or the
//! operation.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use platevault_core::apply::ApplyControl;
use platevault_core::library::Library;
use platevault_core::{ApplyPreview, ApplyReport, ApplyRequest, LibraryError, NativePath};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use super::library::{fail, Reply};
use super::stops::{Entered, Stops};

/// Tauri event carrying an [`ApplyWaiting`] payload when a running Apply
/// starts waiting for a tool to release a file in View, and again when it no
/// longer waits (PREP-FR-18).
pub const APPLY_WAITING_EVENT: &str = "project_apply_waiting";

/// The `project_apply_waiting` event: Apply `operationId` of `projectId`
/// waits for a tool that holds a file in `held`, its `View/` folder, or with
/// `held` null no longer waits. It continues by itself once the file is
/// released; `project_apply_cancel` keeps the old View.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct ApplyWaiting {
    pub operation_id: Uuid,
    pub project_id: Uuid,
    pub held: Option<NativePath>,
}

/// The Applies this shell runs, by operation id, and where their waiting
/// events go.
pub struct ApplyRuns {
    stops: Stops,
    notify: Box<dyn Fn(&ApplyWaiting) + Send + Sync>,
}

impl ApplyRuns {
    /// Runs whose waiting events `app` emits as [`APPLY_WAITING_EVENT`]; an
    /// event it can't deliver is logged, and the Apply goes on.
    #[must_use]
    pub fn emitting<R: Runtime>(app: AppHandle<R>) -> Self {
        Self {
            stops: Stops::default(),
            notify: Box::new(move |waiting| {
                if let Err(error) = app.emit(APPLY_WAITING_EVENT, waiting) {
                    tracing::error!(
                        operation = %waiting.operation_id,
                        %error,
                        "apply waiting event not delivered"
                    );
                }
            }),
        }
    }
}

/// One Apply of `project_id`, cancelable by its operation id once Apply
/// reserved the Project.
struct Attended<'a> {
    runs: &'a ApplyRuns,
    project_id: Uuid,
    run: OnceLock<(Uuid, Entered<'a>)>,
}

impl ApplyControl for Attended<'_> {
    fn reserved(&self, operation_id: Uuid) {
        self.run.get_or_init(|| (operation_id, self.runs.stops.enter(operation_id)));
    }

    fn canceled(&self) -> bool {
        self.run.get().is_some_and(|(_, run)| run.stopped())
    }

    fn waiting(&self, held: Option<&Path>) {
        if let Some((operation_id, _)) = self.run.get() {
            (self.runs.notify)(&ApplyWaiting {
                operation_id: *operation_id,
                project_id: self.project_id,
                held: held.map(NativePath::from_path),
            });
        }
    }
}

/// The Apply sheet: the new View as a folder tree, every reason Apply can't
/// run, the files `PlateVault` didn't place, the copies a tool changed and
/// what `View (previous)/` holds. Writes nothing.
///
/// # Errors
/// `NotFound` for an unknown Project; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_apply_preview(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ApplyPreview> {
    library.apply_preview(project_id).await.map_err(fail(Some(project_id)))
}

/// Apply the reviewed sheet: the request echoes the sheet's Project revision
/// and basis digest, and names the foreign files that move into the new View.
/// A build that fails or is canceled reports that outcome in the report.
///
/// # Errors
/// `Conflict` when the Project or the Library moved since the sheet;
/// `SymlinksUnavailable` when a Symlinks View can't be made here;
/// `InvalidInput` naming every other blocker; `IdentityConflict` when both the
/// install and restoring the old View failed; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_apply(
    library: State<'_, Arc<Library>>,
    runs: State<'_, ApplyRuns>,
    request: ApplyRequest,
) -> Reply<ApplyReport> {
    let control =
        Attended { runs: runs.inner(), project_id: request.project_id, run: OnceLock::new() };
    library.apply(&request, &control).await.map_err(fail(Some(request.project_id)))
}

/// Cancel the running Apply `operation_id`: it stops where it is safe and
/// keeps the old View, or, once the new View is being installed, finishes.
/// `project_apply` reports how it ended.
///
/// # Errors
/// `NotFound` when no Apply with that operation runs in this shell.
#[tauri::command]
#[specta::specta]
pub async fn project_apply_cancel(runs: State<'_, ApplyRuns>, operation_id: Uuid) -> Reply<()> {
    if runs.stops.stop(operation_id) {
        Ok(())
    } else {
        Err(fail(Some(operation_id))(LibraryError::NotFound(format!(
            "no Apply {operation_id} is running"
        ))))
    }
}
