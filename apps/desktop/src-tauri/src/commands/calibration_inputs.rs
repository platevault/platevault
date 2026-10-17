// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs and master adoption IPC (spec 068 as amended by D-W5,
//! D-W37 and D-W55).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `calibration` block; the legacy `commands/calibration.rs` and
//! `commands/calibration_tolerances.rs` stay unregistered there. Matching runs
//! at ingestion and is pinned on the session, so no command here matches or
//! decides calibration. Adoption carries `expectedRevision` (the review's
//! revision) and returns the settled operation only after its transaction
//! commits; no read starts a rehash, and adoption writes only a new file at
//! the reviewed destination. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the input, source or
//! review.

use std::sync::Arc;

use persistence_library::{CalibrationInputDetail, CalibrationInputSummary, InputQuery};
use platevault_core::library::Library;
use platevault_core::{
    AdoptionDestination, AdoptionOperation, AdoptionReview, AdoptionSource, AdoptionState,
    CandidateRef, CustodyFact, InputForm, InputKind, Revision,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Raw sets, adopted masters and detected candidates in group order, with
/// evidence, missing evidence, availability counts and provenance. Retired
/// and Trashed copies are omitted. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn calibration_list_inputs(
    library: State<'_, Arc<Library>>,
    kind: Option<InputKind>,
    form: Option<InputForm>,
    location_id: Option<Uuid>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<CalibrationInputSummary>> {
    let query = InputQuery { kind, form, location_id, offset, limit };
    library.calibration_inputs(&query).await.map_err(fail(location_id))
}

/// One input's evidence, members, excluded members, availability and
/// provenance: a raw set, an adopted master or a candidate `assetId`. Read-only.
///
/// # Errors
/// `NotFound` for an input that is not listed at that revision.
#[tauri::command]
pub async fn calibration_input(
    library: State<'_, Arc<Library>>,
    input: CandidateRef,
) -> Reply<CalibrationInputDetail> {
    library.calibration_input(&input).await.map_err(fail(Some(input.id())))
}

/// A durable adoption review after hashing the source and checking the
/// destination. Writes no file.
///
/// # Errors
/// `IdentityConflict` scoped to an existing destination entry or a changed
/// source; `InvalidInput` for a source that is no listed master candidate or
/// a destination that is no Calibration location; `Conflict` for a stale
/// source; `SourceUnavailable` for an offline location.
#[tauri::command]
pub async fn calibration_review_adoption(
    library: State<'_, Arc<Library>>,
    source: AdoptionSource,
    destination: AdoptionDestination,
) -> Reply<AdoptionReview> {
    let AdoptionSource::Asset { asset_id: identity, .. } = &source;
    library.calibration_review_adoption(&source, &destination).await.map_err(fail(Some(*identity)))
}

/// Confirm a review and return the settled operation: `completed` with its
/// master, or `failed` with the phase and error and no master.
///
/// # Errors
/// `Conflict` for a stale or adopted review; `IdentityConflict` for an
/// occupied destination that is not the recorded installed copy.
#[tauri::command]
pub async fn calibration_adopt(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
    expected_revision: Revision,
) -> Reply<AdoptionOperation> {
    library.calibration_adopt(review_id, expected_revision).await.map_err(fail(Some(review_id)))
}

/// Durable adoption operations, including `interrupted` ones after restart.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn calibration_list_adoptions(
    library: State<'_, Arc<Library>>,
    state: Option<AdoptionState>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<AdoptionOperation>> {
    library.calibration_list_adoptions(state, offset, limit).await.map_err(fail(None))
}

/// Candidate masters, adopted masters and retained adoption sources with
/// their fingerprints (STO seam), library-wide. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn calibration_custody_facts(
    library: State<'_, Arc<Library>>,
) -> Reply<Vec<CustodyFact>> {
    library.calibration_custody_facts().await.map_err(fail(None))
}
