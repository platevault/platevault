// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project Output IPC (RES-FR-01/02/11, RES-AC-02/25): Copy to Output,
//! Rescan, and Hide and Restore on a generated master offer.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `output` block. `Output/` itself is followed by the
//! [`OutputWatch`] the shell manages, and Rescan walks one Project through it
//! now. Copy to Output copies through the storage journal's verified
//! transfer, never replaces anything at the destination and leaves the
//! source unchanged. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::project_output::OutputWatch;
use platevault_core::{NativePath, OutputObservation, ProcessingMasterOffer};
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

/// Rescan, in the Output step's More menu: walk the Project's `Output/` now
/// and return its Output step as recorded, a file saved since included.
///
/// # Errors
/// `InvalidInput` for a Project that is not open or has no processing
/// location, or once the watcher stopped; `NotFound` for an unknown Project;
/// catalog errors.
#[tauri::command]
#[specta::specta]
pub async fn project_output_rescan(
    watch: State<'_, OutputWatch>,
    project_id: Uuid,
) -> Reply<Vec<OutputObservation>> {
    watch.rescan(project_id).await.map_err(fail(Some(project_id)))
}

/// Hide, on a generated calibration master offer in the Output step
/// (RES-FR-11, CAL-FR-06): decline the offer of the bytes with
/// `expected_sha256`, the digest the step showed. The master stays a candidate
/// in Calibration and its source file is untouched.
///
/// # Errors
/// `NotFound` for an unknown offer; `InvalidInput` for a Project that is not
/// open, has no processing location, a digest the offer does not have or an
/// adopted master.
#[tauri::command]
#[specta::specta]
pub async fn project_dismiss_processing_master(
    library: State<'_, Arc<Library>>,
    offer_id: Uuid,
    expected_sha256: String,
) -> Reply<ProcessingMasterOffer> {
    library
        .dismiss_processing_master(offer_id, &expected_sha256)
        .await
        .map_err(fail(Some(offer_id)))
}

/// Restore, on a hidden generated master offer: offer it again while its
/// source in `Processing/` still holds the bytes with `expected_sha256`.
///
/// # Errors
/// `NotFound` for an unknown offer; `InvalidInput` for a Project that is not
/// open, has no processing location, a digest the offer does not have, a source
/// that changed or is gone, an offer that is not hidden or an adopted master;
/// access errors reading the source.
#[tauri::command]
#[specta::specta]
pub async fn project_restore_processing_master(
    library: State<'_, Arc<Library>>,
    offer_id: Uuid,
    expected_sha256: String,
) -> Reply<ProcessingMasterOffer> {
    library
        .restore_processing_master(offer_id, &expected_sha256)
        .await
        .map_err(fail(Some(offer_id)))
}
