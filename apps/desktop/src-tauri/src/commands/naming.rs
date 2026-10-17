// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Settings > Naming IPC (spec 071 STO-IMP-FR-07): read, save and restore the
//! per-frame-type naming templates and preview an unsaved one.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]).
//! Every template is validated by [`Library`] before it is previewed or saved;
//! a refusal is an `invalid_input` [`platevault_core::ErrorResponse`], which
//! the editor words from the catalogue. No command touches an image file.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{NamingFrameType, NamingMetadata, NamingResolution, NamingTemplate};
use tauri::State;

use super::library::{fail, Reply};

/// Every frame type's effective template beside its default.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn naming_get(library: State<'_, Arc<Library>>) -> Reply<Vec<NamingTemplate>> {
    library.naming_templates().await.map_err(fail(None))
}

/// Validate and save a frame type's template; saving the default stores nothing.
///
/// # Errors
/// `InvalidInput` for an empty or overlong template, an unknown token, path
/// traversal or a reserved name; nothing is stored.
#[tauri::command]
#[specta::specta]
pub async fn naming_save(
    library: State<'_, Arc<Library>>,
    frame_type: NamingFrameType,
    template: String,
) -> Reply<NamingTemplate> {
    library.save_naming_template(frame_type, &template).await.map_err(fail(None))
}

/// Delete every override and return the per-type defaults.
///
/// # Errors
/// `PersistenceFailure` when the write cannot commit.
#[tauri::command]
#[specta::specta]
pub async fn naming_restore_defaults(
    library: State<'_, Arc<Library>>,
) -> Reply<Vec<NamingTemplate>> {
    library.restore_naming_defaults().await.map_err(fail(None))
}

/// Live preview of an unsaved template against `sample`, or the frame type's
/// built-in sample, naming every fallback token used. Stores nothing.
///
/// # Errors
/// `InvalidInput`, as for [`naming_save`].
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri deserializes arguments by value
pub fn naming_preview(
    frame_type: NamingFrameType,
    template: String,
    sample: Option<NamingMetadata>,
) -> Reply<NamingResolution> {
    Library::preview_naming(frame_type, &template, sample).map_err(fail(None))
}
