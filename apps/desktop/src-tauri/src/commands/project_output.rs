// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project Output IPC (RES-FR-02, RES-AC-02/25): Copy to Output.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `output` block. `Output/` itself is followed by the shell's
//! [`platevault_core::project_output::OutputWatch`]. Copy to Output
//! copies through the storage journal's verified transfer, never replaces
//! anything at the destination and leaves the source unchanged. Failures
//! follow the library [`platevault_core::ErrorResponse`] conventions, naming
//! the Project.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{NativePath, OutputObservation};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Copy to Output…: copy the regular file at `source` into the Project's
/// `Output/` as `name`, a path relative to it, and return it listed as Copied
/// with its digest.
///
/// # Errors
/// `InvalidInput` for a Project that is not open, has no processing location
/// or runs another operation; for a name that is absolute, empty, leaves
/// `Output/` or is already there; for a source in `Output/` or one that is not
/// a regular file; and naming why a started copy did not verify. Access,
/// identity and catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_copy_to_output(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    source: NativePath,
    name: NativePath,
) -> Reply<OutputObservation> {
    library.copy_to_output(project_id, &source, &name).await.map_err(fail(Some(project_id)))
}
