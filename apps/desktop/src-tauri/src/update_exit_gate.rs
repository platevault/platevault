// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Install-on-quit exit gate (astro-plan-mkkgi).
//!
//! "Install on quit" downloads and signature-verifies the update in the main
//! webview (`apps/desktop/src/data/updateSubscription.ts`), where the updater
//! plugin keeps the verified bytes as a webview resource. Installing them
//! needs that webview alive, so once the download succeeds the frontend arms
//! this gate, and the gate runs a small state machine:
//!
//! - **Idle → Armed** on [`ARM_EVENT`] `true` (and back on `false`).
//! - **Armed → Installing** on the next quit: an `app.exit` (the app-menu
//!   Quit, see `bootstrap/menu.rs`) or a close of the main window. The quit is
//!   prevented, the main window is sent [`INSTALL_EVENT`], and a watchdog
//!   starts.
//! - **Installing, not acknowledged:** the frontend answers with
//!   [`STARTED_EVENT`] before it calls `install()`. Without that answer within
//!   [`ACK_TIMEOUT`] the watchdog exits the app, and a further quit exits at
//!   once, so a frontend that never answers cannot trap the user.
//! - **Installing, acknowledged:** every further quit is blocked, because an
//!   `AppImage` install renames the running image before writing the new one
//!   (tauri-plugin-updater `updater.rs:1003-1040`) and exiting in between
//!   leaves no app at the original path. The frontend sends
//!   [`FINISHED_EVENT`] (back to Idle) and then exits; if it never does, the
//!   watchdog exits after [`INSTALL_CEILING`].
//!
//! Quits that never reach `ExitRequested` bypass the gate: on macOS the Dock's
//! Quit and logout send `terminate:`, which tao turns straight into
//! `RunEvent::Exit`. The verified bytes are dropped, nothing is installed,
//! and a later check offers the update again.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, Runtime, WindowEvent};

use crate::MAIN_WINDOW_LABEL;

/// Frontend → backend: payload `true` arms the gate, `false` disarms it.
pub const ARM_EVENT: &str = "update:install-on-quit-armed";
/// Backend → main window: the user is quitting; install, then exit.
pub const INSTALL_EVENT: &str = "update:install-on-quit";
/// Frontend → backend: the install is starting; hold further quits.
pub const STARTED_EVENT: &str = "update:install-on-quit-started";
/// Frontend → backend: the install is over (either way); the next quit exits.
pub const FINISHED_EVENT: &str = "update:install-on-quit-finished";

/// How long the main window has to acknowledge [`INSTALL_EVENT`]. The
/// frontend only unhooks a listener and sends one event before answering, so
/// a few seconds means it is gone (reloaded, or its webview is wedged).
const ACK_TIMEOUT: Duration = Duration::from_secs(5);

/// The longest an acknowledged install may hold the quit. Chosen for the
/// slowest legitimate case, deb/rpm: `install()` blocks on a pkexec/polkit
/// password prompt and, when that fails, a second zenity/kdialog prompt
/// (`updater.rs:1106-1146`), each waiting for the user. Five minutes covers
/// both prompts and the dpkg/rpm run with room to spare. The `AppImage`
/// rename-then-write window is one local file write of the update, seconds at
/// most. Exiting after the ceiling during a deb/rpm prompt is safe: pkexec and
/// dpkg/rpm are separate processes that finish on their own.
const INSTALL_CEILING: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Armed,
    Installing { acknowledged: bool },
}

#[derive(Debug)]
struct State {
    phase: Phase,
    /// Bumped on every deferral, so a watchdog only acts on its own install.
    generation: u64,
}

struct Gate {
    state: Mutex<State>,
    ack_timeout: Duration,
    ceiling: Duration,
    /// Exits the app when the watchdog gives up on the frontend.
    exit: Box<dyn Fn() + Send + Sync>,
    /// Where the clean-shutdown marker lives (written on Windows only).
    #[cfg_attr(not(windows), allow(dead_code))]
    data_dir: PathBuf,
}

/// Managed handle so run-event and listener callbacks reach the one gate.
struct InstallOnQuitGate(Arc<Gate>);

impl Gate {
    fn new(
        data_dir: PathBuf,
        ack_timeout: Duration,
        ceiling: Duration,
        exit: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Mutex::new(State { phase: Phase::Idle, generation: 0 }),
            ack_timeout,
            ceiling,
            exit: Box::new(exit),
            data_dir,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[cfg(test)]
    fn phase(&self) -> Phase {
        self.lock().phase
    }

    /// Arm or disarm. An install already under way is left alone.
    fn set_armed(&self, armed: bool) {
        let mut state = self.lock();
        state.phase = match (state.phase, armed) {
            (Phase::Idle, true) => Phase::Armed,
            (Phase::Armed, false) => Phase::Idle,
            (phase, _) => phase,
        };
    }

    fn acknowledge(&self) {
        let mut state = self.lock();
        if state.phase == (Phase::Installing { acknowledged: false }) {
            state.phase = Phase::Installing { acknowledged: true };
        }
    }

    fn finish(&self) {
        let mut state = self.lock();
        if matches!(state.phase, Phase::Installing { .. }) {
            state.phase = Phase::Idle;
        }
    }

    /// Decide a quit. `notify` tells the main window to install and reports
    /// whether it could. Returns `true` when the quit must be prevented.
    fn on_quit(self: &Arc<Self>, notify: impl FnOnce() -> bool) -> bool {
        let generation = {
            let mut state = self.lock();
            match state.phase {
                Phase::Idle => return false,
                Phase::Installing { acknowledged: true } => return true,
                Phase::Installing { acknowledged: false } => {
                    // The frontend has not started installing: let the user out.
                    state.phase = Phase::Idle;
                    return false;
                }
                Phase::Armed => {
                    state.generation += 1;
                    state.phase = Phase::Installing { acknowledged: false };
                    state.generation
                }
            }
        };

        // On Windows `install()` runs the installer and calls
        // `std::process::exit(0)`, so `RunEvent::Exit` (which writes the
        // clean-shutdown marker) never fires for this deliberate quit.
        #[cfg(windows)]
        crate::clean_shutdown::write(&self.data_dir);

        if !notify() {
            self.expire(generation, |_| true);
            return false;
        }
        self.spawn_watchdog(generation);
        true
    }

    /// Return to Idle if install `generation` is still Installing with an
    /// acknowledgement `expirable` accepts. `true` when it did, so the caller
    /// should exit.
    fn expire(&self, generation: u64, expirable: impl Fn(bool) -> bool) -> bool {
        let mut state = self.lock();
        let expired = state.generation == generation
            && matches!(state.phase, Phase::Installing { acknowledged } if expirable(acknowledged));
        if expired {
            state.phase = Phase::Idle;
        }
        expired
    }

    fn spawn_watchdog(self: &Arc<Self>, generation: u64) {
        let gate = Arc::clone(self);
        std::thread::spawn(move || {
            std::thread::sleep(gate.ack_timeout);
            if gate.expire(generation, |acknowledged| !acknowledged) {
                tracing::warn!("update install on quit was never acknowledged; exiting");
                (gate.exit)();
                return;
            }
            std::thread::sleep(gate.ceiling.saturating_sub(gate.ack_timeout));
            if gate.expire(generation, |_| true) {
                tracing::warn!("update install on quit passed {:?}; exiting", gate.ceiling);
                (gate.exit)();
            }
        });
    }
}

/// Manage the gate and listen for the frontend's arm, start and finish events.
pub fn register<R: Runtime>(app: &AppHandle<R>, data_dir: PathBuf) {
    let handle = app.clone();
    let gate = Gate::new(data_dir, ACK_TIMEOUT, INSTALL_CEILING, move || handle.exit(0));
    register_gate(app, gate);
}

fn register_gate<R: Runtime>(app: &AppHandle<R>, gate: Gate) {
    let gate = Arc::new(gate);
    app.manage(InstallOnQuitGate(Arc::clone(&gate)));

    let armed = Arc::clone(&gate);
    app.listen(ARM_EVENT, move |event| {
        armed.set_armed(serde_json::from_str::<bool>(event.payload()).unwrap_or(false));
    });
    let started = Arc::clone(&gate);
    app.listen(STARTED_EVENT, move |_| started.acknowledge());
    app.listen(FINISHED_EVENT, move |_| gate.finish());
}

/// Route quits through the gate: defer the first armed quit to the frontend,
/// and hold later ones while it installs.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } => gate_quit(app, || api.prevent_exit()),
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. }
            if label == MAIN_WINDOW_LABEL =>
        {
            gate_quit(app, || api.prevent_close());
        }
        _ => {}
    }
}

/// Run `prevent` when the gate holds this quit.
fn gate_quit<R: Runtime>(app: &AppHandle<R>, prevent: impl FnOnce()) {
    let Some(gate) = app.try_state::<InstallOnQuitGate>() else {
        return;
    };
    if gate.0.on_quit(|| notify_main_window(app)) {
        prevent();
    }
}

/// Ask the main window to install. `false` when it cannot be told.
fn notify_main_window<R: Runtime>(app: &AppHandle<R>) -> bool {
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    use super::*;

    const LONG: Duration = Duration::from_secs(3600);
    const SHORT: Duration = Duration::from_millis(50);

    /// A gate with the given timeouts and a counter of watchdog exits.
    fn new_gate(ack: Duration, ceiling: Duration) -> (Gate, Arc<AtomicUsize>) {
        let exits = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&exits);
        let gate = Gate::new(PathBuf::new(), ack, ceiling, move || {
            counted.fetch_add(1, Ordering::SeqCst);
        });
        (gate, exits)
    }

    fn gate(ack: Duration, ceiling: Duration) -> (Arc<Gate>, Arc<AtomicUsize>) {
        let (gate, exits) = new_gate(ack, ceiling);
        (Arc::new(gate), exits)
    }

    #[test]
    fn unarmed_and_disarmed_gates_never_defer_a_quit() {
        let (gate, _) = gate(LONG, LONG);
        assert!(!gate.on_quit(|| panic!("an idle gate must not notify")));

        gate.set_armed(true);
        gate.set_armed(false);
        assert!(!gate.on_quit(|| panic!("a disarmed gate must not notify")));
    }

    #[test]
    fn an_unacknowledged_deferral_lets_the_next_quit_through() {
        let (gate, _) = gate(LONG, LONG);
        gate.set_armed(true);

        assert!(gate.on_quit(|| true), "first quit is deferred");
        assert!(!gate.on_quit(|| true), "the frontend never answered: second quit exits");
        assert_eq!(gate.phase(), Phase::Idle);
    }

    #[test]
    fn an_acknowledged_install_blocks_quits_until_it_finishes() {
        let (gate, _) = gate(LONG, LONG);
        gate.set_armed(true);
        assert!(gate.on_quit(|| true));
        gate.acknowledge();

        assert!(gate.on_quit(|| true), "quit during the install is blocked");
        gate.set_armed(false);
        assert!(gate.on_quit(|| true), "a stray disarm does not release the hold");

        gate.finish();
        assert!(!gate.on_quit(|| true), "after finishing, the quit exits");
    }

    #[test]
    fn a_failed_notification_lets_the_quit_through() {
        let (gate, _) = gate(LONG, LONG);
        gate.set_armed(true);

        assert!(!gate.on_quit(|| false));
        assert_eq!(gate.phase(), Phase::Idle);
    }

    #[test]
    fn the_watchdog_exits_when_the_frontend_never_acknowledges() {
        let (gate, exits) = gate(SHORT, LONG);
        gate.set_armed(true);
        assert!(gate.on_quit(|| true));

        std::thread::sleep(SHORT * 5);

        assert_eq!(exits.load(Ordering::SeqCst), 1);
        assert_eq!(gate.phase(), Phase::Idle);
    }

    #[test]
    fn the_watchdog_waits_for_an_acknowledged_install_up_to_the_ceiling() {
        let (gate, exits) = gate(SHORT, SHORT * 6);
        gate.set_armed(true);
        assert!(gate.on_quit(|| true));
        gate.acknowledge();

        std::thread::sleep(SHORT * 3);
        assert_eq!(exits.load(Ordering::SeqCst), 0, "acknowledged: no exit at the ack timeout");

        std::thread::sleep(SHORT * 6);
        assert_eq!(exits.load(Ordering::SeqCst), 1, "the ceiling exits");
    }

    #[test]
    fn the_watchdog_does_nothing_once_the_install_finished() {
        let (gate, exits) = gate(SHORT, SHORT * 2);
        gate.set_armed(true);
        assert!(gate.on_quit(|| true));
        gate.acknowledge();
        gate.finish();

        std::thread::sleep(SHORT * 5);

        assert_eq!(exits.load(Ordering::SeqCst), 0);
    }

    /// Drives `on_run_event` through tauri's mock event loop: closing the
    /// main window is deferred to the frontend, a close during the install is
    /// blocked, and the close after the install finishes ends the loop.
    #[test]
    fn on_run_event_defers_then_holds_then_releases_main_window_closes() {
        let app = mock_builder().build(mock_context(noop_assets())).expect("build mock app");
        let (gate, exits) = new_gate(LONG, LONG);
        register_gate(app.handle(), gate);
        WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, WebviewUrl::default())
            .build()
            .expect("build main window");

        let installs = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&installs);
        app.listen(INSTALL_EVENT, move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
        });
        app.emit(ARM_EVENT, true).expect("arm");

        let closes = Arc::new(AtomicUsize::new(0));
        let closes_seen = Arc::clone(&closes);
        let exited = Arc::new(AtomicBool::new(false));
        let exited_seen = Arc::clone(&exited);
        let mut step = 0;
        let mut iterations = 0;
        app.run_return(move |handle, event| {
            on_run_event(handle, &event);
            let main = handle.get_webview_window(MAIN_WINDOW_LABEL);
            match (event, main) {
                // The mock removes a window closed before the loop runs without
                // any event, so the user's first quit happens once it runs.
                (RunEvent::Ready, Some(main)) => main.close().expect("first close"),
                (RunEvent::WindowEvent { event: WindowEvent::CloseRequested { .. }, .. }, _) => {
                    closes_seen.fetch_add(1, Ordering::SeqCst);
                }
                (RunEvent::Exit, _) => exited_seen.store(true, Ordering::SeqCst),
                (RunEvent::MainEventsCleared, main) => {
                    iterations += 1;
                    assert!(iterations < 10, "the mock loop never ended");
                    match (step, main) {
                        // Deferred: the frontend starts installing, the user quits again.
                        (0, Some(main)) => {
                            handle.emit(STARTED_EVENT, ()).expect("ack");
                            main.close().expect("second close");
                            step = 1;
                        }
                        // Held: the frontend finishes and quits.
                        (1, Some(main)) => {
                            handle.emit(FINISHED_EVENT, ()).expect("finish");
                            main.close().expect("third close");
                            step = 2;
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        });

        assert_eq!(installs.load(Ordering::SeqCst), 1, "the frontend was asked once");
        assert_eq!(closes.load(Ordering::SeqCst), 3, "deferred, held, then released");
        assert!(exited.load(Ordering::SeqCst));
        assert_eq!(exits.load(Ordering::SeqCst), 0, "the watchdog never fired");
    }
}
