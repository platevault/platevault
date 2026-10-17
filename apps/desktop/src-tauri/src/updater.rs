// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The shell side of the signed updater (spec 051 US10, astro-plan-5wcib).
//!
//! The update flow lives in `desktop_services::update`. This module only
//! adapts it to Tauri: it builds the [`Updater`] from `tauri.conf.json`
//! (`plugins.updater`, which the bundler also reads to sign the release
//! artifacts), pushes every status change to the webview as
//! [`UPDATE_STATUS_EVENT`], starts the update offer in the system
//! notification ([`Offers`], astro-plan-c72oo) and pushes where each offer
//! was made as [`UPDATE_OFFER_EVENT`], relaunches or exits when an install
//! asks to, and routes quits through [`Updater::on_quit_requested`] so a
//! staged "Install on quit" runs first. The commands are in
//! `commands::update`.
//!
//! A quit from outside the app never reaches `ExitRequested` or the main
//! window's `CloseRequested`: the macOS Dock or app-switcher Quit
//! (`terminate:`), signing out or shutting down on any OS (Windows
//! `WM_ENDSESSION`, a Linux session's SIGTERM), a force quit or a crash. Such
//! a quit exits without installing, and the next launch's check offers the
//! update again.

use desktop_services::notifications::Notifier;
use desktop_services::update::offer::{self, Offers};
use desktop_services::update::{
    LaunchedApp, Package, Platform, QuitDecision, UpdateHost, Updater, UpdaterConfig,
};
use desktop_services::AppIdentity;
use semver::Version;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WindowEvent};

use crate::MAIN_WINDOW_LABEL;

/// Backend → webview: the current `UpdateStatus`, on every change.
pub const UPDATE_STATUS_EVENT: &str = "update:status";

/// Backend → webview: the current `UpdateOffer`, on every change.
pub const UPDATE_OFFER_EVENT: &str = "update:offer";

/// Hands installs back to the Tauri app.
struct TauriHost<R: Runtime> {
    app: AppHandle<R>,
    notifier: Notifier,
}

impl<R: Runtime> UpdateHost for TauriHost<R> {
    fn relaunch(&self) {
        // Through `ExitRequested` and `Exit`, so the clean-shutdown marker is
        // written and the log flushed before the new version starts.
        self.app.request_restart();
    }

    fn exit(&self) {
        self.app.exit(0);
    }

    fn notify(&self, title: &str, body: &str) {
        self.notifier.notify_before_exit(title, body);
    }
}

/// Build the updater and its offer, manage both, and start pushing their
/// state to the webview. `notifier` shows what an install at quit must tell
/// the user once the window is gone, the offer posts under `identity`, and
/// an install replaces the app `launched` names or nothing. A configuration
/// the updater cannot use is logged, and the app runs without updates.
pub fn register<R: Runtime>(
    app: &AppHandle<R>,
    notifier: Notifier,
    identity: &AppIdentity,
    launched: LaunchedApp,
) {
    let config = match updater_config(app.config(), current_version(app), launched) {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "updates are off: plugins.updater in tauri.conf.json is unusable");
            return;
        }
    };
    let updater = match Updater::new(config, TauriHost { app: app.clone(), notifier }) {
        Ok(updater) => updater,
        Err(error) => {
            tracing::error!(%error, "updates are off");
            return;
        }
    };
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.clone(),
        UPDATE_STATUS_EVENT,
        desktop_services::update::UpdatePort::status(&updater),
        |status, error| tracing::debug!(phase = ?status.phase, %error, "update status event not delivered"),
    ));
    let speaker = updater.clone();
    let (offers, offer_task) =
        Offers::new(updater.clone(), offer::platform(identity), move || speaker.locale());
    // On Tauri's runtime, as the feed forwards are; the port operations a
    // button runs are spawned from this task, so they run there too.
    tauri::async_runtime::spawn(offer_task);
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.clone(),
        UPDATE_OFFER_EVENT,
        offers.feed(),
        // At warn: the webview falls back to its in-app notice only once
        // the offer has gone unanswered past its deadline.
        |offer, error| tracing::warn!(channel = ?offer.channel, %error, "update offer event not delivered"),
    ));
    app.manage(offers);
    app.manage(updater);
}

/// Route quits through the updater: a staged install on quit holds the first
/// quit while it installs, and later quits while it runs.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } if quit_deferred(app) => api.prevent_exit(),
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. }
            if label == MAIN_WINDOW_LABEL && quit_deferred(app) =>
        {
            api.prevent_close();
        }
        _ => {}
    }
}

fn quit_deferred<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Updater>()
        .is_some_and(|updater| updater.on_quit_requested() == QuitDecision::Defer)
}

/// The running version, or with the `dev-tools` feature the version in
/// `PV_E2E_VERSION_OVERRIDE`, so a journey run can see an older "current"
/// version and reach "update available" against the real endpoint. Release
/// binaries do not contain the override.
fn current_version<R: Runtime>(app: &AppHandle<R>) -> Version {
    #[cfg(feature = "dev-tools")]
    if let Ok(spoofed) = std::env::var("PV_E2E_VERSION_OVERRIDE") {
        if let Ok(version) = spoofed.parse::<Version>() {
            tracing::info!(PV_E2E_VERSION_OVERRIDE = %version, "updater version override active");
            return version;
        }
        tracing::warn!(
            PV_E2E_VERSION_OVERRIDE = %spoofed,
            "invalid semver in PV_E2E_VERSION_OVERRIDE; using the real version"
        );
    }
    app.package_info().version.clone()
}

/// The updater settings in `config` (`plugins.updater.pubkey` and
/// `.endpoints`), for the package this binary was bundled as, launched from
/// where `launched` says.
fn updater_config(
    config: &tauri::Config,
    current_version: Version,
    launched: LaunchedApp,
) -> Result<UpdaterConfig, String> {
    let updater = config.plugins.0.get("updater").ok_or("plugins.updater is missing")?;
    let public_key = updater
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or("plugins.updater.pubkey is missing")?;
    let endpoints = updater
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .ok_or("plugins.updater.endpoints is missing")?
        .iter()
        .map(|endpoint| endpoint.as_str().map(str::to_owned).ok_or("an endpoint is not a string"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(UpdaterConfig {
        current_version,
        endpoints,
        public_key: public_key.to_owned(),
        platform: Platform::current(package(bundle_type())),
        launched,
    })
}

/// The updater's name for the bundle the Tauri bundler built this binary
/// into; `None` for a binary no bundler touched.
fn package(bundle: Option<BundleType>) -> Option<Package> {
    match bundle? {
        BundleType::App | BundleType::Dmg => Some(Package::App),
        BundleType::AppImage => Some(Package::AppImage),
        BundleType::Deb => Some(Package::Deb),
        BundleType::Rpm => Some(Package::Rpm),
        BundleType::Nsis => Some(Package::Nsis),
        BundleType::Msi => Some(Package::Msi),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoHost;

    impl UpdateHost for NoHost {
        fn relaunch(&self) {}
        fn exit(&self) {}
        fn notify(&self, _title: &str, _body: &str) {}
    }

    #[test]
    fn the_shipped_config_builds_an_updater() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let updater_config = updater_config(&config, Version::new(0, 6, 0), LaunchedApp::record())
            .expect("plugins.updater");
        assert_eq!(
            updater_config.endpoints,
            ["https://github.com/platevault/platevault/releases/latest/download/latest.json"]
        );
        assert!(Updater::new(updater_config, NoHost).is_ok());
    }

    #[test]
    fn every_bundle_maps_to_its_package() {
        let cases = [
            (BundleType::App, Package::App),
            (BundleType::Dmg, Package::App),
            (BundleType::AppImage, Package::AppImage),
            (BundleType::Deb, Package::Deb),
            (BundleType::Rpm, Package::Rpm),
            (BundleType::Nsis, Package::Nsis),
            (BundleType::Msi, Package::Msi),
        ];
        for (bundle, expected) in cases {
            assert_eq!(package(Some(bundle.clone())), Some(expected), "{bundle:?}");
        }
        assert_eq!(package(None), None);
    }
}
