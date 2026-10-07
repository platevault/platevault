// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig filter-list IPC (spec 072 PLAN-EQ-FR-01..06, LIB-FR-05 unknown filter
//! part), registered by the isolated library shell under its planning block.
//!
//! A failed save returns its [`ErrorResponse`] with the last saved list still
//! in effect; the UI keeps the edit unsaved and retries it with the same
//! expected revision.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{Band, ErrorResponse, Revision, Rig, RigFilter, RigFilterValues};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::library::fail;

type Reply<T> = Result<T, ErrorResponse>;

/// One filter on a saved list. `id` is absent for a filter new to the list.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFilterInput {
    pub id: Option<Uuid>,
    pub name: String,
    pub match_values: Vec<String>,
    pub bands: Vec<Band>,
}

/// A rig with its filter list, the bands it captures and its field of view.
///
/// # Errors
/// `NotFound` for unknown equipment.
#[tauri::command]
pub async fn rig_filters_get(library: State<'_, Arc<Library>>, equipment_id: Uuid) -> Reply<Rig> {
    library.rig(equipment_id).await.map_err(fail(Some(equipment_id)))
}

/// Replace a rig's filter list whole; only that rig's settings change.
///
/// # Errors
/// `InvalidInput` for an invalid list, `Conflict` for a stale revision,
/// `NotFound` for unknown equipment and a retryable `PersistenceFailure` when
/// the save did not commit; the previous list then stays in effect.
#[tauri::command]
pub async fn rig_filters_save(
    library: State<'_, Arc<Library>>,
    equipment_id: Uuid,
    filters: Vec<RigFilterInput>,
    expected_revision: Revision,
) -> Reply<Rig> {
    let filters: Vec<RigFilter> = filters
        .into_iter()
        .map(|filter| RigFilter {
            id: filter.id.unwrap_or_else(Uuid::new_v4),
            name: filter.name,
            match_values: filter.match_values,
            bands: filter.bands,
        })
        .collect();
    library
        .save_rig_filters(equipment_id, &filters, expected_revision)
        .await
        .map_err(fail(Some(equipment_id)))
}

/// FILTER values on sessions confirmed to a rig that none of its filters
/// match, for one rig or, without `equipment_id`, every rig.
///
/// # Errors
/// `NotFound` for an unknown `equipment_id`.
#[tauri::command]
pub async fn rig_unknown_filters(
    library: State<'_, Arc<Library>>,
    equipment_id: Option<Uuid>,
) -> Reply<Vec<RigFilterValues>> {
    library.rig_unknown_filters(equipment_id).await.map_err(fail(equipment_id))
}
