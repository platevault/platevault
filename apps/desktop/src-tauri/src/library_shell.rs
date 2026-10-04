// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated rebuilt library shell (spec 064): its own Tauri runtime over the
//! clean catalog.
//!
//! It boots only [`Library`] and the [`crate::commands::library`] IPC surface,
//! with the catalog in its own data directory. Nothing from the legacy
//! composition root runs here: no `AppState`, legacy database, bootstrap job,
//! watcher or legacy command registration. The legacy code stays archivable and
//! is never booted by this binary.
//!
//! In `dev-tools` (debug-only) builds the MCP bridge always starts, bound to IPv4
//! loopback, and the webview loads the hosted dev URL so the bridge has a page
//! to drive. That page is the legacy React app calling commands this shell does
//! not register, so it proves no frontend acceptance:
//!
//! ```text
//! pnpm --filter @astro-plan/desktop dev
//! cargo run -p desktop_shell --features dev-tools --bin platevault-library
//! ```

#[cfg(all(feature = "dev-tools", not(debug_assertions)))]
compile_error!(
    "the library shell's MCP bridge is a debug-only development surface; \
     release builds must not enable `dev-tools`"
);

use std::collections::{HashMap, HashSet};
use std::error::Error;
#[cfg(feature = "dev-tools")]
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::targets::SimbadConfig;
use platevault_core::{LibraryError, NativePath, Revision, ScanOperation, ScanProgress, ScanState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::commands::library as ipc;

/// Catalog directory override, used verbatim.
pub const DATA_DIR_ENV: &str = "PV_LIBRARY_DATA_DIR";
/// Catalog directory under the platform app-data directory by default.
pub const DATA_SUBDIR: &str = "library-rebuild";
/// Catalog database file inside the data directory.
pub const CATALOG_FILE: &str = "catalog.sqlite";
/// SIMBAD TAP endpoint. Unset keeps target resolution explicitly offline
/// (`ProviderUnavailable`) while seed and saved target search stay local.
pub const SIMBAD_ENDPOINT_ENV: &str = "PV_LIBRARY_SIMBAD_ENDPOINT";
/// Committed scan snapshots; polling `library_scan_status` stays the durable truth.
pub const SCAN_PROGRESS_EVENT: &str = "library_scan_progress";
/// Optional IPv4 loopback address for the development bridge.
#[cfg(feature = "dev-tools")]
pub const BRIDGE_BIND_ENV: &str = "PV_MCP_BRIDGE_BIND";

/// Newest operations re-read from durable status after the progress channel lagged.
const RESYNC_PAGE: u32 = 64;

/// Build the shell, open its catalog and run the event loop.
///
/// # Errors
/// Every startup failure: a refused bridge address, invalid provider
/// configuration, an unusable data directory, a catalog that cannot be opened
/// (including a foreign or legacy database) or the Tauri runtime itself.
pub fn run() -> Result<(), Box<dyn Error>> {
    let provider = provider_config()?;
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        ipc::library_register_location,
        ipc::library_list_locations,
        ipc::library_start_scan,
        ipc::library_scan_status,
        ipc::library_cancel_scan,
        ipc::library_list_sessions,
        ipc::library_session,
        ipc::library_preview_metadata,
        ipc::library_confirm_metadata,
        ipc::library_set_quality,
        ipc::library_search_targets,
        ipc::library_resolve_target,
        ipc::library_save_target,
        ipc::library_associate_target,
        ipc::library_save_equipment,
        ipc::library_confirm_equipment,
        ipc::library_target_coverage,
        ipc::library_review_remap,
        ipc::library_apply_remap,
        ipc::library_update_location,
        ipc::library_retry_scope,
        ipc::library_reselect_location,
        ipc::library_review_retire_location,
        ipc::library_retire_location,
        ipc::library_list_operations,
    ]);
    #[cfg(feature = "dev-tools")]
    let builder = builder.plugin(dev_bridge(std::env::var(BRIDGE_BIND_ENV).ok().as_deref())?);

    // Windows are created when the event loop starts, so the catalog is open
    // and managed before any webview can invoke a command.
    let app = builder.build(context())?;
    let catalog = catalog_path(&app)?;
    let library = tauri::async_runtime::block_on(Library::open(&catalog, provider.as_ref()))
        .map_err(|error| format!("cannot open library catalog {}: {error}", catalog.display()))?;
    tracing::info!(
        catalog = %catalog.display(),
        online_provider = provider.is_some(),
        "library catalog opened"
    );
    ProgressBridge::spawn(app.handle().clone(), Arc::clone(&library));
    app.manage(library);
    app.run(|_, _| {});
    Ok(())
}

// Tauri reads only a canonically named config: given `tauri.library.conf.json`
// it silently embedded the sibling legacy `tauri.conf.json`, splash window
// included. Each shell config therefore lives in its own directory.
// `test = true` only skips the dev-mode macOS `Info.plist` embed. That embed
// defines the global `_EMBED_INFO_PLIST` symbol, and the legacy context in this
// crate already defines it, so a second embed fails to link.
#[cfg(feature = "dev-tools")]
fn context() -> tauri::Context {
    tauri::generate_context!("library-dev/tauri.conf.json", test = true)
}

#[cfg(not(feature = "dev-tools"))]
fn context() -> tauri::Context {
    tauri::generate_context!("library/tauri.conf.json", test = true)
}

/// `PV_LIBRARY_DATA_DIR` verbatim, else `<app data>/library-rebuild`, created if absent.
fn catalog_path(app: &tauri::App) -> Result<PathBuf, Box<dyn Error>> {
    let dir = match std::env::var_os(DATA_DIR_ENV).filter(|dir| !dir.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir()?.join(DATA_SUBDIR),
    };
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!("cannot create library data directory {}: {error}", dir.display())
    })?;
    Ok(dir.join(CATALOG_FILE))
}

/// Online provider only when an endpoint is configured; no configuration is
/// the explicit offline state, not a startup error.
fn provider_config() -> Result<Option<SimbadConfig>, String> {
    match std::env::var(SIMBAD_ENDPOINT_ENV) {
        Ok(endpoint) if !endpoint.trim().is_empty() => Ok(Some(SimbadConfig {
            endpoint: endpoint.trim().to_owned(),
            ..SimbadConfig::default()
        })),
        Ok(_) | Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(format!("{SIMBAD_ENDPOINT_ENV} is not valid UTF-8"))
        }
    }
}

/// The unauthenticated MCP bridge reaches every command handler, so it binds
/// loopback whatever the environment says.
#[cfg(feature = "dev-tools")]
fn dev_bridge(requested: Option<&str>) -> Result<tauri::plugin::TauriPlugin<tauri::Wry>, String> {
    let bind = loopback_bind(requested)?;
    tracing::info!(%bind, "MCP bridge starting (library shell, loopback only)");
    Ok(tauri_plugin_mcp_bridge::init_with_config(tauri_plugin_mcp_bridge::Config::new(
        &bind.to_string(),
    )))
}

/// Unset or blank means `127.0.0.1`; anything else must be an IPv4 loopback
/// literal. IPv6 is refused because the plugin binds `"{addr}:{port}"`, which
/// cannot spell an IPv6 socket address.
#[cfg(feature = "dev-tools")]
fn loopback_bind(requested: Option<&str>) -> Result<Ipv4Addr, String> {
    let Some(raw) = requested.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(Ipv4Addr::LOCALHOST);
    };
    match raw.parse::<Ipv4Addr>() {
        Ok(addr) if addr.is_loopback() => Ok(addr),
        _ => Err(format!(
            "{BRIDGE_BIND_ENV}={raw:?} is not an IPv4 loopback address; the library shell \
             binds its development bridge to loopback only"
        )),
    }
}

/// [`SCAN_PROGRESS_EVENT`] payload: one committed operation snapshot.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgressEvent<'a> {
    operation_id: Uuid,
    revision: Revision,
    location_id: Uuid,
    state: ScanState,
    progress: &'a ScanProgress,
    complete_scopes: &'a [NativePath],
    incomplete_scopes: &'a [NativePath],
}

/// Forwards committed scan snapshots to the webview. After broadcast lag it
/// re-reads durable status; per-operation revisions keep it from emitting an
/// older snapshot after a newer one.
struct ProgressBridge {
    app: AppHandle,
    library: Arc<Library>,
    emitted: HashMap<Uuid, Revision>,
}

impl ProgressBridge {
    fn spawn(app: AppHandle, library: Arc<Library>) {
        let mut events = library.subscribe_scan_progress();
        let mut bridge = Self { app, library, emitted: HashMap::new() };
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(operation) => bridge.forward(&operation, true),
                    Err(RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "scan progress lagged; re-reading durable status");
                        if let Err(error) = bridge.resync().await {
                            tracing::error!(
                                %error,
                                "scan progress resync failed; clients must poll library_scan_status"
                            );
                        }
                    }
                    Err(RecvError::Closed) => return,
                }
            }
        });
    }

    /// Emit unless a same-or-newer revision of the operation was emitted. A
    /// terminal snapshot from the channel is its operation's last message, so
    /// the operation stops being tracked.
    fn forward(&mut self, operation: &ScanOperation, from_channel: bool) {
        let newer = self.emitted.get(&operation.id).is_none_or(|&seen| operation.revision > seen);
        if from_channel && operation.state != ScanState::Running {
            self.emitted.remove(&operation.id);
        } else if newer {
            self.emitted.insert(operation.id, operation.revision);
        }
        if !newer {
            return;
        }
        let event = ScanProgressEvent {
            operation_id: operation.id,
            revision: operation.revision,
            location_id: operation.location_id,
            state: operation.state,
            progress: &operation.progress,
            complete_scopes: &operation.complete_scopes,
            incomplete_scopes: &operation.incomplete_scopes,
        };
        if let Err(error) = self.app.emit(SCAN_PROGRESS_EVENT, event) {
            tracing::error!(operation = %operation.id, %error, "scan progress event not delivered");
        }
    }

    /// Re-emit durable status of every tracked operation and of Running ones
    /// among the newest; anything else missed is recovered by polling.
    async fn resync(&mut self) -> Result<(), LibraryError> {
        let library = Arc::clone(&self.library);
        let catalog = library.catalog();
        let recent = catalog.list_operations(None, 0, RESYNC_PAGE).await?;
        let mut refreshed = HashSet::with_capacity(recent.len());
        for operation in &recent {
            if operation.state == ScanState::Running || self.emitted.contains_key(&operation.id) {
                refreshed.insert(operation.id);
                self.forward(operation, false);
            }
        }
        let older =
            self.emitted.keys().filter(|id| !refreshed.contains(*id)).copied().collect::<Vec<_>>();
        for id in older {
            self.forward(&catalog.scan_status(id).await?, false);
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "dev-tools"))]
mod tests {
    use std::net::Ipv4Addr;

    use super::loopback_bind;

    /// Only IPv4 loopback literals pass. Unspecified, private, IPv6 (including
    /// `::1` and v4-mapped loopback), hostnames and socket addresses are refused.
    #[test]
    fn bridge_binds_ipv4_loopback_only() {
        for unset in [None, Some(""), Some("   ")] {
            assert_eq!(loopback_bind(unset), Ok(Ipv4Addr::LOCALHOST), "{unset:?}");
        }
        assert_eq!(loopback_bind(Some(" 127.0.0.2 ")), Ok(Ipv4Addr::new(127, 0, 0, 2)));
        for refused in [
            "0.0.0.0",
            "192.168.1.20",
            "::1",
            "::ffff:127.0.0.1",
            "localhost",
            "127.0.0.1:9223",
            "127.000.000.001",
        ] {
            assert!(loopback_bind(Some(refused)).is_err(), "{refused} must be refused");
        }
    }
}
