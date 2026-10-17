// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Desktop backend services that need no UI framework: OS notifications,
//! process logging, the log viewer stream, job-progress feeds, the updater,
//! the shipped locales' catalogues for text the backend shows itself and the
//! new-captures feed.
//!
//! The host owns the event loop and the windows and adapts these services to
//! its UI. It starts [`Services`] once, passes window state in as plain values
//! (focus, for notification suppression), forwards every [`channels::Feed`] to
//! its own event mechanism, and calls [`Services::shutdown`] from its exit
//! step. No Tauri framework crate (`tauri*`), `flutter_rust_bridge` or
//! `raw-window-handle` may appear in this crate's dependency graph
//! (`tests/dependency_boundary.rs`).

pub mod captures;
pub mod channels;
pub mod jobs;
pub mod locale;
pub mod log_stream;
mod logging;
pub mod notifications;
pub mod update;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use audit::bus::EventBus;
use tokio::task::AbortHandle;
use tracing_appender::non_blocking::WorkerGuard;

use crate::notifications::Notifier;

/// Bundle id macOS attributes a development build's notifications to.
const DEVELOPMENT_BUNDLE_ID: &str = "com.apple.Terminal";

/// The identity the OS attributes this application's notifications to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppIdentity {
    /// Reverse-DNS application identifier: the macOS bundle id and the
    /// Windows `AppUserModelID` the installer registers.
    pub identifier: String,
    /// An unbundled development build, which macOS knows no bundle for.
    pub development: bool,
}

impl AppIdentity {
    /// The bundle id macOS shows notifications under. A development binary is
    /// not a registered bundle, so it borrows the Terminal that launched it.
    #[must_use]
    pub fn macos_bundle_id(&self) -> &str {
        if self.development {
            DEVELOPMENT_BUNDLE_ID
        } else {
            &self.identifier
        }
    }

    /// The `AppUserModelID` Windows shows notifications under, or `None` for a
    /// binary run from a cargo `target/debug` or `target/release` directory,
    /// which no installer registered.
    #[must_use]
    pub fn windows_app_id(&self, exe_dir: &Path) -> Option<&str> {
        let unregistered = ["debug", "release"]
            .into_iter()
            .any(|profile| exe_dir.ends_with(Path::new("target").join(profile)));
        (!unregistered).then_some(self.identifier.as_str())
    }
}

/// What [`Services::start`] needs from the host.
#[derive(Clone, Debug)]
pub struct Config {
    pub identity: AppIdentity,
    /// Directory of the daily-rotating diagnostics log file.
    pub log_dir: PathBuf,
}

/// The running services of one process.
pub struct Services {
    identity: AppIdentity,
    notifier: Notifier,
    /// Flushes the log file when dropped; `None` when an earlier start in this
    /// process installed the logging.
    log: Mutex<Option<WorkerGuard>>,
    tasks: Mutex<Vec<AbortHandle>>,
}

impl Services {
    /// Install process logging and prepare notification delivery.
    ///
    /// Call once, before anything else logs. Process logging is installed by
    /// the first call only: a later call neither opens its own log directory
    /// nor replaces the process-wide `tracing` subscriber and its `log`-facade
    /// bridge.
    #[must_use]
    pub fn start(config: &Config) -> Self {
        Self {
            identity: config.identity.clone(),
            notifier: Notifier::new(&config.identity),
            log: Mutex::new(logging::init(&config.log_dir)),
            tasks: Mutex::default(),
        }
    }

    /// The identity the OS attributes this application's notifications to.
    #[must_use]
    pub const fn identity(&self) -> &AppIdentity {
        &self.identity
    }

    #[must_use]
    pub const fn notifier(&self) -> &Notifier {
        &self.notifier
    }

    /// Raise an OS notification for each completed plan apply and workflow
    /// run published on `bus`, reading window focus through `focused` at each
    /// one. Runs on the ambient tokio runtime until [`Self::shutdown`].
    pub fn spawn_completion_notifier(
        &self,
        bus: &EventBus,
        focused: impl Fn() -> Option<bool> + Send + 'static,
    ) {
        let task = notifications::spawn_completion_notifier(self.notifier.clone(), bus, focused);
        self.tasks.lock().unwrap_or_else(PoisonError::into_inner).push(task.abort_handle());
    }

    /// Stop the tasks these services started and flush the log file. Lines
    /// logged afterwards reach standard output only.
    pub fn shutdown(&self) {
        let tasks = std::mem::take(&mut *self.tasks.lock().unwrap_or_else(PoisonError::into_inner));
        for task in tasks {
            task.abort();
        }
        drop(self.log.lock().unwrap_or_else(PoisonError::into_inner).take());
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::AppIdentity;

    fn identity(development: bool) -> AppIdentity {
        AppIdentity { identifier: "dev.example.app".to_owned(), development }
    }

    #[test]
    fn a_bundled_build_notifies_under_its_own_bundle_id() {
        assert_eq!(identity(false).macos_bundle_id(), "dev.example.app");
    }

    #[test]
    fn a_development_build_notifies_under_terminal_on_macos() {
        assert_eq!(identity(true).macos_bundle_id(), "com.apple.Terminal");
    }

    #[test]
    fn an_installed_binary_notifies_under_its_app_user_model_id() {
        let installed = Path::new("C:").join("Program Files").join("PlateVault");
        assert_eq!(identity(false).windows_app_id(&installed), Some("dev.example.app"));
    }

    #[test]
    fn a_binary_in_a_cargo_target_directory_has_no_app_user_model_id() {
        for profile in ["debug", "release"] {
            let dir = Path::new("repo").join("target").join(profile);
            assert_eq!(identity(false).windows_app_id(&dir), None, "{}", dir.display());
        }
    }

    #[test]
    fn only_a_directory_named_target_counts_as_a_cargo_target_directory() {
        let dir = Path::new("repo").join("mytarget").join("release");
        assert_eq!(identity(false).windows_app_id(&dir), Some("dev.example.app"));
    }
}
