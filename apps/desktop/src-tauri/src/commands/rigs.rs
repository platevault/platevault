// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig filter-list and camera IPC (spec 072 PLAN-EQ-FR-01..06, -08, LIB-FR-05
//! unknown filter part), registered by the isolated library shell under its
//! planning block.
//!
//! A failed save returns its [`platevault_core::ErrorResponse`] with the last
//! saved list still in effect; the UI keeps the edit unsaved and retries it
//! with the same expected revision. A filter is deleted by saving its rig's
//! list without it.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{Band, Camera, Revision, Rig, RigFilter, RigFilterValues};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// One filter on a saved list. `id` is absent for a filter new to the list.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct RigFilterInput {
    pub id: Option<Uuid>,
    pub name: String,
    pub match_values: Vec<String>,
    pub bands: Vec<Band>,
}

/// Editable fields for one camera create or update.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct CameraSaveInput {
    pub id: Option<Uuid>,
    pub model: String,
    pub alias: Option<String>,
    pub no_darks: bool,
    pub no_bias: bool,
}

/// A rig with its filter list, the bands it captures and its field of view.
///
/// # Errors
/// `NotFound` for unknown equipment.
#[tauri::command]
#[specta::specta]
pub async fn rig_filters_get(library: State<'_, Arc<Library>>, equipment_id: Uuid) -> Reply<Rig> {
    library.rig(equipment_id).await.map_err(fail(Some(equipment_id)))
}

/// Every saved rig as [`rig_filters_get`] reads one, by name.
///
/// # Errors
/// A retryable `PersistenceFailure` for an unreadable catalog.
#[tauri::command]
#[specta::specta]
pub async fn library_list_rig_filters(library: State<'_, Arc<Library>>) -> Reply<Vec<Rig>> {
    library.rigs().await.map_err(fail(None))
}

/// Every camera of the rigs, by model and then alias.
///
/// # Errors
/// A retryable `PersistenceFailure` for an unreadable catalog.
#[tauri::command]
#[specta::specta]
pub async fn library_list_cameras(library: State<'_, Arc<Library>>) -> Reply<Vec<Camera>> {
    library.catalog().cameras().await.map_err(fail(None))
}

/// Create a camera or edit it at its expected revision, leaving every rig version and calibration link unchanged.
///
/// # Errors
/// `InvalidInput` for invalid camera fields, an alias/model collision or an edit without an id;
/// `Conflict` for a stale revision or a new id already in use;
/// `NotFound` for an edit of an unknown camera.
#[tauri::command]
#[specta::specta]
pub async fn library_save_camera(
    library: State<'_, Arc<Library>>,
    input: CameraSaveInput,
    expected_revision: Option<Revision>,
) -> Reply<Camera> {
    let id = match (input.id, expected_revision) {
        (Some(id), _) => id,
        (None, None) => Uuid::new_v4(),
        (None, Some(_)) => {
            return Err(fail(None)(platevault_core::LibraryError::InvalidInput(
                "a camera update needs the camera id".into(),
            )))
        }
    };
    let camera = Camera {
        id,
        model: input.model,
        alias: input.alias,
        no_darks: input.no_darks,
        no_bias: input.no_bias,
        revision: expected_revision.unwrap_or_default(),
    };
    let mut saved = library.catalog().save_cameras(&[camera]).await.map_err(fail(Some(id)))?;
    Ok(saved.remove(0))
}

/// Delete a camera nothing refers to; nothing cascades.
///
/// # Errors
/// `InvalidInput` while a rig version, a session's camera link, an adopted
/// master or a Project group uses the camera, and then nothing changes;
/// `Conflict` for a stale revision; `NotFound` for an unknown camera.
#[tauri::command]
#[specta::specta]
pub async fn library_delete_camera(
    library: State<'_, Arc<Library>>,
    camera_id: Uuid,
    expected_revision: Revision,
) -> Reply<()> {
    library
        .catalog()
        .delete_camera(camera_id, expected_revision)
        .await
        .map_err(fail(Some(camera_id)))
}

/// Replace a rig's filter list whole; only that rig's settings change.
///
/// # Errors
/// `InvalidInput` for an invalid list, `Conflict` for a stale revision,
/// `NotFound` for unknown equipment and a retryable `PersistenceFailure` when
/// the save did not commit; the previous list then stays in effect.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn rig_unknown_filters(
    library: State<'_, Arc<Library>>,
    equipment_id: Option<Uuid>,
) -> Reply<Vec<RigFilterValues>> {
    library.rig_unknown_filters(equipment_id).await.map_err(fail(equipment_id))
}
