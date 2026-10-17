// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply IPC (spec 066 VSEL-FR-14, 069 PREP-FR-04/06/09): the Apply sheet and
//! the Apply that rebuilds the View from the originals.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `apply` block. The sheet reads originals' fingerprints and writes
//! nothing. Apply runs unattended: it is never canceled, and a stop while it
//! runs is settled by the next start (`Library::open` reconciles every
//! unsettled Apply). Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use platevault_core::apply::Unattended;
use platevault_core::library::Library;
use platevault_core::{ApplyPreview, ApplyReport, ApplyRequest};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

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
/// A build that fails reports that outcome in the report.
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
    request: ApplyRequest,
) -> Reply<ApplyReport> {
    library.apply(&request, &Unattended).await.map_err(fail(Some(request.project_id)))
}
