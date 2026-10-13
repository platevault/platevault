// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Install-on-quit exit gate (astro-plan-mkkgi).
//!
//! "Install on quit" downloads and signature-verifies the update in the main
//! webview (`apps/desktop/src/data/updateSubscription.ts`), where the
//! updater plugin keeps the verified bytes as a webview resource. Installing
//! them needs that webview alive, so once the download succeeds the frontend
//! arms this gate. The next quit is then deferred once: a native Quit
//! (`app.exit`) or a close of the main window is prevented, and the main
//! window is told to install. The frontend installs and calls the process
//! plugin's `exit()`, which arrives here disarmed and proceeds.
//!
//! The gate is consumed by the first deferral, so a second quit always
//! proceeds: a frontend that never answers cannot trap the user in the app.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, Runtime, WindowEvent};

use crate::MAIN_WINDOW_LABEL;

/// Frontend → backend: payload `true` arms the gate, `false` disarms it.
pub const ARM_EVENT: &str = "update:install-on-quit-armed";
/// Backend → main window: the user is quitting; install, then exit.
pub const INSTALL_EVENT: &str = "update:install-on-quit";

/// Managed flag: an update is downloaded, verified and waiting for the quit.
#[derive(Default)]
struct InstallOnQuitGate(AtomicBool);

/// Manage the gate and listen for the frontend's arm/disarm event.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    app.manage(InstallOnQuitGate::default());
    let handle = app.clone();
    app.listen(ARM_EVENT, move |event| {
        let armed = serde_json::from_str::<bool>(event.payload()).unwrap_or(false);
        handle
            .state::<InstallOnQuitGate>()
            .0
            .store(armed, Ordering::SeqCst);
    });
}

/// Defer the first quit after arming: prevent it and hand it to the frontend.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } => {
            if defer_to_frontend(app) {
                api.prevent_exit();
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == MAIN_WINDOW_LABEL => {
            if defer_to_frontend(app) {
                api.prevent_close();
            }
        }
        _ => {}
    }
}

/// Consume an armed gate and ask the main window to install. `true` when the
/// window was told, so the caller must stop this quit.
fn defer_to_frontend<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(gate) = app.try_state::<InstallOnQuitGate>() else {
        return false;
    };
    if !gate.0.swap(false, Ordering::SeqCst) {
        return false;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return false;
    };
    match window.emit(INSTALL_EVENT, ()) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!("failed to emit {INSTALL_EVENT}: {e:?}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{App, WebviewUrl, WebviewWindowBuilder};

    use super::*;

    /// A mock app with the gate registered, a main window, and a counter of
    /// the install requests that window received.
    fn app_with_main_window() -> (App<MockRuntime>, Arc<AtomicUsize>) {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        register(app.handle());
        WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, WebviewUrl::default())
            .build()
            .expect("build main window");
        let installs = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&installs);
        app.listen(INSTALL_EVENT, move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
        });
        (app, installs)
    }

    #[test]
    fn unarmed_gate_never_defers_a_quit() {
        let (app, installs) = app_with_main_window();

        assert!(!defer_to_frontend(app.handle()));
        assert_eq!(installs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn armed_gate_defers_exactly_one_quit_to_the_main_window() {
        let (app, installs) = app_with_main_window();
        app.emit(ARM_EVENT, true).expect("arm");

        assert!(defer_to_frontend(app.handle()), "first quit is deferred");
        assert!(!defer_to_frontend(app.handle()), "second quit proceeds");
        assert_eq!(installs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn disarmed_gate_lets_the_quit_proceed() {
        let (app, installs) = app_with_main_window();
        app.emit(ARM_EVENT, true).expect("arm");
        app.emit(ARM_EVENT, false).expect("disarm");

        assert!(!defer_to_frontend(app.handle()));
        assert_eq!(installs.load(Ordering::SeqCst), 0);
    }
}
