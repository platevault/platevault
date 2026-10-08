// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs and run decisions IPC (spec 068 as amended by D-W5,
//! D-W37 and D-W55).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `calibration` block; the legacy `commands/calibration.rs` and
//! `commands/calibration_tolerances.rs` stay unregistered there. Requirements
//! are keyed by light group and kind. Every mutation carries
//! `expectedRevision` (the run's plan revision, or the review's revision for
//! adoption) and returns the committed record only after its transaction
//! commits; no read starts a rehash. The automatic match, accept and
//! exception hash their input files read-only, and adoption writes only a new
//! file at the reviewed destination. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the run, input,
//! source or review.

use std::sync::Arc;

use persistence_library::{CalibrationInputDetail, CalibrationInputSummary, InputQuery};
use platevault_core::library::Library;
use platevault_core::{
    AdoptionDestination, AdoptionOperation, AdoptionReview, AdoptionSource, AdoptionState,
    CalibrationAssignment, CalibrationHandoff, CalibrationPlan, CalibrationPolicy,
    CalibrationReadiness, CalibrationViewPlan, CandidateRef, CustodyFact, DecisionItem,
    ExpectedSession, GroupCalibrationReadiness, InputForm, InputKind, ProjectCalibrationEvidence,
    Requirement, RequirementKey, Revision,
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

/// Per light group and kind of these sessions, every listed candidate with
/// its criteria and the single top input. Takes no run and assigns nothing.
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

/// The requirement table of a committed run revision: each light group and
/// kind with its state, candidates, Why this match and effective decision.
/// Read-only.
///
/// # Errors
/// `NotFound` for an unknown run or revision.
#[tauri::command]
pub async fn calibration_view_plan(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
) -> Reply<CalibrationViewPlan> {
    library.calibration_view_plan(view_id, view_revision).await.map_err(fail(Some(view_id)))
}

/// The Calibrate step's readiness line: light groups matched, suggested,
/// needing review, excepted and excluded. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run or revision.
#[tauri::command]
pub async fn calibration_readiness(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
) -> Reply<CalibrationReadiness> {
    library.calibration_readiness(view_id, view_revision).await.map_err(fail(Some(view_id)))
}

/// A run group's calibration (CAL-FR-11): the one policy its panel runs
/// share and each panel run's readiness line by panel number; a panel run
/// never saved reads none. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run group.
#[tauri::command]
pub async fn calibration_group_readiness(
    library: State<'_, Arc<Library>>,
    group_id: Uuid,
) -> Reply<GroupCalibrationReadiness> {
    library.calibration_group_readiness(group_id).await.map_err(fail(Some(group_id)))
}

/// The PREP read: automatic, accepted and excepted assignments with their
/// hashed inputs, exclusions, and every unresolved requirement with its reason.
///
/// # Errors
/// `NotFound` for an unknown run or revision.
#[tauri::command]
pub async fn calibration_handoff(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
) -> Reply<CalibrationHandoff> {
    library.calibration_handoff(view_id, view_revision).await.map_err(fail(Some(view_id)))
}

/// Record the required kinds; the plan returns at revision +1. An empty set is
/// recorded.
///
/// # Errors
/// `InvalidInput` for a repeated kind or a run in the Trash or Complete;
/// `Conflict` for a stale plan or a revision that is not the latest committed one.
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

/// Turn the run's automatic assignment on or off (D-W55). A panel run takes
/// its run group's policy from the group's setup (`view_group_set_setup`).
///
/// # Errors
/// `InvalidInput` for a panel run of a run group or a run in the Trash or
/// Complete; `Conflict` for a stale plan revision.
#[tauri::command]
pub async fn calibration_set_policy(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_revision: Revision,
    policy: CalibrationPolicy,
) -> Reply<CalibrationPlan> {
    library
        .calibration_set_policy(view_id, expected_revision, policy)
        .await
        .map_err(fail(Some(view_id)))
}

/// The automatic match the Calibrate step runs when it opens and after a new
/// membership revision: single fully compatible top inputs are assigned with
/// their identity and SHA-256, drifted adopted masters are named, and inputs
/// that cannot be read are reported per requirement.
///
/// # Errors
/// `InvalidInput` for a run in the Trash or Complete; `Conflict` for stale
/// revisions.
#[tauri::command]
pub async fn calibration_assign(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
) -> Reply<CalibrationAssignment> {
    library
        .calibration_assign(view_id, view_revision, expected_revision)
        .await
        .map_err(fail(Some(view_id)))
}

/// Accept a suggestion or replace an assignment after hashing every input
/// file; all or nothing. A choice with an unknown or incompatible criterion
/// reads needs review until an exception is recorded.
///
/// # Errors
/// `InvalidInput` naming an unlisted input or an unadopted master; `Conflict`
/// for stale revisions; drifted, offline or unreadable files are refused
/// naming each one.
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

/// Exclude requirements without an input; the optional reason is kept.
///
/// # Errors
/// `InvalidInput` for an empty or repeated batch, a blank reason or an
/// unknown requirement; `Conflict` for stale revisions.
#[tauri::command]
pub async fn calibration_exclude(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    view_revision: Revision,
    expected_revision: Revision,
    items: Vec<RequirementKey>,
    reason: Option<String>,
) -> Reply<CalibrationViewPlan> {
    library
        .calibration_exclude(view_id, view_revision, expected_revision, &items, reason.as_deref())
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
    items: Vec<RequirementKey>,
) -> Reply<CalibrationViewPlan> {
    library
        .calibration_withdraw(view_id, view_revision, expected_revision, &items)
        .await
        .map_err(fail(Some(view_id)))
}

/// Missing-calibration and exposure-mismatch evidence of a Project's
/// candidate sessions per subject and channel. Assigns nothing.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
pub async fn calibration_project_evidence(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ProjectCalibrationEvidence> {
    library.project_calibration_evidence(project_id).await.map_err(fail(Some(project_id)))
}

/// A durable adoption review after hashing the source and checking the
/// destination. Writes no file.
///
/// # Errors
/// `IdentityConflict` scoped to an existing destination entry; `InvalidInput`
/// for a Result that is no offered master or lies outside every registered
/// location, a non-master or a Retired source; `SourceUnavailable` for an
/// offline location.
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

/// Candidate masters, adopted masters and retained adoption sources with
/// their fingerprints (STO seam), library-wide until results discovery
/// identifies a run's outputs. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn calibration_custody_facts(
    library: State<'_, Arc<Library>>,
) -> Reply<Vec<CustodyFact>> {
    library.calibration_custody_facts().await.map_err(fail(None))
}
