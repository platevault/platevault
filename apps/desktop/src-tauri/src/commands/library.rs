// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Clean library IPC (spec 064 `contracts/library.md`, version 1).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]); no
//! legacy command reaches this catalog and these commands never touch legacy
//! state. Every handler returns only after its catalog transaction commits and
//! reports failures as [`ErrorResponse`] naming the affected identity and scope.
//! Source images are only ever read.

use std::sync::Arc;

use persistence_library::{CorrectionPreview, LocationFailure, SessionQuery};
use platevault_core::grouping::group_assets;
use platevault_core::library::{ConfirmedCorrection, InventoryProbe, Library, LibrarySession};
use platevault_core::targets::{user_target, TargetQuery, TargetSearchHit, UserTargetInput};
use platevault_core::{
    Asset, Association, AssociationState, CorrectionInput, Equipment, ErrorResponse, ExpectedAsset,
    ExpectedSession, LibraryError, Location, LocationRole, NativePath, Provenance, Quality,
    RemapReview, RetireReview, Revision, ScanOperation, SessionSummary, TargetCandidate,
    TargetCone, TargetCoverage, TargetRecord,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

pub(super) type Reply<T> = Result<T, ErrorResponse>;

/// Stable wire failure for `identity`, keeping any scope the error carries.
pub(super) fn fail(identity: Option<Uuid>) -> impl FnOnce(LibraryError) -> ErrorResponse {
    move |error| report(&error, identity, None)
}

/// Stable wire failure for `identity` at the native `scope` the request named.
fn fail_at(
    identity: Option<Uuid>,
    scope: NativePath,
) -> impl FnOnce(LibraryError) -> ErrorResponse {
    move |error| report(&error, identity, Some(scope))
}

fn report(
    error: &LibraryError,
    identity: Option<Uuid>,
    scope: Option<NativePath>,
) -> ErrorResponse {
    let response = error.response(identity, scope);
    tracing::warn!(kind = %response.kind, identity = ?response.identity, "{}", response.message);
    response
}

/// A registered location with its last recorded access failure, if any.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationState {
    pub location: Location,
    pub failure: Option<LocationFailure>,
}

/// Source of an explicitly saved target. Provenance is never client-asserted:
/// seed candidates come from the bundled dataset, provider candidates from a
/// fresh resolve, user candidates from the shared user-target rules.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum TargetInput {
    Seed { id: Uuid },
    User(UserTargetInput),
    Provider { query: String },
}

/// Explicit camera/optical-train fields. `id` is absent on create.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentInput {
    pub id: Option<Uuid>,
    pub name: String,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub pixel_size_um: Option<f64>,
}

/// Register a read-only location; nothing is scanned or modified.
///
/// # Errors
/// `InvalidInput`/`Conflict` for an invalid or overlapping root, source errors
/// when the root identity cannot be observed.
#[tauri::command]
pub async fn library_register_location(
    library: State<'_, Arc<Library>>,
    path: NativePath,
    display_name: String,
    role: LocationRole,
) -> Reply<Location> {
    let scope = path.clone();
    library.register_location(path, display_name, role).await.map_err(fail_at(None, scope))
}

/// Registered locations with availability, last observation and access failure.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn library_list_locations(library: State<'_, Arc<Library>>) -> Reply<Vec<LocationState>> {
    let catalog = library.catalog();
    let locations = catalog.list_locations().await.map_err(fail(None))?;
    let mut states = Vec::with_capacity(locations.len());
    for location in locations {
        let failure =
            catalog.location_failure(location.id).await.map_err(fail(Some(location.id)))?;
        states.push(LocationState { location, failure });
    }
    Ok(states)
}

/// Durably record a Running scan of the whole location and start it off the UI thread.
///
/// # Errors
/// `InvalidInput` when a scan is already running; `NotFound` for an unknown location.
#[tauri::command]
pub async fn library_start_scan(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
) -> Reply<ScanOperation> {
    library.inner().start_scan(location_id, None).await.map_err(fail(Some(location_id)))
}

/// Durable counts, scopes, per-item issues and state of one scan.
///
/// # Errors
/// `NotFound` for an unknown operation.
#[tauri::command]
pub async fn library_scan_status(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<ScanOperation> {
    library.catalog().scan_status(operation_id).await.map_err(fail(Some(operation_id)))
}

/// Request cancellation; the returned status may still be Running.
///
/// # Errors
/// `NotFound` for an unknown operation; `SourceUnavailable` when its supervisor is gone.
#[tauri::command]
pub async fn library_cancel_scan(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<ScanOperation> {
    library.cancel_scan(operation_id).await.map_err(fail(Some(operation_id)))
}

/// Session summaries, newest night first; browsing measures nothing.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn library_list_sessions(
    library: State<'_, Arc<Library>>,
    location_id: Option<Uuid>,
    include_superseded: Option<bool>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<SessionSummary>> {
    let query = SessionQuery {
        location_id,
        include_superseded: include_superseded.unwrap_or(false),
        offset,
        limit,
    };
    library.catalog().list_sessions(&query).await.map_err(fail(location_id))
}

/// Session assets, observed/effective metadata, associations, lineage and
/// offline target assessments.
///
/// # Errors
/// `NotFound` for an unknown session.
#[tauri::command]
pub async fn library_session(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
) -> Reply<LibrarySession> {
    library.session(session_id).await.map_err(fail(Some(session_id)))
}

/// Durable correction plan setting `field` to `value` on every expected asset;
/// proposed sessions/lineage are computed without changing the catalog.
///
/// # Errors
/// `Conflict` for stale expectations; `InvalidInput` for an unknown field or value type.
#[tauri::command]
pub async fn library_preview_metadata(
    library: State<'_, Arc<Library>>,
    expected: Vec<ExpectedAsset>,
    field: String,
    value: serde_json::Value,
) -> Reply<CorrectionPreview> {
    let corrections = expected
        .iter()
        .map(|asset| CorrectionInput {
            asset_id: asset.asset_id,
            field: field.clone(),
            value: value.clone(),
        })
        .collect::<Vec<_>>();
    library
        .catalog()
        .preview_correction(&expected, &corrections, group_assets)
        .await
        .map_err(fail(None))
}

/// Apply a reviewed plan atomically with regroup and lineage, then re-derive the
/// target suggestions of the resulting sessions; headers are untouched.
///
/// # Errors
/// `Conflict` with no changes when any expectation is stale or differs from the plan.
/// A suggestion refresh failure after commit is reported in `associationRefresh`.
#[tauri::command]
pub async fn library_confirm_metadata(
    library: State<'_, Arc<Library>>,
    preview_id: Uuid,
    expected: Vec<ExpectedAsset>,
) -> Reply<ConfirmedCorrection> {
    library.confirm_correction(preview_id, &expected).await.map_err(fail(Some(preview_id)))
}

/// Record a fingerprint- and digest-bound quality decision; membership is unchanged.
///
/// # Errors
/// `Conflict` for stale expectations; `IdentityConflict` when source bytes changed.
#[tauri::command]
pub async fn library_set_quality(
    library: State<'_, Arc<Library>>,
    expected: Vec<ExpectedAsset>,
    state: Quality,
) -> Reply<Vec<Asset>> {
    library.catalog().set_quality(&expected, state, InventoryProbe).await.map_err(fail(None))
}

/// Offline seed plus saved targets by text and/or cone, with distinct provenance.
///
/// # Errors
/// `InvalidInput` for a zero limit, unsearchable text, an invalid cone or neither filter.
#[tauri::command]
pub async fn library_search_targets(
    library: State<'_, Arc<Library>>,
    query: Option<String>,
    cone: Option<TargetCone>,
    limit: usize,
) -> Reply<Vec<TargetSearchHit>> {
    library.search_targets(&TargetQuery { text: query, cone, limit }).await.map_err(fail(None))
}

/// Qualified provider candidate; nothing is saved.
///
/// # Errors
/// `ProviderUnavailable` when offline or unconfigured; `NotFound`/`InvalidInput` otherwise.
#[tauri::command]
pub async fn library_resolve_target(
    library: State<'_, Arc<Library>>,
    query: String,
) -> Reply<TargetCandidate> {
    library.resolve_target(&query).await.map_err(fail(None))
}

/// Durably save a seed, user or provider target and its aliases.
///
/// # Errors
/// `NotFound` for an unknown seed id; `Conflict` for a stale or duplicate revision;
/// resolver errors for provider targets.
#[tauri::command]
pub async fn library_save_target(
    library: State<'_, Arc<Library>>,
    target: TargetInput,
    expected_revision: Option<Revision>,
) -> Reply<TargetRecord> {
    let candidate = match target {
        TargetInput::Seed { id } => library
            .seed_target(id)
            .ok_or_else(|| LibraryError::NotFound(format!("seed target {id}")))
            .map_err(fail(Some(id)))?,
        TargetInput::User(input) => user_target(&input).map_err(fail(None))?,
        TargetInput::Provider { query } => {
            library.resolve_target(&query).await.map_err(fail(None))?
        }
    };
    library
        .catalog()
        .save_target(&candidate, expected_revision)
        .await
        .map_err(fail(Some(candidate.id)))
}

/// Explicitly confirm a saved target for sessions; capture keys are unchanged.
///
/// # Errors
/// `Conflict` (with successors) for stale or superseded sessions; `NotFound` for an
/// unsaved target.
#[tauri::command]
pub async fn library_associate_target(
    library: State<'_, Arc<Library>>,
    expected: Vec<ExpectedSession>,
    target_id: Uuid,
) -> Reply<Vec<Association>> {
    library.catalog().associate_target(&expected, target_id).await.map_err(fail(Some(target_id)))
}

/// Durably save confirmed user equipment evidence.
///
/// # Errors
/// `InvalidInput` for invalid fields or an update without an id; `Conflict` for a
/// stale revision.
#[tauri::command]
pub async fn library_save_equipment(
    library: State<'_, Arc<Library>>,
    equipment: EquipmentInput,
    expected_revision: Option<Revision>,
) -> Reply<Equipment> {
    let id = match (equipment.id, expected_revision) {
        (Some(id), _) => id,
        (None, None) => Uuid::new_v4(),
        (None, Some(_)) => {
            return Err(report(
                &LibraryError::InvalidInput("an equipment update needs the equipment id".into()),
                None,
                None,
            ))
        }
    };
    let record = Equipment {
        id,
        name: equipment.name,
        camera: equipment.camera,
        telescope: equipment.telescope,
        focal_length_mm: equipment.focal_length_mm,
        pixel_size_um: equipment.pixel_size_um,
        decision_revision: expected_revision.unwrap_or_default(),
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    };
    library.catalog().save_equipment(&record, expected_revision).await.map_err(fail(Some(id)))
}

/// Explicitly confirm saved equipment for sessions; source evidence stays inspectable.
///
/// # Errors
/// `Conflict` (with successors) for stale or superseded sessions; `NotFound` for
/// unknown equipment.
#[tauri::command]
pub async fn library_confirm_equipment(
    library: State<'_, Arc<Library>>,
    expected: Vec<ExpectedSession>,
    equipment_id: Uuid,
) -> Reply<Vec<Association>> {
    library
        .catalog()
        .confirm_equipment(&expected, equipment_id)
        .await
        .map_err(fail(Some(equipment_id)))
}

/// Effective captured/usable/unreviewed exposure per session, location and
/// availability, labelled with the oldest last verification behind usable
/// exposure. Reading coverage starts no rehash.
///
/// # Errors
/// `NotFound` for an unknown target.
#[tauri::command]
pub async fn library_target_coverage(
    library: State<'_, Arc<Library>>,
    target_id: Uuid,
) -> Reply<TargetCoverage> {
    library.catalog().target_coverage(target_id).await.map_err(fail(Some(target_id)))
}

/// Durable per-asset identity/digest review of moving a location to
/// `proposed_path`, against its current revision; no file is written.
///
/// # Errors
/// `NotFound` for an unknown location; source errors when the proposed root
/// cannot be observed.
#[tauri::command]
pub async fn library_review_remap(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
    proposed_path: NativePath,
) -> Reply<RemapReview> {
    let location =
        library.catalog().location(location_id).await.map_err(fail(Some(location_id)))?;
    let scope = proposed_path.clone();
    library
        .review_remap(location_id, location.decision_revision, proposed_path)
        .await
        .map_err(fail_at(Some(location_id), scope))
}

/// Apply a reviewed remap atomically after revalidating every asset.
///
/// # Errors
/// `Conflict`/`IdentityConflict`/`NoByteProof` leave every path unchanged.
#[tauri::command]
pub async fn library_apply_remap(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
    expected_revision: Revision,
) -> Reply<Location> {
    library
        .catalog()
        .apply_remap(review_id, expected_revision, InventoryProbe)
        .await
        .map_err(fail(Some(review_id)))
}

/// Durable display name change; no scan or source change.
///
/// # Errors
/// `Conflict` for a stale revision; `InvalidInput` for an empty name.
#[tauri::command]
pub async fn library_update_location(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
    display_name: String,
    expected_decision_revision: Revision,
) -> Reply<Location> {
    library
        .catalog()
        .update_location(location_id, expected_decision_revision, &display_name)
        .await
        .map_err(fail(Some(location_id)))
}

/// Record and start a new scan of a failed relative subtree.
///
/// # Errors
/// `InvalidInput` for the root or an escaping scope, or when a scan is running.
#[tauri::command]
pub async fn library_retry_scope(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
    scope: NativePath,
) -> Reply<ScanOperation> {
    let reported = scope.clone();
    library
        .inner()
        .retry_scope(location_id, scope)
        .await
        .map_err(fail_at(Some(location_id), reported))
}

/// Restore access only at the verified same volume and root identity.
///
/// # Errors
/// `IdentityConflict` when the root differs (remap review required); `Conflict`
/// for a stale revision.
#[tauri::command]
pub async fn library_reselect_location(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
    path: NativePath,
    expected_decision_revision: Revision,
) -> Reply<Location> {
    let scope = path.clone();
    library
        .reselect_location(location_id, expected_decision_revision, path)
        .await
        .map_err(fail_at(Some(location_id), scope))
}

/// Durable Retire location review naming the location, root, availability and
/// decision revision and every asset, session, View, Project and Result that
/// references its copies. Retiring deletes, moves or modifies no file.
///
/// # Errors
/// `InvalidInput` for a retired location; `Conflict` when its copies changed while
/// references were read; `NotFound` for an unknown location.
#[tauri::command]
pub async fn library_review_retire_location(
    library: State<'_, Arc<Library>>,
    location_id: Uuid,
) -> Reply<RetireReview> {
    library.review_retire_location(location_id).await.map_err(fail(Some(location_id)))
}

/// Confirm a reviewed Retire location: the location is re-read, copies read
/// Retired and leave integration totals, fixed Views name them unresolved and the
/// root stops blocking registration. Reads and changes no file bytes, so no
/// rehash applies.
///
/// # Errors
/// `Conflict` for a stale review or revision, for availability that differs from
/// the review, or while a scan of the location is Running; `InvalidInput` for an
/// applied review or a retired location.
#[tauri::command]
pub async fn library_retire_location(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
    location_id: Uuid,
    expected_revision: Revision,
) -> Reply<Location> {
    library
        .retire_location(review_id, location_id, expected_revision)
        .await
        .map_err(fail(Some(location_id)))
}

/// Durable scan operations newest first, including interrupted ones.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn library_list_operations(
    library: State<'_, Arc<Library>>,
    location_id: Option<Uuid>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<ScanOperation>> {
    library.catalog().list_operations(location_id, offset, limit).await.map_err(fail(location_id))
}
