// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated rebuilt library shell (spec 064): its own Tauri runtime over the
//! clean catalog.
//!
//! It boots only [`Library`] and the [`crate::commands::library`] and
//! [`crate::commands::observing_plans`] IPC surfaces, with the catalog in its
//! own data directory. The dialog and opener plugins serve the planning
//! handlers' Rust calls, and the platform reminder notifier with the system
//! clock is attached before any command runs. The one window is labelled
//! `library`, so it holds `capabilities/library.json` (plus the dev bridge
//! grant with `dev-tools`) and none of the legacy `default.json`. Nothing from
//! the legacy composition root runs here: no `AppState`, legacy database,
//! bootstrap job, watcher or legacy command registration. The legacy code stays
//! archivable and is never booted by this binary.
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

use std::collections::{HashMap, HashSet, VecDeque};
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
/// Catalog directory under the platform app-data directory by default. That
/// directory follows the config identifier, and `library-dev` has its own, so
/// a `dev-tools` build never opens the shipped library shell's catalog.
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
/// Most recent terminal snapshots a resync recovered whose channel terminal has
/// not arrived yet; older ones are forgotten so a lost terminal cannot leak.
const RETAINED_FINISHED: usize = 256;

/// Build the shell, open its catalog and run the event loop.
///
/// # Errors
/// Every startup failure: a refused bridge address, invalid provider
/// configuration, an unusable data directory, a catalog that cannot be opened
/// (including a foreign or legacy database), reminder subscriptions that
/// cannot be read when the notifier attaches, or the Tauri runtime itself.
#[expect(clippy::too_many_lines, reason = "the handler list holds one labelled block per feature")]
pub fn run() -> Result<(), Box<dyn Error>> {
    let provider = provider_config()?;
    // One labelled block per feature. A feature adds its handlers under its own
    // label only, by full path (`crate::commands::<feature>::<handler>`), so
    // features register without touching each other's lines or the imports.
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        // library (064)
        ipc::library_register_location,
        ipc::library_list_locations,
        ipc::library_start_scan,
        ipc::library_scan_status,
        ipc::library_cancel_scan,
        ipc::library_list_sessions,
        ipc::library_trashed_assets,
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
        // session filters (064 LIB-FR-17, 065 PRJ-FR-19)
        crate::commands::session_filters::library_session_filter_counts,
        crate::commands::session_filters::project_prefill_from_session,
        crate::commands::session_filters::project_preview_session_addition,
        crate::commands::session_filters::project_add_session,
        // projects
        crate::commands::project_goals::project_create,
        crate::commands::project_goals::project_update,
        crate::commands::project_goals::project_set_subjects,
        crate::commands::project_goals::project_set_rigs,
        crate::commands::project_goals::project_set_goals,
        crate::commands::project_goals::project_apply_goal_template,
        crate::commands::project_goals::project_set_rejection,
        crate::commands::project_goals::project_list,
        crate::commands::project_goals::project_detail,
        crate::commands::project_goals::project_candidates,
        crate::commands::project_goals::goal_template_list,
        crate::commands::project_goals::goal_template_save,
        crate::commands::project_goals::goal_template_delete,
        // runs
        crate::commands::view_selection::view_create,
        crate::commands::view_selection::view_list,
        crate::commands::view_selection::view_detail,
        crate::commands::view_selection::view_candidates,
        crate::commands::view_selection::view_new_candidate_count,
        crate::commands::view_selection::view_set_stage,
        crate::commands::view_selection::view_rename,
        crate::commands::view_selection::view_select_sessions,
        crate::commands::view_selection::view_select_matching,
        crate::commands::view_selection::view_deselect_sessions,
        crate::commands::view_selection::view_clear_selection,
        crate::commands::view_selection::view_set_frames,
        crate::commands::view_selection::view_save,
        crate::commands::view_selection::view_discard_draft,
        crate::commands::view_selection::view_refresh,
        crate::commands::view_selection::view_apply_refresh,
        crate::commands::view_selection::view_quality_scope,
        crate::commands::view_selection::view_apply_quality,
        crate::commands::view_selection::view_review_mark,
        crate::commands::view_selection::view_revision,
        crate::commands::view_selection::project_members,
        // frame review
        crate::commands::frame_review::pix_review_frames,
        crate::commands::frame_review::pix_start_measurement,
        crate::commands::frame_review::pix_prioritize_measurement,
        crate::commands::frame_review::pix_measurement_status,
        crate::commands::frame_review::pix_cancel_measurement,
        crate::commands::frame_review::pix_list_measurement_runs,
        crate::commands::frame_review::pix_open_frame,
        crate::commands::frame_review::pix_preview_tile,
        crate::commands::frame_review::pix_compare_regions,
        crate::commands::frame_review::pix_sample_region,
        crate::commands::frame_review::pix_frame_stars,
        crate::commands::frame_review::pix_star_cutouts,
        crate::commands::frame_review::pix_frame_detail,
        crate::commands::frame_review::pix_review_import,
        crate::commands::frame_review::pix_import_review,
        crate::commands::frame_review::pix_confirm_import,
        crate::commands::frame_review::pix_thumbnails,
        // calibration
        // preparation
        // results
        // storage
        // import
        crate::commands::naming::naming_get,
        crate::commands::naming::naming_save,
        crate::commands::naming::naming_restore_defaults,
        crate::commands::naming::naming_preview,
        crate::commands::import::import_sources_list,
        crate::commands::import::import_source_save,
        crate::commands::import::import_preview,
        crate::commands::import::import_recheck,
        crate::commands::import::import_set_type,
        crate::commands::import::import_set_excluded,
        crate::commands::import::import_choose_location,
        crate::commands::import::import_start,
        crate::commands::import::import_retry,
        crate::commands::import::import_status,
        // planning
        crate::commands::rigs::rig_filters_get,
        crate::commands::rigs::rig_filters_save,
        crate::commands::rigs::rig_unknown_filters,
        crate::commands::observing_plans::planning_list_sites,
        crate::commands::observing_plans::planning_save_site,
        crate::commands::observing_plans::planning_set_default_site,
        crate::commands::observing_plans::planning_compute_windows,
        crate::commands::observing_plans::planning_set_planned,
        crate::commands::observing_plans::planning_review_reminders,
        crate::commands::observing_plans::planning_enable_reminders,
        crate::commands::observing_plans::planning_disable_reminders,
        crate::commands::observing_plans::planning_reminder_status,
        crate::commands::observing_plans::planning_open_notification_settings,
        crate::commands::observing_plans::planning_review_calendar_export,
        crate::commands::observing_plans::planning_export_calendar,
        // targets
        crate::commands::targets_list::planning_target_rows,
        crate::commands::targets_list::targets_search,
        crate::commands::targets_list::targets_add,
        crate::commands::targets_list::targets_set_favourite,
        crate::commands::targets_list::targets_presets_list,
        crate::commands::targets_list::targets_preset_save,
        crate::commands::targets_list::targets_preset_rename,
        crate::commands::targets_list::targets_preset_delete,
        // home
    ]);
    // The planning handlers call these through their Rust APIs, which need no
    // grant; window `library` holds only `capabilities/library.json`.
    let builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());
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
    let notifier = crate::library_notifier::platform_notifier();
    let clock = Arc::new(platevault_core::notifier::SystemClock);
    tauri::async_runtime::block_on(library.attach_notifier(notifier, clock))
        .map_err(|error| format!("cannot attach the reminder notifier: {error}"))?;
    ProgressBridge::spawn(app.handle().clone(), Arc::clone(&library));
    crate::commands::frame_review::spawn_measurement_bridge(app.handle().clone(), &library);
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
    emitted: Emitted,
}

impl ProgressBridge {
    fn spawn(app: AppHandle, library: Arc<Library>) {
        let mut events = library.subscribe_scan_progress();
        let mut bridge = Self { app, library, emitted: Emitted::default() };
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

    /// Emit unless a same-or-newer revision of the operation was emitted.
    fn forward(&mut self, operation: &ScanOperation, from_channel: bool) {
        if !self.emitted.admit(operation, from_channel) {
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
            if operation.state == ScanState::Running || self.emitted.tracks(operation.id) {
                refreshed.insert(operation.id);
                self.forward(operation, false);
            }
        }
        for id in self.emitted.rereads(&refreshed) {
            self.forward(&catalog.scan_status(id).await?, false);
        }
        Ok(())
    }
}

/// Emitted revision of each operation that may still send a snapshot.
///
/// A terminal snapshot from the channel is its operation's last message, so it
/// ends tracking. `run_scan` commits a terminal state before it sends it, so a
/// terminal a resync read from durable status may still be followed by its
/// channel terminal and by older queued snapshots: its revision is kept until
/// that channel terminal arrives, or until [`RETAINED_FINISHED`] later recovered
/// terminals displace it when the channel never delivers one.
#[derive(Default)]
struct Emitted {
    revisions: HashMap<Uuid, Revision>,
    /// Recovered terminals still awaiting their channel terminal.
    finished: HashSet<Uuid>,
    /// Recovery order of `finished`; entries a channel terminal already ended
    /// are skipped when popped.
    recovered: VecDeque<Uuid>,
}

impl Emitted {
    /// Whether `operation` is newer than its emitted revision, recording it.
    fn admit(&mut self, operation: &ScanOperation, from_channel: bool) -> bool {
        let newer = self.revisions.get(&operation.id).is_none_or(|&seen| operation.revision > seen);
        if from_channel && operation.state != ScanState::Running {
            self.revisions.remove(&operation.id);
            self.finished.remove(&operation.id);
            return newer;
        }
        if newer {
            self.revisions.insert(operation.id, operation.revision);
        }
        if operation.state != ScanState::Running && self.finished.insert(operation.id) {
            self.recovered.push_back(operation.id);
            while self.recovered.len() > RETAINED_FINISHED {
                if let Some(oldest) = self.recovered.pop_front() {
                    if self.finished.remove(&oldest) {
                        self.revisions.remove(&oldest);
                    }
                }
            }
        }
        newer
    }

    fn tracks(&self, id: Uuid) -> bool {
        self.revisions.contains_key(&id)
    }

    /// Tracked operations a resync re-reads by id: those outside `refreshed`
    /// that are still running. A recovered terminal has nothing newer to read.
    fn rereads(&self, refreshed: &HashSet<Uuid>) -> Vec<Uuid> {
        self.revisions
            .keys()
            .filter(|id| !refreshed.contains(*id) && !self.finished.contains(*id))
            .copied()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "dev-tools")]
    use std::net::Ipv4Addr;

    use std::collections::HashSet;

    use platevault_core::{ScanOperation, ScanProgress, ScanState};
    use uuid::Uuid;

    #[cfg(feature = "dev-tools")]
    use super::loopback_bind;
    use super::{Emitted, RETAINED_FINISHED};

    fn snapshot(id: Uuid, revision: u64, state: ScanState) -> ScanOperation {
        ScanOperation {
            id,
            revision,
            location_id: Uuid::nil(),
            state,
            progress: ScanProgress::default(),
            issues: Vec::new(),
            complete_scopes: Vec::new(),
            incomplete_scopes: Vec::new(),
            started_at: "2026-10-06T00:00:00Z".into(),
            finished_at: None,
        }
    }

    /// A terminal snapshot recovered by a resync is emitted once; a stale
    /// snapshot still queued from before that resync never follows it.
    #[test]
    fn no_stale_snapshot_follows_a_terminal_recovered_by_resync() {
        let id = Uuid::new_v4();
        let mut emitted = Emitted::default();
        assert!(emitted.admit(&snapshot(id, 1, ScanState::Running), true));
        // The channel lagged past the terminal snapshot; resync reads it.
        assert!(emitted.admit(&snapshot(id, 3, ScanState::Completed), false));
        assert!(!emitted.admit(&snapshot(id, 3, ScanState::Completed), false), "emitted once");
        assert!(!emitted.admit(&snapshot(id, 2, ScanState::Running), true), "stale queued");
    }

    /// `run_scan` commits the terminal state before it sends it: a resync in
    /// that window emits the committed terminal, and the channel's own terminal
    /// that follows is the same revision and is not emitted again.
    #[test]
    fn a_terminal_committed_before_its_channel_send_is_emitted_once() {
        let id = Uuid::new_v4();
        let mut emitted = Emitted::default();
        assert!(emitted.admit(&snapshot(id, 1, ScanState::Running), true));
        assert!(emitted.admit(&snapshot(id, 2, ScanState::Completed), false), "resync emits");
        assert!(!emitted.admit(&snapshot(id, 2, ScanState::Completed), true), "emitted twice");
        assert!(!emitted.tracks(id), "its channel terminal ends tracking");
    }

    /// A terminal whose channel message was lost is never re-read by later
    /// resyncs, and retention of such terminals is bounded.
    #[test]
    fn finished_operations_recovered_by_resync_do_not_leak() {
        let mut emitted = Emitted::default();
        let running = Uuid::new_v4();
        assert!(emitted.admit(&snapshot(running, 1, ScanState::Running), true));
        let lost: Vec<Uuid> = (0..=RETAINED_FINISHED).map(|_| Uuid::new_v4()).collect();
        for id in &lost {
            assert!(emitted.admit(&snapshot(*id, 1, ScanState::Running), true));
            assert!(emitted.admit(&snapshot(*id, 2, ScanState::Failed), false));
        }
        assert_eq!(emitted.rereads(&HashSet::new()), vec![running], "terminals are not re-read");
        assert!(!emitted.tracks(lost[0]), "the oldest lost terminal is forgotten");
        assert!(lost[1..].iter().all(|id| emitted.tracks(*id)));
        assert!(emitted.revisions.len() <= RETAINED_FINISHED + 1, "bounded");
    }

    /// Only IPv4 loopback literals pass. Unspecified, private, IPv6 (including
    /// `::1` and v4-mapped loopback), hostnames and socket addresses are refused.
    #[cfg(feature = "dev-tools")]
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

/// The window each library context creates holds `capabilities/library.json`
/// and, with `dev-tools`, the dev bridge. The legacy `default.json` grants its
/// windows more, and none of that reaches the library window.
#[cfg(test)]
mod window_grants {
    use tauri::ipc::Origin;

    use super::context;

    /// `capabilities/library.json`: the core defaults.
    const LIBRARY: [&str; 1] = ["plugin:event|listen"];
    /// `capabilities/dev/mcp-bridge.json`, compiled in only with `dev-tools`.
    const DEV_BRIDGE: [&str; 3] = [
        "plugin:mcp-bridge|execute_js",
        "plugin:mcp-bridge|execute_command",
        "plugin:mcp-bridge|start_ipc_monitor",
    ];
    /// Granted to the legacy `main` window by `default.json` only.
    const LEGACY_ONLY: [&str; 13] = [
        "plugin:dialog|open",
        "plugin:dialog|save",
        "plugin:dialog|message",
        "plugin:opener|open_path",
        "plugin:opener|reveal_item_in_dir",
        "plugin:webview|create_webview_window",
        "plugin:webview|set_webview_zoom",
        "plugin:window|close",
        "plugin:window|show",
        "plugin:window|set_focus",
        "plugin:updater|check",
        "plugin:process|restart",
        "plugin:window-state|restore_state",
    ];

    #[test]
    fn the_library_window_holds_only_the_library_grants() {
        let mut context = context();
        let windows = &context.config().app.windows;
        assert_eq!(windows.len(), 1, "the library shell creates one window");
        let label = windows[0].label.clone();
        let authority = context.runtime_authority_mut();
        let granted = |command: &str, window: &str| {
            authority.resolve_access(command, window, window, &Origin::Local).is_some()
        };
        for command in LIBRARY {
            assert!(granted(command, &label), "window {label} must hold {command}");
        }
        for command in DEV_BRIDGE {
            assert_eq!(
                granted(command, &label),
                cfg!(feature = "dev-tools"),
                "window {label}: {command}"
            );
        }
        for command in LEGACY_ONLY {
            assert!(granted(command, "main"), "default.json grants window main {command}");
            assert!(!granted(command, &label), "window {label} must not hold {command}");
        }
    }
}
