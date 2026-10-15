// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Update commands (spec 051 US10, astro-plan-5wcib): the webview's side of
//! the services-crate updater. Each one runs an `UpdatePort` operation; its
//! progress reaches the webview as `update:status` events
//! (`crate::updater::UPDATE_STATUS_EVENT`).

use contracts_core::updates::UpdateStatus;
use contracts_core::ContractError;
use desktop_services::update::{UpdatePort as _, Updater};
use tauri::{AppHandle, Manager, Runtime};

fn updater<R: Runtime>(app: &AppHandle<R>) -> Result<Updater, ContractError> {
    app.try_state::<Updater>()
        .map(|updater| updater.inner().clone())
        .ok_or_else(|| ContractError::internal("updates are unavailable in this build"))
}

/// `update.status` — the update status to show now; later changes arrive as
/// `update:status` events.
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub fn update_status(app: AppHandle) -> Result<UpdateStatus, ContractError> {
    Ok(updater(&app)?.current_status())
}

/// `update.check_on_startup` — the check at app start, run once per process
/// and only when `automatic` ("Check for updates automatically") is on.
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub async fn update_check_on_startup(app: AppHandle, automatic: bool) -> Result<(), ContractError> {
    updater(&app)?.check_on_startup(automatic).await;
    Ok(())
}

/// `update.check` — a manual check. Never downloads.
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub async fn update_check(app: AppHandle) -> Result<(), ContractError> {
    updater(&app)?.check().await;
    Ok(())
}

/// `update.install_now` — download and verify, install, then relaunch (on
/// Windows the app exits for the installer).
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub async fn update_install_now(app: AppHandle) -> Result<(), ContractError> {
    updater(&app)?.install_now().await;
    Ok(())
}

/// `update.install_on_quit` — download and verify now, install when the app
/// quits.
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub async fn update_install_on_quit(app: AppHandle) -> Result<(), ContractError> {
    updater(&app)?.install_on_quit().await;
    Ok(())
}
