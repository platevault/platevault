// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The operating system's folder and file pickers for the library shell.
//! Cancelling a picker is no failure: it answers `None`.

use platevault_core::{ErrorResponse, LibraryError, NativePath};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::library::fail;

/// Pick a folder.
///
/// # Errors
/// `SourceUnavailable` when the picker could not run; `InvalidInput` when it
/// answered something other than a local path.
#[tauri::command]
#[specta::specta]
pub async fn library_pick_folder(app: AppHandle) -> Result<Option<NativePath>, ErrorResponse> {
    let dialog = app.dialog().file();
    // The panel blocks its caller until it closes, so it never runs on an
    // async worker.
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder()).await;
    native(chosen)
}

/// Pick a file.
///
/// # Errors
/// `SourceUnavailable` when the picker could not run; `InvalidInput` when it
/// answered something other than a local path.
#[tauri::command]
#[specta::specta]
pub async fn library_pick_file(app: AppHandle) -> Result<Option<NativePath>, ErrorResponse> {
    let dialog = app.dialog().file();
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file()).await;
    native(chosen)
}

fn native(chosen: tauri::Result<Option<FilePath>>) -> Result<Option<NativePath>, ErrorResponse> {
    let chosen = chosen.map_err(|error| {
        fail(None)(LibraryError::SourceUnavailable(format!("the picker was interrupted: {error}")))
    })?;
    chosen
        .map(|path| {
            path.into_path().map(|path| NativePath::from_path(&path)).map_err(|error| {
                fail(None)(LibraryError::InvalidInput(format!(
                    "the picker answered no local path: {error}"
                )))
            })
        })
        .transpose()
}
