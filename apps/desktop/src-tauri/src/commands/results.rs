// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Results IPC (spec 070 RES-FR-01..05/08/10, CAL-FR-06, VSEL-FR-05): the
//! Results step's list and rescan, Attach Result, Accept Result, the Results
//! input filter and product inputs of a run, and the once-only master offer.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `results` block. `results_list`, `results_accepted`,
//! `view_product_inputs` and `calibration_result_masters` only read; the
//! input filter rehashes each accepted product before offering it. Failures
//! follow the library [`platevault_core::ErrorResponse`] conventions, naming
//! the run, run group or Result.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::view_selection::ViewDetail;
use platevault_core::{
    AcceptOutcome, AcceptResult, AcceptedResult, MasterOffer, NativePath, NewView, ProductInput,
    ResultInputOffer, ResultKind, ResultOwner, ResultRecord, ResultsListing,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

fn identity(owner: ResultOwner) -> Uuid {
    match owner {
        ResultOwner::Run { view_id } => view_id,
        ResultOwner::Group { group_id } => group_id,
    }
}

/// The Results step of a run or run group as last scanned. Read-only.
///
/// # Errors
/// `NotFound` for an unknown owner.
#[tauri::command]
pub async fn results_list(
    library: State<'_, Arc<Library>>,
    owner: ResultOwner,
) -> Reply<ResultsListing> {
    library.catalog().results_listing(owner).await.map_err(fail(Some(identity(owner))))
}

/// Rescan the owner's recorded Results folder: what the Results step reads
/// when it opens.
///
/// # Errors
/// `InvalidInput` for an owner not prepared yet or a run in the Trash.
#[tauri::command]
pub async fn results_rescan(
    library: State<'_, Arc<Library>>,
    owner: ResultOwner,
) -> Reply<ResultsListing> {
    library.rescan_results(owner).await.map_err(fail(Some(identity(owner))))
}

/// Attach a file saved outside the Results folder as a Result of `kind`.
///
/// # Errors
/// `InvalidInput` for a file inside a recorded folder, one already recorded,
/// a link, or a kind the owner cannot take.
#[tauri::command]
pub async fn results_attach(
    library: State<'_, Arc<Library>>,
    owner: ResultOwner,
    path: NativePath,
    kind: ResultKind,
) -> Reply<ResultRecord> {
    library.attach_result(owner, path, kind).await.map_err(fail(Some(identity(owner))))
}

/// Accept products whose current bytes still match their inspection; each
/// is accepted or refused on its own.
///
/// # Errors
/// `NotFound` for an unknown Result.
#[tauri::command]
pub async fn results_accept(
    library: State<'_, Arc<Library>>,
    items: Vec<AcceptResult>,
) -> Reply<AcceptOutcome> {
    library.accept_results(&items).await.map_err(fail(None))
}

/// Accepted Results outside the Trash, optionally of one Project or Target,
/// with where each comes from. Read-only; nothing is hashed.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn results_accepted(
    library: State<'_, Arc<Library>>,
    project_id: Option<Uuid>,
    target_id: Option<Uuid>,
) -> Reply<Vec<AcceptedResult>> {
    library.catalog().accepted_results(project_id, target_id).await.map_err(fail(project_id))
}

/// The Results input filter of a run, or of a run being created when
/// `view_id` is absent: accepted products from any Project and rig, each
/// rehashed; only verified ones are offered.
///
/// # Errors
/// `NotFound` for an unknown run.
#[tauri::command]
pub async fn results_inputs(
    library: State<'_, Arc<Library>>,
    view_id: Option<Uuid>,
) -> Reply<Vec<ResultInputOffer>> {
    library.result_inputs(view_id).await.map_err(fail(view_id))
}

/// Create a run whose Results input filter picked `product_ids`.
///
/// # Errors
/// As `view_create`, plus `InvalidInput` for a product that is not accepted,
/// drifted, belongs to a run in the Trash or is picked twice.
#[tauri::command]
pub async fn view_create_with_products(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    subject_id: Uuid,
    rig_id: Uuid,
    name: String,
    product_ids: Vec<Uuid>,
) -> Reply<ViewDetail> {
    let input = NewView { project_id, subject_id, rig_id, name };
    library.create_view_with_products(&input, &product_ids).await.map_err(fail(Some(project_id)))
}

/// Add accepted results to an open run's inputs.
///
/// # Errors
/// `InvalidInput` for a Complete run or one in the Trash, and as
/// `view_create_with_products` for each product.
#[tauri::command]
pub async fn view_add_product_inputs(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    product_ids: Vec<Uuid>,
) -> Reply<Vec<ProductInput>> {
    library.add_view_product_inputs(view_id, &product_ids).await.map_err(fail(Some(view_id)))
}

/// A run's product inputs with their originating runs. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run.
#[tauri::command]
pub async fn view_product_inputs(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<Vec<ProductInput>> {
    library.catalog().view_product_inputs(view_id).await.map_err(fail(Some(view_id)))
}

/// Dismiss the once-only Add to calibration library offer for its file and
/// digest; the master stays listed in Calibration.
///
/// # Errors
/// `InvalidInput` for an offer already dismissed or adopted.
#[tauri::command]
pub async fn results_master_dismiss(
    library: State<'_, Arc<Library>>,
    offer_id: Uuid,
) -> Reply<MasterOffer> {
    library.catalog().dismiss_master_offer(offer_id).await.map_err(fail(Some(offer_id)))
}

/// Generated masters found in Results and not adopted, offered or
/// dismissed: Calibration's candidates from Results, adopted through
/// `calibration_review_adoption` with a Result source. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn calibration_result_masters(
    library: State<'_, Arc<Library>>,
) -> Reply<Vec<MasterOffer>> {
    library.catalog().result_masters().await.map_err(fail(None))
}
