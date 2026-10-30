// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated rebuilt library shell (spec 064): its own Tauri runtime over the
//! clean catalog.
//!
//! It boots only [`Library`] and the library-shell IPC surfaces registered
//! below, with the catalog in its own data directory. The dialog and opener
//! plugins serve the planning handlers' Rust calls, and the platform reminder
//! notifier with the system clock is attached before any command runs. At
//! start the shell also resumes Wrap up through the host Trash (the headless
//! double in an `e2e` build), starts the Output watcher, which Rescan reaches
//! as managed state, and starts [`CaptureWatch`], which counts new captures in
//! every online Captures location (a start-up walk and a live folder watcher
//! each). It manages the running Applies, which Cancel stops and whose waits
//! for a tool it emits as `project_apply_waiting`, and the running Closes,
//! which Stop interrupts. It also starts [`DeviceWatch`], which lists the
//! connected removable devices for Import (071 STO-IMP-FR-10) and emits
//! `import_devices` on each change. The watchers stop in the exit step. On
//! Windows the removal notices of each watched volume that is not a network
//! share reach the capture watcher, so the drive can eject, and they end
//! after it stops.
//! The one window is labelled `library`, so it holds
//! `capabilities/library.json` (plus the dev bridge grant with `dev-tools`) and
//! none of the legacy `default.json`.
//! Nothing from the legacy composition root runs here: no `AppState`, legacy
//! database, bootstrap job, legacy watcher or legacy command registration. The
//! legacy code stays archivable and is never booted by this binary.
//!
//! A development build (no `custom-protocol`) loads its frontend from `devUrl`,
//! the production frontend in transition: `apps/desktop-ui`, served on
//! `127.0.0.1:5180`. A bundled build still embeds the legacy `dist` until the
//! cutover promotes the replacement into `apps/desktop/src`.
//!
//! In `dev-tools` (debug-only) builds the MCP bridge always starts, bound to IPv4
//! loopback, so an agent can drive that page:
//!
//! ```text
//! pnpm --filter @platevault/desktop-ui dev
//! cargo run -p desktop_shell --features dev-tools --bin platevault-library
//! ```
//!
//! An `e2e` build is the `WebDriver` test host. It embeds the `WebDriver` server
//! and opens only the catalog that [`DATA_DIR_ENV`] names. The webview keeps
//! its data in [`WEBVIEW_SUBDIR`] of that directory on Windows and Linux, and
//! on macOS 14 and later in a data store named after it. A loopback URL in
//! [`FRONTEND_URL_ENV`] replaces `devUrl`. Release builds enable neither
//! `dev-tools` nor `e2e`, so they carry no automation
//! (`scripts/check-dev-surface-absent.sh`).

#[cfg(all(feature = "dev-tools", not(debug_assertions)))]
compile_error!(
    "the library shell's MCP bridge is a debug-only development surface; \
     release builds must not enable `dev-tools`"
);

use std::error::Error;
use std::ffi::OsString;
#[cfg(any(test, feature = "e2e"))]
use std::net::IpAddr;
#[cfg(feature = "dev-tools")]
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;

use contracts_core::captures::NEW_CAPTURES_EVENT;
use desktop_services::captures::NewCapturesFeed;
use desktop_services::jobs::{MeasurementProgressFeed, ScanProgressFeed};
use platevault_core::import::devices::DeviceWatch;
use platevault_core::library::Library;
use platevault_core::new_captures::CaptureWatch;
use platevault_core::preferences::{PreferenceStore, PREFERENCES_FILE};
use platevault_core::project_output::OutputWatch;
use platevault_core::targets::SimbadConfig;
use tauri::{Manager, RunEvent};

use crate::commands::library as ipc;
use crate::commands::library_dialogs::DataDirectory;
use crate::commands::project_apply::ApplyRuns;
use crate::commands::project_wrap_up::{CloseRuns, WrapUpTrash};

/// Catalog and settings-store directory override, used verbatim. An `e2e`
/// build requires it, so a test run never opens the catalog or the
/// preferences of the user's library shell.
pub const DATA_DIR_ENV: &str = "PV_LIBRARY_DATA_DIR";
/// Catalog directory under the platform app-data directory by default. That
/// directory follows the config identifier, and `library-dev` has its own, so
/// a `dev-tools` build never opens the shipped library shell's catalog.
pub const DATA_SUBDIR: &str = "library-rebuild";
/// Catalog database file inside the data directory.
pub const CATALOG_FILE: &str = "catalog.sqlite";
/// Webview data directory inside an `e2e` build's data directory.
pub const WEBVIEW_SUBDIR: &str = "webview";
/// Loopback frontend an `e2e` build loads instead of the compiled-in `devUrl`,
/// so each test lane serves its own frontend build on its own port.
pub const FRONTEND_URL_ENV: &str = "PV_LIBRARY_FRONTEND_URL";
/// SIMBAD TAP endpoint. Unset keeps target resolution explicitly offline
/// (`ProviderUnavailable`) while seed and saved target search stay local.
pub const SIMBAD_ENDPOINT_ENV: &str = "PV_LIBRARY_SIMBAD_ENDPOINT";
/// Committed scan snapshots; polling `library_scan_status` stays the durable truth.
pub const SCAN_PROGRESS_EVENT: &str = "library_scan_progress";
/// Optional IPv4 loopback address for the development bridge.
#[cfg(feature = "dev-tools")]
pub const BRIDGE_BIND_ENV: &str = "PV_MCP_BRIDGE_BIND";
/// Optional base port for the development bridge, so a second shell (or a
/// legacy shell on the plugin's default 9223) does not take the same range.
#[cfg(feature = "dev-tools")]
pub const BRIDGE_PORT_ENV: &str = "PV_MCP_BRIDGE_PORT";

/// The library-shell IPC command list, spliced into `$mac![…]`.
///
/// The single list both `tauri::generate_handler!` (in [`run`]) and
/// `collect_commands!` (in [`library_specta_builder`]) consume, so the
/// registered handlers and the generated `library-index.ts` cannot drift.
/// The callback takes the macro by name because neither consumer accepts a
/// nested macro invocation as its token list.
///
/// One labelled block per feature. A feature adds its handlers under its own
/// label only, by full path (`crate::commands::<feature>::<handler>`), so
/// features register without touching each other's lines or the imports.
macro_rules! library_commands {
    ($mac:ident) => {
        $mac![
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
            ipc::library_list_equipment,
            ipc::library_delete_equipment,
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
            // Shell data directory and Windows Developer Mode settings.
            crate::commands::library_dialogs::library_data_location,
            crate::commands::library_dialogs::library_open_developer_settings,
            // session filters (064 LIB-FR-17, 065 PRJ-FR-19)
            crate::commands::session_filters::library_session_filter_counts,
            crate::commands::session_filters::project_prefill_from_session,
            crate::commands::session_filters::project_create_from_session,
            crate::commands::session_filters::project_preview_session_addition,
            crate::commands::session_filters::project_add_session,
            // projects
            crate::commands::project_goals::project_create,
            crate::commands::project_goals::project_get,
            crate::commands::project_goals::project_update,
            crate::commands::project_goals::project_set_subjects,
            crate::commands::project_goals::project_set_rigs,
            crate::commands::project_goals::project_set_goals,
            crate::commands::project_goals::project_apply_goal_template,
            crate::commands::project_goals::project_list,
            crate::commands::project_goals::project_candidates,
            crate::commands::project_goals::goal_template_list,
            crate::commands::project_goals::goal_template_save,
            crate::commands::project_goals::goal_template_delete,
            crate::commands::project_progress::project_progress,
            // project inputs (065 PRJ-FR-07/08/27/29/31, 066 VSEL-FR-02/10/15)
            crate::commands::project_inputs::project_inputs,
            crate::commands::project_inputs::project_add_sessions,
            crate::commands::project_inputs::project_remove_sessions,
            crate::commands::project_inputs::project_move_sessions,
            crate::commands::project_inputs::project_create_group,
            crate::commands::project_inputs::project_split_group,
            crate::commands::project_inputs::project_rename_group,
            crate::commands::project_inputs::project_set_group_panel,
            crate::commands::project_inputs::project_set_frames,
            crate::commands::project_inputs::project_remove_group,
            crate::commands::project_inputs::project_set_view_settings,
            // apply (066 VSEL-FR-14, 069 PREP-FR-18)
            crate::commands::project_apply::project_apply_preview,
            crate::commands::project_apply::project_apply,
            crate::commands::project_apply::project_apply_cancel,
            crate::commands::project_apply::library_check_symlinks,
            // output (070 RES-FR-01/02)
            crate::commands::project_output::project_copy_to_output,
            crate::commands::project_output::project_output_rescan,
            crate::commands::project_output::project_dismiss_processing_master,
            crate::commands::project_output::project_restore_processing_master,
            // wrap up (065 PRJ-FR-14/25/30, 071)
            crate::commands::project_wrap_up::project_wrap_up_status,
            crate::commands::project_wrap_up::project_close,
            crate::commands::project_wrap_up::project_close_stop,
            crate::commands::project_wrap_up::project_duplicate,
            crate::commands::project_wrap_up::project_reopen_wrap_up_step,
            crate::commands::project_wrap_up::project_closed_snapshot,
            crate::commands::project_wrap_up::project_clean_up_review,
            crate::commands::project_wrap_up::project_clean_up,
            crate::commands::project_wrap_up::project_trash_review,
            crate::commands::project_wrap_up::project_wrap_up_trash,
            crate::commands::project_wrap_up::project_wrap_up_archive_review,
            // sessions archive (064 LIB-FR-17, 071 STO-FR-13)
            crate::commands::sessions_archive::sessions_archive_review,
            crate::commands::sessions_archive::sessions_archive,
            // view previous (066, 071 STO-FR-10; D-W110)
            crate::commands::view_previous::project_previous_items,
            crate::commands::view_previous::project_review_previous_item,
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
            // session intake (064 LIB-FR-04/24)
            crate::commands::frame_review::pix_session_intake,
            crate::commands::frame_review::pix_session_review_list,
            crate::commands::frame_review::pix_session_review_mark,
            crate::commands::frame_review::pix_finish_review,
            crate::commands::frame_review::pix_reopen_review,
            // calibration
            crate::commands::calibration_inputs::calibration_list_inputs,
            crate::commands::calibration_inputs::calibration_input,
            crate::commands::calibration_inputs::calibration_review_adoption,
            crate::commands::calibration_inputs::calibration_adopt,
            crate::commands::calibration_inputs::calibration_list_adoptions,
            crate::commands::calibration_inputs::calibration_custody_facts,
            crate::commands::session_calibration::calibration_needs,
            crate::commands::session_calibration::calibration_reassign,
            crate::commands::session_calibration::calibration_confirm,
            crate::commands::session_calibration::calibration_decline,
            // profiles
            crate::commands::profiles::prepare_profiles,
            crate::commands::profiles::prepare_profile_create,
            crate::commands::profiles::prepare_profile_update,
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
            crate::commands::import::import_merge_sessions,
            crate::commands::import::import_resplit_session,
            crate::commands::import::import_split_preview,
            crate::commands::import::import_set_split_limits,
            crate::commands::import::import_choose_target,
            // removable import devices (071 STO-IMP-FR-10)
            crate::commands::import_devices::import_devices_list,
            // planning
            crate::commands::rigs::rig_filters_get,
            crate::commands::rigs::rig_filters_save,
            crate::commands::rigs::rig_unknown_filters,
            crate::commands::rigs::library_list_rig_filters,
            crate::commands::rigs::library_list_cameras,
            crate::commands::rigs::library_delete_camera,
            crate::commands::observing_plans::planning_list_sites,
            crate::commands::observing_plans::planning_save_site,
            crate::commands::observing_plans::planning_set_default_site,
            crate::commands::observing_plans::planning_home_criteria,
            crate::commands::observing_plans::planning_save_home_criteria,
            crate::commands::observing_plans::planning_reminder_lead_time,
            crate::commands::observing_plans::planning_save_reminder_lead_time,
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
            crate::commands::observing_plans::planning_calendar,
            crate::commands::observing_plans::planning_project_windows,
            crate::commands::observing_plans::planning_target_gaps,
            // targets
            crate::commands::targets_list::planning_target_rows,
            crate::commands::targets_list::targets_search,
            crate::commands::targets_list::targets_search_result_action,
            crate::commands::targets_list::targets_set_favourite,
            crate::commands::targets_list::targets_presets_list,
            crate::commands::targets_list::targets_preset_save,
            crate::commands::targets_list::targets_preset_rename,
            crate::commands::targets_list::targets_preset_delete,
            // home
            crate::commands::home::home_dashboard,
            // issues on rows (063 FR-032, D-W92, D-W158)
            crate::commands::issues::library_issues,
            crate::commands::issues::library_dismiss_issue,
            crate::commands::issues::library_restore_issue,
            // appearance: theme, language, single-key shortcuts (064 LIB-FR-21, D-W166)
            crate::commands::appearance::library_preferences,
            crate::commands::appearance::library_change_preference,
            crate::commands::appearance::library_restore_default_preferences,
            // workflow settings: matching, View mode, calibration, Moon curves
            // (D-W114; 068 CAL-FR-15/20/21, J36 S8, 072 PLAN-FR-02)
            crate::commands::workflow_settings::workflow_settings_get,
            crate::commands::workflow_settings::workflow_settings_save,
            // native shell (menu bar, tray, OS pickers)
            crate::commands::library_dialogs::library_pick_folder,
            crate::commands::library_dialogs::library_pick_file,
            crate::commands::library_dialogs::library_reveal,
            crate::native_shell_surfaces::library_native_menu_set_labels,
            crate::native_shell_surfaces::library_native_quit_answer,
        ]
    };
}

/// The tauri-specta builder over the library-shell command list; its export
/// is `apps/desktop/src/bindings/library-index.ts` (`tests/library_bindings.rs`).
#[must_use]
pub fn library_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    use tauri_specta::collect_commands;
    tauri_specta::Builder::<tauri::Wry>::new()
        // As in the legacy builder: `serde_json::Value` is registered as a
        // named type so its self-referential shape is emitted once rather than
        // inlined forever, and 64-bit integers (sizes, counts, revisions) are
        // JSON numbers on this wire, so they export as `number`.
        .dangerously_cast_bigints_to_number()
        .typ::<serde_json::Value>()
        // Events are named by Rust constants, not tauri-specta events. Each
        // name is exported as a constant beside its payload type, so the client
        // takes both from the generated file and writes neither by hand.
        .constant("SCAN_PROGRESS_EVENT", SCAN_PROGRESS_EVENT)
        .typ::<desktop_services::jobs::ScanProgressEvent>()
        .constant(
            "MEASUREMENT_PROGRESS_EVENT",
            crate::commands::frame_review::MEASUREMENT_PROGRESS_EVENT,
        )
        .typ::<platevault_core::MeasurementProgress>()
        .constant("NEW_CAPTURES_EVENT", NEW_CAPTURES_EVENT)
        .typ::<contracts_core::captures::NewCaptures>()
        .constant("APPLY_WAITING_EVENT", crate::commands::project_apply::APPLY_WAITING_EVENT)
        .typ::<crate::commands::project_apply::ApplyWaiting>()
        .constant(
            "NATIVE_QUIT_CONFIRM_EVENT",
            crate::native_shell_surfaces::NATIVE_QUIT_CONFIRM_EVENT,
        )
        .typ::<crate::native_shell_surfaces::NativeQuitRequest>()
        .constant("IMPORT_DEVICES_EVENT", crate::commands::import_devices::IMPORT_DEVICES_EVENT)
        .commands(library_commands!(collect_commands))
}

/// Build the shell, open its catalog and run the event loop.
///
/// # Errors
/// Every startup failure: a refused bridge address, invalid provider
/// configuration, an `e2e` build without its data directory or with a refused
/// frontend URL, an unusable data directory, a catalog that cannot be opened
/// (including a foreign or legacy database), reminder subscriptions that
/// cannot be read when the notifier attaches, or the Tauri runtime itself.
/// A removal notice window that Windows refuses is logged, not returned.
pub fn run() -> Result<(), Box<dyn Error>> {
    let provider = provider_config()?;
    #[cfg_attr(not(feature = "e2e"), allow(unused_mut))]
    let mut context = context();
    #[cfg(feature = "e2e")]
    let test_window = test_host::configure(&mut context, std::env::var_os(FRONTEND_URL_ENV))?;
    let builder = shell_builder()?;

    // Windows are created when the event loop starts, so the catalog is open
    // and managed before any webview can invoke a command.
    let app = builder.build(context)?;
    let data_dir = data_dir(&app)?;
    // Appearance (D-W166): PlateVault's per-user settings store, outside every
    // library. It is managed before any window opens, and each window's first
    // frame paints with it (`FirstFrame`).
    app.manage(Arc::new(PreferenceStore::open(preferences_path(&app)?)));
    app.manage(managed_data_directory(&data_dir));
    let catalog = data_dir.join(CATALOG_FILE);
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
    forward_progress(&app, &library);
    // CLOSE (071): settle what a stop left of Wrap up (an interrupted Clean
    // up, a Trash step, every unsettled archive) through the host Trash (the
    // headless double in an `e2e` build). It can move whole archives, so it
    // runs beside the event loop; until it settles them, a Closing Project
    // stays locked and its operation reserved.
    let trash = WrapUpTrash::host();
    tauri::async_runtime::spawn({
        let library = Arc::clone(&library);
        let trash = trash.get();
        async move {
            match library.recover_wrap_up(trash).await {
                Ok(settled) => tracing::info!(archives = settled.len(), "wrap up recovered"),
                Err(error) => {
                    tracing::error!(%error, "wrap up recovery stopped; the next start resumes it");
                }
            }
        }
    });
    // OUTPUT (RES-FR-01): follow every open Project's `Output/` and
    // `Processing/` while the app runs; its first pass finishes interrupted
    // Copy to Output. It spawns on the runtime, so it starts inside it; Rescan
    // reaches it as managed state, and the exit step below stops it.
    let output_watch = tauri::async_runtime::block_on(async { OutputWatch::start(&library) });
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
    // Removable import devices (071 STO-IMP-FR-10): a poll of the OS mount
    // table on the async runtime, so it starts inside it; each change of the
    // list is emitted, and the exit step below stops it.
    let devices = tauri::async_runtime::block_on(async { DeviceWatch::start() });
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.handle().clone(),
        crate::commands::import_devices::IMPORT_DEVICES_EVENT,
        desktop_services::channels::Latest::new(devices.subscribe()),
        |_, error| tracing::error!(%error, "import devices event not delivered"),
    ));
    app.manage(library);
    app.manage(trash);
    app.manage(output_watch);
    app.manage(captures);
    app.manage(devices);
    // Apply's Cancel and its waiting event, and Close's Stop (069 PREP-FR-18,
    // 071 STO-FR-08).
    app.manage(ApplyRuns::emitting(app.handle().clone()));
    app.manage(CloseRuns::default());
    // The menu bar and tray; Quit asks first while work runs (D-W157).
    crate::native_shell_surfaces::install(app.handle())?;
    // Windows ejects a Captures drive only once discovery's watcher lets go
    // of it (astro-plan-ef440). Without the notices, which `start` logs, the
    // app still starts; only that release is lost.
    #[cfg(windows)]
    let mut eject = crate::eject::EjectNotices::start(app.handle());
    app.run(move |handle, event| {
        // As Tauri opens a configured window once the loop runs, with the
        // webview's data beside the run's catalog.
        #[cfg(feature = "e2e")]
        if let RunEvent::Ready = event {
            if let Err(error) = test_window.open(handle, &data_dir) {
                tracing::error!(%error, "the test host window did not open");
                handle.exit(1);
            }
        }
        // No watcher outlives the app: every OS watch is released before exit.
        if let RunEvent::Exit = event {
            tauri::async_runtime::block_on(handle.state::<OutputWatch>().shutdown());
            tauri::async_runtime::block_on(handle.state::<CaptureWatch>().shutdown());
            tauri::async_runtime::block_on(handle.state::<DeviceWatch>().shutdown());
            // Once discovery is stopping, a removal request that waited on it
            // has returned, so dropping the notices never waits on one.
            #[cfg(windows)]
            drop(eject.take());
        }
    });
    Ok(())
}

/// Forward scan and measurement progress from `library` to the webview as
/// events; a delivery failure is logged, not returned.
fn forward_progress(app: &tauri::App, library: &Arc<Library>) {
    tauri::async_runtime::spawn(crate::bootstrap::feeds::forward(
        app.handle().clone(),
        SCAN_PROGRESS_EVENT,
        ScanProgressFeed::subscribe(Arc::clone(library)),
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
        MeasurementProgressFeed::subscribe(Arc::clone(library)),
        |progress, error| {
            tracing::error!(
                run = %progress.operation_id,
                %error,
                "measurement progress event not delivered"
            );
        },
    ));
}

/// The shell's commands, native menu routing and plugins.
///
/// # Errors
/// A refused bridge address or base port (`dev-tools` only).
#[cfg_attr(not(feature = "dev-tools"), allow(clippy::unnecessary_wraps))] // only the dev bridge can fail
fn shell_builder() -> Result<tauri::Builder<tauri::Wry>, String> {
    use tauri::generate_handler;
    // `generate_handler!` expands to a non-capturing closure; the fn type fixes its runtime.
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = library_commands!(generate_handler);
    #[cfg(feature = "e2e")]
    let handler = crate::commands::e2e_window::with_e2e_commands(handler);
    let builder = tauri::Builder::default()
        .invoke_handler(handler)
        .on_menu_event(|app, event| {
            crate::native_shell_surfaces::on_menu(app, event.id().as_ref());
        })
        .on_window_event(crate::native_shell_surfaces::on_window_event);
    // The planning handlers call these through their Rust APIs, which need no
    // grant; window `library` holds only `capabilities/library.json`.
    let builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());
    // The stored appearance, handed to each webview before its page loads.
    let builder = builder.plugin(crate::commands::appearance::FirstFrame::new());
    #[cfg(feature = "dev-tools")]
    let builder = builder.plugin(dev_bridge(
        std::env::var(BRIDGE_BIND_ENV).ok().as_deref(),
        std::env::var(BRIDGE_PORT_ENV).ok().as_deref(),
    )?);
    // The WebDriver server the tauri-webdriver proxy drives. It binds loopback
    // (`TAURI_WEBDRIVER_PORT`, default 4445) and needs no capability grant.
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());
    Ok(builder)
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

/// [`DATA_DIR_ENV`] verbatim, else `<app data>/library-rebuild`, created if absent.
fn data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn Error>> {
    let dir = match data_dir_override(std::env::var_os(DATA_DIR_ENV))? {
        Some(dir) => dir,
        None => app.path().app_data_dir()?.join(DATA_SUBDIR),
    };
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!("cannot create library data directory {}: {error}", dir.display())
    })?;
    Ok(dir)
}

/// The data directory state `run` manages for `library_data_location`; the
/// IPC tests manage the same value.
#[must_use]
pub fn managed_data_directory(path: &std::path::Path) -> DataDirectory {
    DataDirectory::from_path(path)
}

/// The settings store's file: beside the catalog when [`DATA_DIR_ENV`]
/// isolates a run, else in the per-user config directory, which no library
/// shares.
fn preferences_path(app: &tauri::App) -> Result<PathBuf, Box<dyn Error>> {
    let dir = match data_dir_override(std::env::var_os(DATA_DIR_ENV))? {
        Some(dir) => dir,
        None => app.path().app_config_dir()?,
    };
    Ok(dir.join(PREFERENCES_FILE))
}

/// The directory [`DATA_DIR_ENV`] names; unset or empty is none. An `e2e`
/// build has no default: it seeds and resets its catalog, and without
/// `dev-tools` it shares the shipped identifier, so its default would be the
/// catalog of the user's library shell.
fn data_dir_override(raw: Option<OsString>) -> Result<Option<PathBuf>, String> {
    match raw.filter(|dir| !dir.is_empty()) {
        Some(dir) => Ok(Some(PathBuf::from(dir))),
        None if cfg!(feature = "e2e") => {
            Err(format!("an `e2e` build opens only an isolated catalog; set {DATA_DIR_ENV}"))
        }
        None => Ok(None),
    }
}

/// [`FRONTEND_URL_ENV`]'s URL; unset or blank is none. Anything else must be
/// an `http` or `https` URL on `localhost` or a loopback address: the window's
/// grants follow the page it loads, so a remote page would reach every
/// command handler.
#[cfg(any(test, feature = "e2e"))]
fn loopback_frontend(raw: Option<OsString>) -> Result<Option<tauri::Url>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let raw = raw.into_string().map_err(|_| format!("{FRONTEND_URL_ENV} is not valid UTF-8"))?;
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let refused = |why: String| {
        format!("{FRONTEND_URL_ENV}={raw:?} {why}; the test host loads a loopback frontend only")
    };
    let url = tauri::Url::parse(raw).map_err(|error| refused(format!("is not a URL ({error})")))?;
    let loopback = match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback()),
        None => false,
    };
    if matches!(url.scheme(), "http" | "https") && loopback {
        Ok(Some(url))
    } else {
        Err(refused("is not an http(s) loopback URL".to_owned()))
    }
}

/// The name space of [`webview_store_id`]'s name-based UUIDs.
#[cfg(any(test, all(feature = "e2e", target_os = "macos")))]
const WEBVIEW_STORE_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x8c3e_6a1f_2b4d_4e7a_9f10_3c5b_7d2e_0a61);

/// The macOS webview data store of the data directory `data_dir`: a
/// name-based UUID of its canonical path. Each test run's directory gets its
/// own store, and one directory always gets the same store.
///
/// # Errors
/// `data_dir` cannot be resolved to a canonical path.
#[cfg(any(test, all(feature = "e2e", target_os = "macos")))]
fn webview_store_id(data_dir: &std::path::Path) -> std::io::Result<[u8; 16]> {
    let canonical = std::fs::canonicalize(data_dir)?;
    Ok(uuid::Uuid::new_v5(&WEBVIEW_STORE_NAMESPACE, canonical.as_os_str().as_encoded_bytes())
        .into_bytes())
}

/// The `e2e` test host's frontend and window.
#[cfg(feature = "e2e")]
mod test_host {
    use std::ffi::OsString;
    use std::path::Path;

    use tauri::utils::config::WindowConfig;
    use tauri::WebviewWindowBuilder;

    use super::{loopback_frontend, FRONTEND_URL_ENV, WEBVIEW_SUBDIR};

    /// The library window, held back from Tauri's own start-up creation.
    pub(super) struct TestWindow(WindowConfig);

    /// Load [`FRONTEND_URL_ENV`]'s frontend, if set, instead of `devUrl`, and
    /// hold the one window back so [`TestWindow::open`] chooses its data.
    pub(super) fn configure(
        context: &mut tauri::Context,
        frontend: Option<OsString>,
    ) -> Result<TestWindow, String> {
        let config = context.config_mut();
        if let Some(url) = loopback_frontend(frontend)? {
            // A bundled build embeds its frontend and never reads `devUrl`, so
            // it would ignore the override and test another frontend.
            if !tauri::is_dev() {
                return Err(format!(
                    "{FRONTEND_URL_ENV} needs a development build; this build embeds its frontend"
                ));
            }
            config.build.dev_url = Some(url);
        }
        let [window] = config.app.windows.as_mut_slice() else {
            return Err("the library shell config must declare exactly one window".to_owned());
        };
        window.create = false;
        Ok(TestWindow(window.clone()))
    }

    impl TestWindow {
        /// Open the window from its config with the webview's data kept by
        /// the run's data directory `data_dir`. `WebView2` and `WebKitGTK`
        /// keep it in [`WEBVIEW_SUBDIR`]. The macOS webview takes no
        /// directory, so it gets the data store [`super::webview_store_id`]
        /// names; macOS before 14 has no such stores and falls back to the
        /// default one under `HOME`.
        pub(super) fn open(&self, handle: &tauri::AppHandle, data_dir: &Path) -> tauri::Result<()> {
            let builder = WebviewWindowBuilder::from_config(handle, &self.0)?
                .data_directory(data_dir.join(WEBVIEW_SUBDIR));
            #[cfg(target_os = "macos")]
            let builder = builder.data_store_identifier(super::webview_store_id(data_dir)?);
            builder.build()?;
            Ok(())
        }
    }
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
/// loopback whatever the environment says. [`BRIDGE_PORT_ENV`] moves its base
/// port; unset keeps the plugin's default.
#[cfg(feature = "dev-tools")]
fn dev_bridge(
    requested_bind: Option<&str>,
    requested_port: Option<&str>,
) -> Result<tauri::plugin::TauriPlugin<tauri::Wry>, String> {
    let bind = loopback_bind(requested_bind)?;
    let mut config = tauri_plugin_mcp_bridge::Config::new(&bind.to_string());
    if let Some(port) = bridge_base_port(requested_port)? {
        config.base_port = port;
    }
    tracing::info!(%bind, base_port = config.base_port, "MCP bridge starting (library shell, loopback only)");
    Ok(tauri_plugin_mcp_bridge::init_with_config(config))
}

/// The plugin tries 100 ports from its base, so the base leaves room for them
/// below 65535, and stays out of the privileged range.
#[cfg(feature = "dev-tools")]
const BRIDGE_PORTS: std::ops::RangeInclusive<u16> = 1024..=65435;

/// Unset or blank keeps the plugin's default base port; anything else must
/// be a port number in [`BRIDGE_PORTS`].
#[cfg(feature = "dev-tools")]
fn bridge_base_port(requested: Option<&str>) -> Result<Option<u16>, String> {
    let Some(raw) = requested.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    match raw.parse::<u16>() {
        Ok(port) if BRIDGE_PORTS.contains(&port) => Ok(Some(port)),
        _ => Err(format!(
            "{BRIDGE_PORT_ENV}={raw:?} is not a port from {} to {}",
            BRIDGE_PORTS.start(),
            BRIDGE_PORTS.end()
        )),
    }
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

    use super::{bridge_base_port, loopback_bind};

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

    /// Unset or blank keeps the default; a port with room for the plugin's
    /// 100-port scan passes; privileged, too-high and non-numeric values stop
    /// start-up rather than fall back.
    #[test]
    fn bridge_base_port_is_a_usable_unprivileged_port() {
        for unset in [None, Some(""), Some("  ")] {
            assert_eq!(bridge_base_port(unset), Ok(None), "{unset:?}");
        }
        assert_eq!(bridge_base_port(Some(" 9323 ")), Ok(Some(9323)));
        assert_eq!(bridge_base_port(Some("1024")), Ok(Some(1024)));
        assert_eq!(bridge_base_port(Some("65435")), Ok(Some(65435)));
        for refused in ["1023", "65436", "70000", "-1", "port", "9323x"] {
            assert!(bridge_base_port(Some(refused)).is_err(), "{refused} must be refused");
        }
    }
}

/// The generated client calls only what [`run`] registers: each
/// `__TAURI_INVOKE` name in the export is a handler of `library_commands!`,
/// and each handler has its call. A `#[specta::specta(rename = …)]` would give
/// the client a name Tauri never registered.
#[cfg(test)]
mod registry {
    use std::collections::BTreeSet;

    use specta_typescript::Typescript;

    macro_rules! handler_paths {
        ($($handler:path),* $(,)?) => {
            [$(stringify!($handler)),*]
        };
    }

    #[test]
    fn generated_calls_reach_only_registered_handlers() {
        let registered: BTreeSet<&str> = library_commands!(handler_paths)
            .into_iter()
            .map(|path| path.rsplit("::").next().unwrap_or(path).trim())
            .collect();
        let scratch = tempfile::tempdir().expect("scratch directory");
        let export = scratch.path().join("library-index.ts");
        super::library_specta_builder()
            .export(Typescript::default(), &export)
            .expect("export the library-shell bindings");
        let source = std::fs::read_to_string(&export).expect("read the export");
        // `__TAURI_INVOKE("name"…)`, or `__TAURI_INVOKE<T>("name")` for a
        // command that cannot fail; the import line names no command.
        let invoked: BTreeSet<&str> = source
            .split("__TAURI_INVOKE")
            .filter_map(|call| {
                let call = match call.strip_prefix('<') {
                    Some(generic) => &generic[generic.find(">(\"")? + 1..],
                    None => call,
                };
                call.strip_prefix("(\"")?.split('"').next()
            })
            .collect();
        assert!(!registered.is_empty(), "the registry lists no handler");
        let unregistered: Vec<_> = invoked.difference(&registered).collect();
        let uncalled: Vec<_> = registered.difference(&invoked).collect();
        assert!(
            unregistered.is_empty() && uncalled.is_empty(),
            "the client invokes unregistered {unregistered:?}; no client call for {uncalled:?}"
        );
        for exposed in [
            "library_reveal",
            "project_dismiss_processing_master",
            "project_restore_processing_master",
        ] {
            assert!(registered.contains(exposed), "the library client lacks {exposed}");
        }
    }
}

/// The `e2e` test host's inputs: its data directory, its macOS webview data
/// store and its frontend URL.
#[cfg(test)]
mod test_host_inputs {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{data_dir_override, loopback_frontend, webview_store_id};

    /// One directory names one store however its path is spelt; another
    /// directory names another, and a missing one names none.
    #[test]
    fn each_data_directory_names_its_own_webview_store() {
        let run = tempfile::tempdir().expect("run directory");
        let other = tempfile::tempdir().expect("other run directory");
        std::fs::create_dir(run.path().join("webview")).expect("webview directory");
        let store = webview_store_id(run.path()).expect("the run's store");
        assert_eq!(webview_store_id(&run.path().join("webview").join("..")).ok(), Some(store));
        assert_ne!(webview_store_id(other.path()).ok(), Some(store));
        assert!(webview_store_id(&run.path().join("missing")).is_err());
    }

    /// A named directory is used verbatim. Without one an `e2e` build refuses
    /// to start, and any other build takes the platform default.
    #[test]
    fn only_an_e2e_build_requires_its_data_directory() {
        assert_eq!(
            data_dir_override(Some(OsString::from("/tmp/run"))),
            Ok(Some(PathBuf::from("/tmp/run")))
        );
        for unset in [None, Some(OsString::new())] {
            let resolved = data_dir_override(unset);
            if cfg!(feature = "e2e") {
                assert!(resolved.is_err(), "an e2e build must refuse {resolved:?}");
            } else {
                assert_eq!(resolved, Ok(None));
            }
        }
    }

    /// Unset or blank keeps `devUrl`. Only `http(s)` on `localhost` or a
    /// loopback address passes; private, unspecified, v4-mapped and remote
    /// hosts, other schemes and non-URLs are refused.
    #[test]
    fn the_frontend_override_accepts_loopback_http_only() {
        for unset in [None, Some(""), Some("   ")] {
            assert_eq!(loopback_frontend(unset.map(OsString::from)), Ok(None), "{unset:?}");
        }
        for accepted in [
            "http://127.0.0.1:5180",
            " http://localhost:5180/ ",
            "http://[::1]:5180",
            "https://127.0.0.2:8443/index.html",
        ] {
            let url = loopback_frontend(Some(accepted.into()));
            assert!(matches!(url, Ok(Some(_))), "{accepted} must pass: {url:?}");
        }
        for refused in [
            "http://192.168.1.20:5180",
            "http://0.0.0.0:5180",
            "http://example.com",
            "http://localhost.example.com:5180",
            "http://[::ffff:127.0.0.1]:5180",
            "file:///tmp/dist/index.html",
            "tauri://localhost",
            "127.0.0.1:5180",
            "not a url",
        ] {
            assert!(loopback_frontend(Some(refused.into())).is_err(), "{refused} must be refused");
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
