// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The operating system's folder and file pickers and its file manager's
//! reveal for the library shell. Cancelling a picker is no failure: it
//! answers `None`.

use app_core::native::reveal_path;
use contracts_core::error_code::ErrorCode;
use contracts_core::native::RevealSelection;
use platevault_core::{ErrorResponse, LibraryError, NativePath};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::library::fail;
use super::native::TauriRevealOpener;

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

/// Show `path` in the file manager with it selected (`target`) or, on Linux
/// when that fails, its folder opened (`directory_only`). The same reveal as
/// the legacy shell's; the library catalog keeps no legacy audit events, so a
/// failure is logged instead.
///
/// # Errors
/// `NotFound` for a missing path; `SourceUnavailable` when it cannot be read
/// or the file manager could not show it; `InvalidInput` for a path that is
/// not local.
#[tauri::command]
#[specta::specta]
pub async fn library_reveal(
    app: AppHandle,
    path: NativePath,
) -> Result<RevealSelection, ErrorResponse> {
    let local = path.to_path_buf().map_err(fail(None))?;
    reveal_path(&TauriRevealOpener(&app), &local).map_err(|error| {
        tracing::warn!(code = ?error.code, "library reveal failed: {}", error.message);
        let failure = if error.code == ErrorCode::PathNotExists {
            LibraryError::NotFound(error.message)
        } else {
            LibraryError::SourceUnavailable(error.message)
        };
        fail(None)(LibraryError::Context {
            error: Box::new(failure),
            scope: Some(path),
            identity: None,
        })
    })
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
