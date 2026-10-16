// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated rebuilt library shell (spec 064): its own Tauri runtime over the
//! clean catalog.
//!
//! It boots only [`Library`] and the [`crate::commands::library`] and
//! [`crate::commands::observing_plans`] IPC surfaces, with the catalog in its
//! own data directory. The dialog and opener plugins serve the planning
//! handlers' Rust calls, and the platform reminder notifier with the system
//! clock is attached before any command runs. [`CaptureWatch`] counts new
//! captures in every online Captures location (a start-up walk and a live
//! folder watcher each) and is stopped in the exit step. On Windows the
//! removal notices of each watched volume that is not a network share reach
//! it, so the drive can eject, and they end after it stops. The one window is
//! labelled `library`, so it holds `capabilities/library.json` (plus the dev
//! bridge grant with `dev-tools`) and none of the legacy `default.json`.
//! Nothing from the legacy composition root runs here: no `AppState`, legacy
//! database, bootstrap job, legacy watcher or legacy command registration. The
//! legacy code stays archivable and is never booted by this binary.
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

use std::error::Error;
#[cfg(feature = "dev-tools")]
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;

use contracts_core::captures::NEW_CAPTURES_EVENT;
use desktop_services::captures::NewCapturesFeed;
use desktop_services::jobs::{MeasurementProgressFeed, ScanProgressFeed};
use platevault_core::library::Library;
use platevault_core::new_captures::CaptureWatch;
use platevault_core::targets::SimbadConfig;
use tauri::Manager;

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

/// Build the shell, open its catalog and run the event loop.
///
/// # Errors
/// Every startup failure: a refused bridge address, invalid provider
/// configuration, an unusable data directory, a catalog that cannot be opened
/// (including a foreign or legacy database), reminder subscriptions that
/// cannot be read when the notifier attaches, a removal notice window that
/// Windows refuses, or the Tauri runtime itself.
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
        ipc::library_new_captures,
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
        crate::commands::project_goals::project_mark_done,
        crate::commands::project_goals::project_reopen,
        crate::commands::project_goals::project_done_archive_review,
        crate::commands::project_goals::project_detail,
        crate::commands::project_goals::project_candidates,
        crate::commands::project_goals::goal_template_list,
        crate::commands::project_goals::goal_template_save,
        crate::commands::project_goals::goal_template_delete,
        crate::commands::project_progress::project_progress,
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
        crate::commands::view_lifecycle::view_mark_complete,
        crate::commands::view_lifecycle::view_reopen,
        crate::commands::view_lifecycle::view_move_to_trash,
        crate::commands::view_lifecycle::view_restore,
        crate::commands::view_lifecycle::view_trash_list,
        crate::commands::view_lifecycle::view_empty_trash_review,
        crate::commands::view_groups::view_group_create,
        crate::commands::view_groups::view_group_detail,
        crate::commands::view_groups::view_group_assign_panel,
        crate::commands::view_groups::view_group_set_setup,
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
        crate::commands::frame_review::pix_review_list,
        crate::commands::frame_review::pix_display_names,
        crate::commands::frame_review::pix_review_mark,
        // calibration
        crate::commands::calibration_inputs::calibration_list_inputs,
        crate::commands::calibration_inputs::calibration_input,
        crate::commands::calibration_inputs::calibration_match,
        crate::commands::calibration_inputs::calibration_view_plan,
        crate::commands::calibration_inputs::calibration_readiness,
        crate::commands::calibration_inputs::calibration_group_readiness,
        crate::commands::calibration_inputs::calibration_handoff,
        crate::commands::calibration_inputs::calibration_set_required_kinds,
        crate::commands::calibration_inputs::calibration_set_policy,
        crate::commands::calibration_inputs::calibration_assign,
        crate::commands::calibration_inputs::calibration_accept,
        crate::commands::calibration_inputs::calibration_record_exception,
        crate::commands::calibration_inputs::calibration_exclude,
        crate::commands::calibration_inputs::calibration_withdraw,
        crate::commands::calibration_inputs::calibration_project_evidence,
        crate::commands::calibration_inputs::calibration_review_adoption,
        crate::commands::calibration_inputs::calibration_adopt,
        crate::commands::calibration_inputs::calibration_list_adoptions,
        crate::commands::calibration_inputs::calibration_custody_facts,
        // preparation
        crate::commands::prepare::prepare_profiles,
        crate::commands::prepare::prepare_profile_create,
        crate::commands::prepare::prepare_profile_update,
        crate::commands::prepare::prepare_review,
        crate::commands::prepare::prepare_run,
        crate::commands::prepare::prepare_retry,
        crate::commands::prepare::prepare_stop,
        crate::commands::prepare::prepare_list,
        crate::commands::prepare::prepare_outcome,
        crate::commands::prepare::prepare_blocker,
        crate::commands::prepare::prepare_open,
        crate::commands::prepare::prepare_group_review,
        crate::commands::prepare::prepare_group_run,
        crate::commands::prepare::prepare_group_retry,
        crate::commands::prepare::prepare_group_stop,
        crate::commands::prepare::prepare_group_list,
        crate::commands::prepare::prepare_group_outcome,
        crate::commands::prepare::prepare_group_open,
        // results
        crate::commands::results::results_list,
        crate::commands::results::results_rescan,
        crate::commands::results::results_attach,
        crate::commands::results::results_accept,
        crate::commands::results::results_accepted,
        crate::commands::results::results_inputs,
        crate::commands::results::view_create_with_products,
        crate::commands::results::view_add_product_inputs,
        crate::commands::results::view_product_inputs,
        crate::commands::results::results_master_dismiss,
        crate::commands::results::calibration_result_masters,
        // storage
        crate::commands::storage::storage_overview,
        crate::commands::storage::cleanup_review,
        crate::commands::storage::cleanup_execute,
        crate::commands::storage::empty_trash_execute,
        // storage: Done / Archive (U31)
        crate::commands::storage::archive_review,
        crate::commands::storage::archive_restore_review,
        crate::commands::storage::archive_execute,
        crate::commands::storage::archive_status,
        crate::commands::storage::session_archive_state,
        crate::commands::storage::trash_rejected_execute,
        crate::commands::storage::trash_intermediates_execute,
        crate::commands::storage::trash_duplicates_execute,
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
        crate::commands::observing_plans::planning_tonight,
        crate::commands::observing_plans::planning_project_windows,
        crate::commands::observing_plans::planning_target_gaps,
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
        crate::commands::home::home_dashboard,
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
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.handle().clone(),
        SCAN_PROGRESS_EVENT,
        ScanProgressFeed::subscribe(Arc::clone(&library)),
        |event, error| {
            tracing::error!(
                operation = %event.operation_id(),
                %error,
                "scan progress event not delivered"
            );
        },
    ));
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.handle().clone(),
        crate::commands::frame_review::MEASUREMENT_PROGRESS_EVENT,
        MeasurementProgressFeed::subscribe(Arc::clone(&library)),
        |progress, error| {
            tracing::error!(
                run = %progress.operation_id,
                %error,
                "measurement progress event not delivered"
            );
        },
    ));
    // New captures in every online Captures location: a start-up walk and a
    // live watcher each (astro-plan-ef440). The task runs on the async
    // runtime, so it starts inside it; the exit step below stops it.
    let captures = tauri::async_runtime::block_on(async { CaptureWatch::start(&library) });
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.handle().clone(),
        NEW_CAPTURES_EVENT,
        NewCapturesFeed::subscribe(&captures),
        |_, error| tracing::error!(%error, "new captures event not delivered"),
    ));
    app.manage(library);
    app.manage(captures);
    // Windows ejects a Captures drive only once discovery's watcher lets go
    // of it (astro-plan-ef440).
    #[cfg(windows)]
    let mut eject = Some(crate::eject::EjectNotices::start(app.handle())?);
    app.run(move |handle, event| {
        // No watcher outlives the app: every OS watch is released before exit.
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(handle.state::<CaptureWatch>().shutdown());
            // Once discovery stopped, so no removal request waits on it.
            #[cfg(windows)]
            drop(eject.take());
        }
    });
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
    const LEGACY_ONLY: [&str; 11] = [
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
