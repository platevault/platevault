// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Targets list IPC (spec 072 PLAN-TGT-FR-01..05/07..10), registered only by
//! the isolated rebuilt shell ([`crate::library_shell`]) under its targets
//! label. The rows and every planning value come from Rust; the page presents
//! them. Reads write nothing; ★ and Add to targets write only the favourite
//! and, for a Target not saved yet, its record. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Target or preset.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    AddTarget, PresetFilters, PresetRef, Revision, SavedPreset, TargetRecord, TargetsPage,
    TargetsPresets, TargetsQuery, TargetsSearchResults,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// One Targets list page: My targets or Browse catalogues with tonight's
/// planning columns, the Moon once for the toolbar, sorted with unknown
/// values last. Read-only.
///
/// # Errors
/// `InvalidInput` for an invalid query; `NotFound` for an unknown site.
#[tauri::command]
pub async fn planning_target_rows(
    library: State<'_, Arc<Library>>,
    query: TargetsQuery,
) -> Reply<TargetsPage> {
    library.target_rows(&query).await.map_err(fail(query.site_id))
}

/// Search My targets, the bundled catalogues and SIMBAD; each result names
/// its source, and the results say when SIMBAD was not searched. Writes
/// nothing.
///
/// # Errors
/// `InvalidInput` for text without searchable characters.
#[tauri::command]
pub async fn targets_search(
    library: State<'_, Arc<Library>>,
    text: String,
) -> Reply<TargetsSearchResults> {
    library.targets_search(&text).await.map_err(fail(None))
}

/// Add to targets: save the Target when it is not saved yet and mark it ★.
///
/// # Errors
/// `NotFound` for an unknown Target; provider errors for a SIMBAD result.
#[tauri::command]
pub async fn targets_add(
    library: State<'_, Arc<Library>>,
    target: AddTarget,
) -> Reply<TargetRecord> {
    let identity = match &target {
        AddTarget::Saved { id } | AddTarget::Seed { id } => Some(*id),
        AddTarget::Simbad { .. } => None,
    };
    library.add_to_my_targets(&target).await.map_err(fail(identity))
}

/// Add or remove a saved Target's ★; returns the new state.
///
/// # Errors
/// `NotFound` for an unsaved Target.
#[tauri::command]
pub async fn targets_set_favourite(
    library: State<'_, Arc<Library>>,
    target_id: Uuid,
    favourite: bool,
) -> Reply<bool> {
    library.set_favourite(target_id, favourite).await.map_err(fail(Some(target_id)))
}

/// The built-in presets with their definitions, then the saved presets.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn targets_presets_list(library: State<'_, Arc<Library>>) -> Reply<TargetsPresets> {
    library.targets_presets().await.map_err(fail(None))
}

/// Save the current filters as a named preset at revision 1.
///
/// # Errors
/// `InvalidInput` for an invalid or built-in name; `Conflict` for a name a
/// saved preset has.
#[tauri::command]
pub async fn targets_preset_save(
    library: State<'_, Arc<Library>>,
    name: String,
    filters: PresetFilters,
) -> Reply<SavedPreset> {
    library.save_targets_preset(&name, &filters).await.map_err(fail(None))
}

/// Rename a saved preset at its revision; a built-in cannot be renamed.
///
/// # Errors
/// `InvalidInput` for a built-in preset or an invalid name; `NotFound` and
/// `Conflict` for an unknown or stale preset.
#[tauri::command]
pub async fn targets_preset_rename(
    library: State<'_, Arc<Library>>,
    preset: PresetRef,
    name: String,
    expected_revision: Revision,
) -> Reply<SavedPreset> {
    library
        .rename_targets_preset(preset, &name, expected_revision)
        .await
        .map_err(fail(saved_id(preset)))
}

/// Delete a saved preset at its revision; a built-in cannot be deleted.
///
/// # Errors
/// `InvalidInput` for a built-in preset; `NotFound` and `Conflict` for an
/// unknown or stale preset.
#[tauri::command]
pub async fn targets_preset_delete(
    library: State<'_, Arc<Library>>,
    preset: PresetRef,
    expected_revision: Revision,
) -> Reply<()> {
    library.delete_targets_preset(preset, expected_revision).await.map_err(fail(saved_id(preset)))
}

const fn saved_id(preset: PresetRef) -> Option<Uuid> {
    match preset {
        PresetRef::Saved { id } => Some(id),
        PresetRef::Builtin { .. } => None,
    }
}
