// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs IPC (spec 068 `contracts/calibration.md`, version 1).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]) beside
//! the library, Project and View commands; the legacy `commands/calibration.rs`
//! and `commands/calibration_tolerances.rs` stay unregistered there. Every
//! mutation carries `expectedRevision` and returns the committed record only
//! after its transaction commits; no read starts a rehash. Accept and exception
//! hash their input files read-only, and adoption writes only a new file at the
//! reviewed destination. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the View, input,
//! source or review.

use std::sync::Arc;

use persistence_library::{CalibrationInputDetail, CalibrationInputSummary, InputQuery};
use platevault_core::library::Library;
use platevault_core::{
    AdoptionDestination, AdoptionOperation, AdoptionReview, AdoptionSource, AdoptionState,
    CalibrationHandoff, CalibrationPlan, CalibrationViewPlan, CandidateRef, CustodyFact,
    DecisionItem, ExpectedSession, InputForm, InputKind, Requirement, Revision,
};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// One requirement whose effective decision `calibration_withdraw` ends.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawItem {
    pub light_session_id: Uuid,
    pub kind: InputKind,
}

/// Raw sets, adopted masters and detected candidates in group order, with
/// evidence, missing evidence, availability counts and provenance. Retired
/// copies are omitted. Read-only.
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

/// Per light Session and kind, every listed candidate with its criteria and
/// the preselected one. Takes no View and writes nothing.
///
/// # Errors
/// `Conflict` with successors for a stale or superseded Session;
/// `InvalidInput` for repeated sessions or kinds.
#[tauri::command]
pub async fn calibration_match(
    library: State<'_, Arc<Library>>,
    sessions: Vec<ExpectedSession>,
    kinds: Vec<InputKind>,
) -> Reply<Vec<Requirement>> {
    library.calibration_match(&sessions, &kinds).await.map_err(fail(None))
}

/// The plan revision, required kinds and each requirement of a committed View
/// revision, with its state, candidates and effective decision. Read-only.
///
/// # Errors
/// `NotFound` for an unknown View or revision.
#[tauri::command]
pub async fn calibration_view_plan(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
) -> Reply<CalibrationViewPlan> {
    library.calibration_view_plan(view_id, view_revision).await.map_err(fail(Some(view_id)))
}

/// Record the required kinds; the plan returns at revision +1. An empty set is
/// recorded.
///
/// # Errors
/// `InvalidInput` for a repeated kind; `Conflict` for a stale plan or a View
/// revision that is not the latest committed one.
#[tauri::command]
pub async fn calibration_set_required_kinds(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
    kinds: Vec<InputKind>,
) -> Reply<CalibrationPlan> {
    library
        .calibration_set_required_kinds(view_id, view_revision, expected_revision, &kinds)
        .await
        .map_err(fail(Some(view_id)))
}

/// Accept all-compatible inputs after hashing every input file; all or nothing.
///
/// # Errors
/// `InvalidInput` naming non-compatible criteria, a candidate or an unadopted
/// master; `Conflict` for stale revisions; drift, offline or unreadable files
/// are refused naming each one.
#[tauri::command]
pub async fn calibration_accept(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
    items: Vec<DecisionItem>,
) -> Reply<CalibrationViewPlan> {
    library
        .calibration_accept(view_id, view_revision, expected_revision, &items)
        .await
        .map_err(fail(Some(view_id)))
}

/// Record a reasoned exception after hashing the input; input evidence stays.
///
/// # Errors
/// `InvalidInput` for a blank reason or an all-compatible input; otherwise as
/// `calibration_accept`.
#[tauri::command]
pub async fn calibration_record_exception(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
    item: DecisionItem,
    reason: String,
) -> Reply<CalibrationViewPlan> {
    library
        .calibration_record_exception(view_id, view_revision, expected_revision, &item, &reason)
        .await
        .map_err(fail(Some(view_id)))
}

/// Append `withdrawn` rows ending the effective decisions of these requirements.
///
/// # Errors
/// `InvalidInput` for an empty or repeated batch or a requirement without an
/// effective decision; `Conflict` for stale revisions.
#[tauri::command]
pub async fn calibration_withdraw(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
    items: Vec<WithdrawItem>,
) -> Reply<CalibrationViewPlan> {
    let items: Vec<(Uuid, InputKind)> =
        items.iter().map(|item| (item.light_session_id, item.kind)).collect();
    library
        .calibration_withdraw(view_id, view_revision, expected_revision, &items)
        .await
        .map_err(fail(Some(view_id)))
}

/// The PREP read: readiness, accepted and excepted assignments with their
/// hashed inputs, and every unresolved requirement with its reason.
///
/// # Errors
/// `NotFound` for an unknown View or revision.
#[tauri::command]
pub async fn calibration_handoff(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
) -> Reply<CalibrationHandoff> {
    library.calibration_handoff(view_id, view_revision).await.map_err(fail(Some(view_id)))
}

/// A durable adoption review after hashing the source and checking the
/// destination. Writes no file.
///
/// # Errors
/// `IdentityConflict` scoped to an existing destination entry; `InvalidInput`
/// for a RES output before 070, a non-master or a Retired source;
/// `SourceUnavailable` for an offline location.
#[tauri::command]
pub async fn calibration_review_adoption(
    library: State<'_, Arc<Library>>,
    source: AdoptionSource,
    destination: AdoptionDestination,
) -> Reply<AdoptionReview> {
    let identity = match &source {
        AdoptionSource::Asset { asset_id, .. } => *asset_id,
        AdoptionSource::Result { result_id } => *result_id,
    };
    library.calibration_review_adoption(&source, &destination).await.map_err(fail(Some(identity)))
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

/// Candidate masters, adopted masters and retained adoption sources with their
/// fingerprints (STO seam). Until 070 identifies a View's outputs they are
/// library-wide. Read-only.
///
/// # Errors
/// `NotFound` for an unknown View.
#[tauri::command]
pub async fn calibration_custody_facts(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<Vec<CustodyFact>> {
    library.calibration_custody_facts(view_id).await.map_err(fail(Some(view_id)))
}
