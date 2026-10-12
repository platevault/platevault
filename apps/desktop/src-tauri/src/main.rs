// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Hide the Windows console window on release builds; harmless elsewhere.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use desktop_services::{AppIdentity, Config, Services};
use desktop_shell::{build_app, run_app};

use tauri::Manager;

#[tokio::main]
async fn main() {
    // Build the Tauri app first so we can access the platform path resolver
    // (needed to locate the log directory before initialising tracing, and
    // the SQLite database path below). The event loop is NOT started yet —
    // that happens in `run_app`.
    let app = build_app();

    // Spec 051 US7 (T041/T042): structured logging to stdout and a rotating
    // daily file, installed by `desktop_services`. That subscriber owns the
    // single global `tracing`/`log`-facade logger slot for the whole process;
    // see the `tauri_plugin_log::Builder::new().skip_logger()` comment in
    // `build_app()` for why the plugin does not also try to install one.
    //
    // `PV_DATA_DIR` (issue #1204) relocates the whole app-data root, logs
    // included — otherwise concurrent E2E instances on Windows interleave
    // their lines into one shared daily log file, which is exactly the
    // evidence trail those runs exist to produce.
    let log_dir = desktop_shell::data_dir::resolve().map_or_else(
        || {
            app.path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("plate-vault-logs"))
        },
        |root| root.join("logs"),
    );
    let services = Services::start(&Config {
        identity: AppIdentity {
            identifier: app.config().identifier.clone(),
            development: tauri::is_dev(),
        },
        log_dir,
    });

    // Resolve the platform app-data directory once: it backs both the SQLite
    // URL default (unless `PV_DB_URL` overrides it) and the spec 052 P1
    // redb resolve-cache file (`simbad-cache.redb`, D2 — one global file,
    // independent of the `PV_DB_URL` override so dev/test SQLite swaps don't
    // also relocate the resolve cache).
    //
    // `PV_DATA_DIR` overrides it outright (issue #1204). The platform
    // resolver goes through `dirs`, which on Windows reads a Known Folder and
    // therefore ignores the `APPDATA`/`LOCALAPPDATA` overrides the E2E harness
    // sets — so concurrent instances there all landed on ONE real root and
    // fought over `simbad-cache.redb` ("Database already open. Cannot acquire
    // lock"). See `desktop_shell::data_dir`.
    let data_dir = desktop_shell::data_dir::resolve().unwrap_or_else(|| {
        app.path().app_data_dir().expect("failed to resolve platform data directory")
    });
    std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");

    // `PV_DB_URL` lets dev/test runs target an alternate SQLite store.
    let db_url = if let Ok(url) = std::env::var("PV_DB_URL") {
        url
    } else {
        let db_path = data_dir.join("alm.db");
        format!("sqlite://{}?mode=rwc", db_path.display())
    };

    // Connect + migrate happen inside `run_app`, on a task started once the
    // event loop is already pumping. Tauri creates config-declared windows
    // during `app.run()` rather than `.build()`, so doing that work here left
    // a long migration with no window on screen at all — not a blank window,
    // no window.
    run_app(app, db_url, data_dir, services);
}
