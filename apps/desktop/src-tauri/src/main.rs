// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Hide the Windows console window on release builds; harmless elsewhere.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use desktop_shell::{build_app, run_app};
use persistence_db::Database;
use tauri::Manager;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

/// Delete rotated log files older than `max_age_days` (spec 051 US7, T042 —
/// the log directory must never grow unbounded, SC-006). Best-effort: a
/// failure to read the directory or remove a given file is logged and
/// otherwise ignored, never fatal to startup.
fn prune_old_logs(log_dir: &std::path::Path, max_age_days: u64) {
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };
    let max_age = std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);
    let now = std::time::SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else { continue };
        let Ok(age) = now.duration_since(modified) else { continue };
        if age > max_age {
            if let Err(e) = std::fs::remove_file(&path) {
                tracing::warn!(path = %path.display(), "failed to prune old log file: {e:?}");
            }
        }
    }
}

#[tokio::main]
async fn main() {
    // Build the Tauri app first so we can access the platform path resolver
    // (needed to locate the log directory before initialising tracing, and
    // the SQLite database path below). The event loop is NOT started yet —
    // that happens in `run_app` after the database is ready.
    let app = build_app();

    // Spec 051 US7 (T041/T042): structured logging with both a stderr target
    // (unchanged behavior, FR-021) and a rotating daily file target
    // alongside it (FR-022). `tracing_subscriber` owns the single global
    // `tracing`/`log`-facade logger slot for the whole process — see the
    // `tauri_plugin_log::Builder::new().skip_logger()` comment in
    // `build_app()` for why the plugin does not also try to install one.
    {
        let log_dir = app
            .path()
            .app_log_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("plate-vault-logs"));
        let _ = std::fs::create_dir_all(&log_dir);

        // Prune before creating today's writer so a just-rotated file from a
        // prior run doesn't briefly exist alongside an already-stale one.
        prune_old_logs(&log_dir, 14);

        let file_appender = tracing_appender::rolling::daily(&log_dir, "plate-vault.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        // Leak the guard so the background writer thread lives for the
        // entire process (dropping it would stop flushing to the file).
        std::mem::forget(guard);

        let env_filter = || {
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        };

        // `try_init` (via `try_init()` below) so a pre-existing subscriber
        // (e.g. a test harness) does not cause a panic.
        let _ = tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer().with_filter(env_filter()))
            .with(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(non_blocking)
                    .with_filter(env_filter()),
            )
            .try_init();

        tracing::info!(log_dir = %log_dir.display(), "diagnostics log file initialised");
    }

    // Resolve the platform app-data directory once: it backs both the SQLite
    // URL default (unless `ALM_DB_URL` overrides it) and the spec 052 P1
    // redb resolve-cache file (`simbad-cache.redb`, D2 — one global file,
    // independent of the `ALM_DB_URL` override so dev/test SQLite swaps don't
    // also relocate the resolve cache).
    let data_dir = app.path().app_data_dir().expect("failed to resolve platform data directory");
    std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");

    // `ALM_DB_URL` lets dev/test runs target an alternate SQLite store.
    let db_url = if let Ok(url) = std::env::var("ALM_DB_URL") {
        url
    } else {
        let db_path = data_dir.join("alm.db");
        format!("sqlite://{}?mode=rwc", db_path.display())
    };

    let db = Database::connect(&db_url).await.expect("connect SQLite");
    db.migrate().await.expect("run migrations");

    // Spec 052 P1 (D2): open (creating if missing) the shared redb resolve
    // cache. Opening is fast (no warm yet — `run_app` warms it in the
    // background so a large seed never blocks startup).
    let resolve_cache_path = data_dir.join("simbad-cache.redb");
    let resolve_cache = desktop_shell::resolve_cache::open_or_in_memory(&resolve_cache_path);

    run_app(app, db.pool().clone(), resolve_cache, resolve_cache_path);
}
