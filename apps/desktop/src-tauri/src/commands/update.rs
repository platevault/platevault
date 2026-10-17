// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Update commands (spec 051 US10, astro-plan-5wcib): the webview's side of
//! the services-crate updater. Each one runs an `UpdatePort` operation; its
//! progress reaches the webview as `update:status` events
//! (`crate::updater::UPDATE_STATUS_EVENT`), and where the offer of a found
//! release was made as `update:offer` events
//! (`crate::updater::UPDATE_OFFER_EVENT`, astro-plan-c72oo).

use desktop_services::locale::ActiveLocale;

use contracts_core::updates::{UpdateOffer, UpdateStatus};
use contracts_core::ContractError;
use desktop_services::update::offer::Offers;
use desktop_services::update::{UpdatePort as _, Updater};
use tauri::Manager;
use tauri::State;
#[cfg(test)]
use tauri::{
    http::HeaderMap,
    ipc::{CallbackFn, InvokeBody},
    test::{self, INVOKE_KEY},
    utils::config::WebviewUrl,
    webview::{InvokeRequest, WebviewWindowBuilder},
};
use tauri::{AppHandle, Runtime};

fn unavailable() -> ContractError {
    ContractError::internal("updates are unavailable in this build")
}

fn updater<R: Runtime>(app: &AppHandle<R>) -> Result<Updater, ContractError> {
    app.try_state::<Updater>().map(|updater| updater.inner().clone()).ok_or_else(unavailable)
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

/// `update.offer` — where the Install now and Install on quit offer for the
/// release the last check found was made: the system notification, or the
/// in-app notice. Later changes arrive as `update:offer` events.
///
/// # Errors
///
/// `InternalError` when the build has no usable updater configuration.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the app handle by value
pub fn update_offer(app: AppHandle) -> Result<UpdateOffer, ContractError> {
    app.try_state::<Offers>().map(|offers| offers.current()).ok_or_else(unavailable)
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

/// `update.set_locale` — the webview's active locale, sent at startup and on
/// every locale change, for text the updater and desktop notifications show
/// outside the webview: the macOS administrator prompt, update notices and OS
/// completion notices. A tag that is not a shipped locale means the base locale.
///
/// # Errors
///
/// The command itself never fails; the `Result` keeps the shape every update
/// command has. The locale is managed state, so in an app that does not manage
/// an [`ActiveLocale`] the call is an IPC error before the command runs.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn update_set_locale(
    active_locale: State<'_, ActiveLocale>,
    locale: String,
) -> Result<(), ContractError> {
    active_locale.set_locale(&locale);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_set_locale_changes_the_managed_locale_through_ipc() {
        let app = test::mock_builder()
            .invoke_handler(tauri::generate_handler![update_set_locale])
            .build(test::mock_context(test::noop_assets()))
            .expect("build mock app");
        let shared_locale = ActiveLocale::new();
        app.manage(shared_locale.clone());
        let webview = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .expect("build mock webview");

        for (tag, expected) in [("pt-BR", "pt-BR"), ("de-DE", "en-GB")] {
            test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: "update_set_locale".to_owned(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().expect("IPC URL"),
                    body: InvokeBody::Json(serde_json::json!({ "locale": tag })),
                    headers: HeaderMap::default(),
                    invoke_key: INVOKE_KEY.to_owned(),
                },
            )
            .expect("update locale command response");
            assert_eq!(shared_locale.get().tag, expected);
        }
    }
}
