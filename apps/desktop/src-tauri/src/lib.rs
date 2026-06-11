//! Desktop shell crate boundary.
//!
//! Owns the Tauri 2 runtime, the shared `AppState`, and the typed command
//! surface declared in [`commands::lifecycle`]. Type-safe TypeScript bindings
//! are emitted at test time by `tests/bindings.rs` via tauri-specta.

pub mod commands;
pub mod watcher;

use std::sync::Arc;

use audit::bus::EventBus;
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

use crate::commands::audit::{audit_export, audit_list};
use crate::commands::calibration::{
    calibration_masters_get, calibration_masters_list, calibration_match_assign,
    calibration_match_suggest, calibration_match_suggest_batch, calibration_matches,
};
use crate::commands::calibration_tolerances::{
    calibration_tolerances_get, calibration_tolerances_update,
};
use crate::commands::catalogs::{
    catalog_attribution_get, catalog_download, catalog_list, catalog_manifest_fetch,
};
use crate::commands::cleanup::{cleanup_policy_get, cleanup_policy_update, cleanup_scan};
use crate::commands::equipment::{
    equipment_cameras_create, equipment_cameras_delete, equipment_cameras_list,
    equipment_cameras_update, equipment_filters_create, equipment_filters_delete,
    equipment_filters_list, equipment_filters_update, equipment_telescopes_create,
    equipment_telescopes_delete, equipment_telescopes_list, equipment_telescopes_update,
    equipment_trains_create, equipment_trains_delete, equipment_trains_list,
    equipment_trains_update,
};
use crate::commands::firstrun::{
    firstrun_complete, firstrun_restart, firstrun_state, roots_register_batch,
};
use crate::commands::inbox::{
    inbox_classify, inbox_confirm, inbox_reclassify, inbox_scan, inbox_scan_folder,
};
use crate::commands::ingestion::{ingestion_settings_get, ingestion_settings_update};
use crate::commands::inventory::{inventory_list, inventory_session_review};
use crate::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, lifecycle_transition_preview,
    provenance_read, AppState,
};
use crate::commands::native::{native_directory_pick, native_file_pick, native_reveal};
use crate::commands::patterns::{pattern_preview, pattern_resolve, pattern_validate};
use crate::commands::plan_apply::{
    plans_apply_real, plans_apply_status, plans_cancel, plans_item_retry, plans_item_skip,
    plans_resume,
};
use crate::commands::plans::{
    archive_permanently_delete, archive_send_to_trash, plans_approve, plans_discard, plans_get,
    plans_list, plans_retry,
};
use crate::commands::preferences::{preferences_get, preferences_set};
use crate::commands::projects::{
    projects_channels_dismiss_drift, projects_channels_reinfer, projects_create,
    projects_create_plan, projects_get, projects_list, projects_source_add, projects_source_remove,
    projects_update,
};
use crate::commands::review::review_queue;
use crate::commands::roots::{
    equipment_list, roots_list, roots_register, roots_remap, roots_remap_apply, scan_start,
};
use crate::commands::search::search_global;
use crate::commands::sessions::{
    sessions_calendar, sessions_get, sessions_list, sessions_merge, sessions_split,
    sessions_transition,
};
use crate::commands::settings::{
    settings_get, settings_restore_defaults, settings_source_override_set, settings_update,
};
use crate::commands::status::status_summary;
use crate::commands::target_lookup::{target_lookup, target_resolve};
use crate::commands::targets::{targets_get, targets_list};
use crate::commands::tools::{
    tools_discover, tools_launch, tools_list, tools_update, tools_validate_path,
};
use crate::commands::tour::tour_complete_step;

pub const CRATE_NAME: &str = "desktop_shell";

/// Build the tauri-specta [`Builder`] populated with every typed command.
///
/// Reused by `run` (production) and `tests/bindings.rs` (TS emission).
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // Several contract DTOs carry `serde_json::Value` "details" payloads;
        // their `Number` inner type erases width info, so specta would block
        // export by default. Casting BigInts to JS `number` is acceptable for
        // these debug payloads (no numeric precision is required here).
        .dangerously_cast_bigints_to_number()
        // Register `serde_json::Value` as a named (recursive) type so specta
        // emits it once instead of inlining its self-referential shape, which
        // would otherwise fail with "infinitely recursive inline reference".
        .typ::<serde_json::Value>()
        .commands(collect_commands![
            // lifecycle (spec 002)
            provenance_read,
            lifecycle_transition_apply,
            lifecycle_transition_preview,
            lifecycle_ledger_list,
            // sessions
            sessions_list,
            sessions_get,
            sessions_calendar,
            sessions_transition,
            sessions_split,
            sessions_merge,
            // calibration (spec 029 stubs)
            calibration_masters_list,
            calibration_masters_get,
            calibration_matches,
            // calibration matching (spec 007)
            calibration_match_suggest,
            calibration_match_assign,
            calibration_match_suggest_batch,
            // targets
            targets_list,
            targets_get,
            // target lookup + resolve (spec 013)
            target_lookup,
            target_resolve,
            // projects (spec 008)
            projects_list,
            projects_get,
            projects_create,
            projects_update,
            projects_source_add,
            projects_source_remove,
            projects_channels_reinfer,
            projects_channels_dismiss_drift,
            projects_create_plan,
            // plans (spec 017)
            plans_list,
            plans_get,
            plans_approve,
            plans_discard,
            plans_retry,
            archive_send_to_trash,
            archive_permanently_delete,
            // plan apply (spec 025)
            plans_apply_real,
            plans_cancel,
            plans_resume,
            plans_item_skip,
            plans_item_retry,
            plans_apply_status,
            // audit
            audit_list,
            audit_export,
            // catalog registry (spec 014)
            catalog_list,
            catalog_attribution_get,
            catalog_manifest_fetch,
            catalog_download,
            // review
            review_queue,
            // roots & scan & equipment
            roots_list,
            roots_register,
            roots_register_batch,
            roots_remap,
            roots_remap_apply,
            scan_start,
            equipment_list,
            // first-run wizard (spec 003)
            firstrun_state,
            firstrun_complete,
            firstrun_restart,
            // pattern resolver (spec 015)
            pattern_validate,
            pattern_resolve,
            pattern_preview,
            // settings (spec 018)
            settings_get,
            settings_update,
            settings_restore_defaults,
            settings_source_override_set,
            // preferences
            preferences_get,
            preferences_set,
            // search
            search_global,
            // tour
            tour_complete_step,
            // native filesystem controls (spec 004)
            native_directory_pick,
            native_file_pick,
            native_reveal,
            // equipment CRUD (spec 030)
            equipment_cameras_list,
            equipment_cameras_create,
            equipment_cameras_update,
            equipment_cameras_delete,
            equipment_telescopes_list,
            equipment_telescopes_create,
            equipment_telescopes_update,
            equipment_telescopes_delete,
            equipment_trains_list,
            equipment_trains_create,
            equipment_trains_update,
            equipment_trains_delete,
            equipment_filters_list,
            equipment_filters_create,
            equipment_filters_update,
            equipment_filters_delete,
            // status (spec 030)
            status_summary,
            // cleanup policy & scan (spec 030)
            cleanup_policy_get,
            cleanup_policy_update,
            cleanup_scan,
            // calibration tolerances (spec 030)
            calibration_tolerances_get,
            calibration_tolerances_update,
            // inbox (spec 005 + 030)
            inbox_scan,
            inbox_scan_folder,
            inbox_classify,
            inbox_confirm,
            inbox_reclassify,
            // inventory (spec 006)
            inventory_list,
            inventory_session_review,
            // ingestion settings (spec 030)
            ingestion_settings_get,
            ingestion_settings_update,
            // tools (spec 011/030)
            tools_launch,
            tools_list,
            tools_update,
            tools_validate_path,
            tools_discover,
        ])
}

/// Build the Tauri [`App`] **without** starting the event loop.
///
/// The returned handle exposes the platform path resolver (needed to locate
/// the default `SQLite` database path) while the caller retains full control
/// over state management and app startup ordering.
///
/// # Panics
/// Panics if the Tauri runtime cannot be initialised.
#[must_use]
pub fn build_app() -> tauri::App {
    let builder = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
}

/// Manage application state on a pre-built [`App`] and start the event loop.
///
/// Caller is responsible for providing an already-migrated [`SqlitePool`];
/// the persistence layer expects migrations to have run before commands hit
/// the database.
///
/// # Panics
/// Panics if the Tauri event loop fails to start — there is no recovery path
/// once the GUI process is requested but cannot be started.
pub fn run_app(app: tauri::App, pool: SqlitePool) {
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus);

    app.manage(state);

    app.run(|_handle, _event| {});
}
