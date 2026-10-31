// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply IPC (spec 066 VSEL-FR-14, 069 PREP-FR-04/06/09/15/18): the Apply
//! sheet, the Apply that rebuilds the View from the originals, its status and
//! Cancel, and the symlink check setup, Settings and the sheet share.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `apply` block. The sheet reads originals' fingerprints and writes
//! nothing. `project_apply` returns as soon as the Apply reserved the Project,
//! Running with its operation id, and the build runs on in the background, as
//! a scan does; `project_apply_status` reads its durable state (where its
//! journal stands, which folder a tool holds and since when, the report it
//! settled with) and `project_apply_cancel` asks it to stop by that id. While
//! it waits for a tool to release a file in View the shell also emits
//! [`APPLY_WAITING_EVENT`], a notification to read the status again. A stop of
//! the app while an Apply runs is settled by the next start (`Library::open`
//! reconciles every unsettled Apply). Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project or the
//! operation.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use platevault_core::apply::ApplyControl;
use platevault_core::library::Library;
use platevault_core::{ApplyPreview, ApplyRequest, ApplyStatus, NativePath, SymlinkCapability};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use super::library::{fail, Reply};

/// Tauri event carrying an [`ApplyWaiting`] payload when a running Apply
/// starts waiting for a tool to release a file in View, and again when it no
/// longer waits (PREP-FR-18).
pub const APPLY_WAITING_EVENT: &str = "project_apply_waiting";

/// The `project_apply_waiting` event: Apply `operationId` of `projectId`
/// waits for a tool that holds a file in `held`, its `View/` folder, or with
/// `held` null no longer waits. It continues by itself once the file is
/// released; `project_apply_cancel` keeps the old View. `project_apply_status`
/// reads the same wait durably, with when it began.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct ApplyWaiting {
    pub operation_id: Uuid,
    pub project_id: Uuid,
    pub held: Option<NativePath>,
}

type Notify = Arc<dyn Fn(&ApplyWaiting) + Send + Sync>;

/// Where the shell's Applies send their waiting events.
pub struct ApplyEvents(Notify);

impl ApplyEvents {
    /// Waiting events `app` emits as [`APPLY_WAITING_EVENT`]; an event it
    /// can't deliver is logged, and the Apply goes on.
    #[must_use]
    pub fn emitting<R: Runtime>(app: AppHandle<R>) -> Self {
        Self(Arc::new(move |waiting| {
            if let Err(error) = app.emit(APPLY_WAITING_EVENT, waiting) {
                tracing::error!(
                    operation = %waiting.operation_id,
                    %error,
                    "apply waiting event not delivered"
                );
            }
        }))
    }
}

/// One Apply of `project_id`, whose waits become events once it reserved
/// the Project. Cancel goes through `Library::cancel_apply`.
struct Attended {
    notify: Notify,
    project_id: Uuid,
    operation_id: OnceLock<Uuid>,
}

impl ApplyControl for Attended {
    fn reserved(&self, operation_id: Uuid) {
        let _ = self.operation_id.set(operation_id);
    }

    fn waiting(&self, held: Option<&Path>) {
        if let Some(operation_id) = self.operation_id.get() {
            (self.notify)(&ApplyWaiting {
                operation_id: *operation_id,
                project_id: self.project_id,
                held: held.map(NativePath::from_path),
            });
        }
    }
}

/// Whether `folder` can hold the symlinks of a Symlinks View (PREP-FR-15):
/// on Windows whether Developer Mode is on, elsewhere whether its
/// filesystem holds links. Setup and Settings check the processing location
/// they choose; the Apply sheet checks it too. Leaves nothing in `folder`.
///
/// # Errors
/// `NotFound`, `AccessDenied` or `SourceUnavailable`, scoped to `folder`,
/// when it can't hold a file at all.
#[tauri::command]
#[specta::specta]
pub async fn library_check_symlinks(
    library: State<'_, Arc<Library>>,
    folder: NativePath,
) -> Reply<SymlinkCapability> {
    library.check_symlinks(folder).await.map_err(fail(None))
}

/// The Apply sheet: the new View as a folder tree, every reason Apply can't
/// run, the files `PlateVault` didn't place, the copies a tool changed and
/// what `View (previous)/` holds, with the new View's footprint. Writes
/// nothing but the hidden probes it removes.
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

/// Start the reviewed sheet's Apply: the request echoes the sheet's Project
/// revision and basis digest, and names the foreign files that move into the
/// new View. Returns as soon as it reserved the Project, Running with its
/// operation id; `project_apply_status` reads how it goes on and ends, a
/// build that fails or is canceled settling with that outcome.
///
/// # Errors
/// `Conflict` when the Project or the Library moved since the sheet;
/// `InputWriteRisk` when the Project's profile isn't evidenced read-only,
/// `SymlinksUnavailable` when Windows Developer Mode is off and
/// `LinksUnsupported` when the processing location holds no links, for a
/// Symlinks View;
/// `InvalidInput` naming every other blocker; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_apply(
    library: State<'_, Arc<Library>>,
    events: State<'_, ApplyEvents>,
    request: ApplyRequest,
) -> Reply<ApplyStatus> {
    let control = Arc::new(Attended {
        notify: Arc::clone(&events.0),
        project_id: request.project_id,
        operation_id: OnceLock::new(),
    });
    library.inner().start_apply(&request, control).await.map_err(fail(Some(request.project_id)))
}

/// The durable state of Apply `operation_id`: Running in this shell, with
/// where its journal stands, which folder a tool holds and since when, and
/// whether Cancel asked it to stop; Stopped when nothing runs it (the next
/// start settles it); Settled with its report.
///
/// # Errors
/// `NotFound` for an unknown Apply; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_apply_status(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<ApplyStatus> {
    library.apply_status(operation_id).await.map_err(fail(Some(operation_id)))
}

/// Ask the running Apply `operation_id` to stop where it is safe: it keeps
/// the old View, or, once the new View is being installed, finishes. Returns
/// its status, never an outcome of its own: Running with Cancel requested
/// until it stopped, then Settled with the report that says how it ended.
///
/// # Errors
/// `NotFound` for an unknown Apply; catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_apply_cancel(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<ApplyStatus> {
    library.cancel_apply(operation_id).await.map_err(fail(Some(operation_id)))
}
