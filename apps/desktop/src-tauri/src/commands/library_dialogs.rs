// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library shell's native filesystem actions: OS pickers and file-manager
//! reveal, the catalog data directory query, and the Windows Developer Mode
//! settings launcher.

use app_core::native::{reveal_path, RevealOpener};
use contracts_core::error_code::ErrorCode;
use contracts_core::native::RevealSelection;
use platevault_core::{ErrorResponse, LibraryError, NativePath};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::library::fail;
use super::native::TauriRevealOpener;

/// The native data directory holding `catalog.sqlite` and its SQLite journals.
///
/// # Errors
/// This read has no runtime failure after the library shell starts.
#[tauri::command]
#[specta::specta]
pub async fn library_data_location(
    directory: tauri::State<'_, DataDirectory>,
) -> Result<NativePath, ErrorResponse> {
    Ok(directory.inner().0.clone())
}

/// Open Windows' Developer Mode settings page from Setup (J18 S1).
///
/// # Errors
/// `SourceUnavailable` if the opener refuses or the platform is not Windows.
#[tauri::command]
#[specta::specta]
pub async fn library_open_developer_settings(app: AppHandle) -> Result<(), ErrorResponse> {
    #[cfg(target_os = "windows")]
    {
        app.opener().open_url("ms-settings:developers", None::<&str>).map_err(|error| {
            fail(None)(LibraryError::SourceUnavailable(format!(
                "cannot open Developer Mode settings: {error}"
            )))
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err(fail(None)(LibraryError::SourceUnavailable(
            "Developer Mode settings are only available on Windows".into(),
        )))
    }
}

/// The canonical catalog data directory managed by the library shell.
pub struct DataDirectory(NativePath);

impl DataDirectory {
    /// Build the managed native directory state used by the shell and IPC tests.
    #[must_use]
    pub fn from_path(path: &std::path::Path) -> Self {
        Self(NativePath::from_path(path))
    }
}

#[cfg(not(target_os = "windows"))]
#[cfg(test)]
mod settings_tests {
    use platevault_core::LibraryErrorCode;

    use super::*;

    #[test]
    fn unsupported_platform_refuses_the_settings_target() {
        let error = fail(None)(LibraryError::SourceUnavailable(
            "Developer Mode settings are only available on Windows".into(),
        ));
        assert_eq!(error.code, LibraryErrorCode::SourceUnavailable);
        assert!(error.scope.is_none());
    }
}

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
/// the legacy shell's; the library catalog keeps no legacy audit events.
///
/// # Errors
/// `NotFound` for a missing path; `SourceUnavailable` when it cannot be read
/// or the file manager could not show it; `InvalidInput` for a path that is
/// not an absolute local path.
#[tauri::command]
#[specta::specta]
pub async fn library_reveal(
    app: AppHandle,
    path: NativePath,
) -> Result<RevealSelection, ErrorResponse> {
    let opener = TauriRevealOpener(app);
    // The OS reveal can block its caller, so it never runs on an async worker.
    tauri::async_runtime::spawn_blocking(move || reveal(&opener, &path))
        .await
        .map_err(|error| {
            LibraryError::SourceUnavailable(format!("the reveal was interrupted: {error}"))
        })
        .and_then(|revealed| revealed)
        .map_err(fail(None))
}

/// [`reveal_path`] for a library path: refused unless it is absolute, and its
/// failure in the library vocabulary, scoped to `path`.
fn reveal(opener: &impl RevealOpener, path: &NativePath) -> Result<RevealSelection, LibraryError> {
    let local = path.to_path_buf()?;
    if !local.is_absolute() {
        return Err(LibraryError::InvalidInput(format!(
            "reveal needs an absolute path, not {}",
            local.display()
        )));
    }
    reveal_path(opener, &local).map_err(|error| {
        let failure = if error.code == ErrorCode::PathNotExists {
            LibraryError::NotFound(error.message)
        } else {
            LibraryError::SourceUnavailable(error.message)
        };
        LibraryError::Context {
            error: Box::new(failure),
            scope: Some(path.clone()),
            identity: None,
        }
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use platevault_core::LibraryErrorCode;

    use super::*;

    /// An OS whose reveal and folder opening both succeed or both fail.
    struct Opener {
        fails: bool,
    }

    impl RevealOpener for Opener {
        fn reveal_item(&self, _path: &Path) -> Result<(), String> {
            if self.fails {
                Err("no file manager".into())
            } else {
                Ok(())
            }
        }

        fn open_directory(&self, directory: &Path) -> Result<(), String> {
            self.reveal_item(directory)
        }
    }

    #[test]
    fn an_existing_path_is_revealed() {
        let scratch = tempfile::tempdir().unwrap();
        let path = NativePath::from_path(scratch.path());
        assert_eq!(reveal(&Opener { fails: false }, &path).unwrap(), RevealSelection::Target);
    }

    #[test]
    fn a_missing_path_is_not_found_naming_it() {
        let scratch = tempfile::tempdir().unwrap();
        let path = NativePath::from_path(&scratch.path().join("missing.fit"));
        let error = reveal(&Opener { fails: false }, &path).unwrap_err();
        assert_eq!(error.code(), LibraryErrorCode::NotFound);
        assert_eq!(error.response(None, None).scope, Some(path));
    }

    #[test]
    fn a_failed_file_manager_is_source_unavailable_naming_the_path() {
        let scratch = tempfile::tempdir().unwrap();
        let path = NativePath::from_path(scratch.path());
        let error = reveal(&Opener { fails: true }, &path).unwrap_err();
        assert_eq!(error.code(), LibraryErrorCode::SourceUnavailable);
        assert_eq!(error.response(None, None).scope, Some(path));
    }

    #[test]
    fn a_relative_or_malformed_path_is_refused() {
        let relative = NativePath::from_path(Path::new("WBPP/master/masterDark.fit"));
        let error = reveal(&Opener { fails: false }, &relative).unwrap_err();
        assert_eq!(error.code(), LibraryErrorCode::InvalidInput);

        #[cfg(unix)]
        let malformed = NativePath::UnixBytes(b"/tmp/master\0dark.fit".to_vec());
        #[cfg(windows)]
        let malformed = NativePath::WindowsUtf16("C:\\master\0dark.fit".encode_utf16().collect());
        let error = reveal(&Opener { fails: false }, &malformed).unwrap_err();
        assert_eq!(error.code(), LibraryErrorCode::InvalidInput);
    }
}
