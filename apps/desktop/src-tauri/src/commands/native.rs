//! Native filesystem control commands exposed to the Tauri webview (spec 004).
//!
//! `native.directory.pick` and `native.file.pick` delegate to
//! tauri-plugin-dialog. `native.reveal` delegates to tauri-plugin-opener with
//! a Linux xdg-open fallback.

use app_core::native;
use audit::event_bus::{NativeRevealFailed, Source, TOPIC_NATIVE_REVEAL_FAILED};
use contracts_core::native::error_codes;
use contracts_core::native::{
    DirectoryPickRequest, DirectoryPickResponse, FilePickRequest, FilePickResponse, RevealRequest,
    RevealResponse, RevealSelection,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::commands::lifecycle::AppState;

/// `native.directory.pick` — open the OS directory picker.
///
/// # Errors
/// Returns `Err(String)` on validation failure or if the dialog cannot be shown.
#[tauri::command]
#[specta::specta]
pub async fn native_directory_pick(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    request: DirectoryPickRequest,
) -> Result<DirectoryPickResponse, String> {
    tracing::debug!("native.directory.pick request_id={}", request.request_id);

    native::validate_directory_pick(&request).map_err(|e| e.message)?;

    let mut builder = app.dialog().file();

    if let Some(ref default_path) = request.default_path {
        builder = builder.set_directory(default_path);
    }

    let folder = builder.blocking_pick_folder();

    match folder {
        Some(path) => {
            let path_str = path.to_string();
            Ok(native::directory_pick_selected(path_str))
        }
        None => Ok(native::directory_pick_cancelled()),
    }
}

/// `native.file.pick` — open the OS file picker with type filters.
///
/// # Errors
/// Returns `Err(String)` on filter validation failure or if the dialog cannot be shown.
#[tauri::command]
#[specta::specta]
pub async fn native_file_pick(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    request: FilePickRequest,
) -> Result<FilePickResponse, String> {
    tracing::debug!(
        "native.file.pick request_id={} filters={}",
        request.request_id,
        request.filters.len()
    );

    native::validate_file_pick(&request).map_err(|e| e.message)?;

    let mut builder = app.dialog().file();

    // Add filters from the request.
    for filter in &request.filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&filter.name, &extensions);
    }

    if let Some(ref default_path) = request.default_path {
        builder = builder.set_directory(default_path);
    }

    let file = builder.blocking_pick_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            // We cannot reliably determine which filter the user selected from
            // the tauri-plugin-dialog API, so we pass None.
            Ok(native::file_pick_selected(path_str, None))
        }
        None => Ok(native::file_pick_cancelled()),
    }
}

/// `native.reveal` — reveal a path in the OS file browser.
///
/// Uses `tauri_plugin_opener::reveal_item_in_dir`. On Linux, if the opener
/// plugin fails, falls back to `xdg-open` on the parent directory and
/// returns `selection: "directory_only"`.
///
/// # Errors
/// Returns `Err(String)` if the path does not exist or the OS command fails.
#[tauri::command]
#[specta::specta]
pub async fn native_reveal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: RevealRequest,
) -> Result<RevealResponse, String> {
    tracing::debug!("native.reveal request_id={} path={}", request.request_id, request.path);

    // Check path existence and emit audit event on failure.
    native::validate_reveal_path(&state.bus, &request).await.map_err(|e| e.message)?;

    // Attempt the platform reveal.
    match app.opener().reveal_item_in_dir(&request.path) {
        Ok(()) => {
            // macOS and Windows select the item; Linux freedesktop ShowItems
            // also selects. Return `target`.
            Ok(native::reveal_success(RevealSelection::Target))
        }
        Err(opener_err) => {
            // On Linux, fall back to xdg-open on the parent directory.
            if cfg!(target_os = "linux") {
                let parent = std::path::Path::new(&request.path)
                    .parent()
                    .unwrap_or_else(|| std::path::Path::new(&request.path));

                match std::process::Command::new("xdg-open").arg(parent).spawn() {
                    Ok(_) => {
                        return Ok(native::reveal_success(RevealSelection::DirectoryOnly));
                    }
                    Err(xdg_err) => {
                        tracing::warn!("native.reveal: xdg-open fallback also failed: {xdg_err}");
                    }
                }
            }

            // Emit audit event for the failure.
            let _ = state
                .bus
                .publish(
                    TOPIC_NATIVE_REVEAL_FAILED,
                    Source::System,
                    NativeRevealFailed {
                        error_code: error_codes::OS_COMMAND_FAILED.to_owned(),
                        entity_kind: request.entity_kind.map(|k| {
                            serde_json::to_value(k)
                                .ok()
                                .and_then(|v| v.as_str().map(String::from))
                                .unwrap_or_default()
                        }),
                        entity_id: request.entity_id.clone(),
                        request_id: request.request_id.clone(),
                    },
                )
                .await;

            Err(format!("Failed to reveal path: {opener_err}"))
        }
    }
}
