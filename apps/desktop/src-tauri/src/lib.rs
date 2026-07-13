//! Desktop shell crate boundary.
//!
//! Owns the Tauri 2 runtime, the shared `AppState`, and the typed command
//! surface declared in [`commands::lifecycle`]. Type-safe TypeScript bindings
//! are emitted at test time by `tests/bindings.rs` via tauri-specta.

pub mod commands;
pub mod resolve_cache;
pub mod watcher;

use std::sync::Arc;

use audit::bus::EventBus;
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tauri_specta::{collect_commands, Builder};

use crate::commands::artifacts::{
    artifact_classify, artifact_list, artifact_mark_resolved, artifact_watcher_attach,
    artifact_watcher_detach,
};
use crate::commands::audit::{audit_export, audit_list};
use crate::commands::calibration::{
    calibration_masters_get, calibration_masters_list, calibration_match_assign,
    calibration_match_suggest, calibration_match_suggest_batch, calibration_matches,
};
use crate::commands::calibration_tolerances::{
    calibration_tolerances_get, calibration_tolerances_update,
};
use crate::commands::cleanup::{
    cleanup_plan_generate, cleanup_policy_get, cleanup_policy_update, cleanup_raw_frames_generate,
    cleanup_raw_frames_scan, cleanup_scan,
};
#[cfg(feature = "dev-tools")]
use crate::commands::dev::{
    dev_calls_list, dev_contracts_list, dev_export, dev_schema_get, CallBuffer,
};
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
use crate::commands::guided::{
    guided_activate, guided_dismiss, guided_restart, guided_state_get, guided_step_complete,
};
use crate::commands::inbox::{
    inbox_classify, inbox_confirm, inbox_item_metadata, inbox_list, inbox_plan, inbox_plan_apply,
    inbox_plan_apply_all, inbox_plan_apply_selected, inbox_plan_cancel, inbox_plan_list_open,
    inbox_property_registry, inbox_reclassify, inbox_reclassify_v2, inbox_scan, inbox_scan_folder,
    inbox_stats, inbox_target_recommendations,
};
use crate::commands::ingestion::{ingestion_settings_get, ingestion_settings_update};
use crate::commands::inventory::inventory_list;
use crate::commands::inventory_frame::{
    inventory_frame_list, inventory_frame_relink, inventory_reconcile_run,
    inventory_root_config_get, inventory_root_config_set,
};
use crate::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, lifecycle_transition_preview,
    provenance_read, AppState,
};
use crate::commands::log::{log_export, log_recent};
use crate::commands::manifests::{
    manifest_get, manifest_list, manifest_reveal_in_os, note_get, note_update,
};
use crate::commands::native::{native_directory_pick, native_file_pick, native_reveal};
use crate::commands::patterns::{
    pattern_path_preview, pattern_preview, pattern_resolve, pattern_validate,
};
use crate::commands::plan_apply::{
    plans_apply_direct, plans_apply_real, plans_apply_status, plans_cancel, plans_item_retry,
    plans_item_skip, plans_resume,
};
use crate::commands::plans::{
    archive_list, archive_permanently_delete, archive_plan_generate, archive_send_to_trash,
    plans_approve, plans_discard, plans_get, plans_list, plans_retry,
};
use crate::commands::preferences::{preferences_get, preferences_set};
use crate::commands::prepared_views::{
    preparedview_list, preparedview_regenerate, preparedview_remove, sourceview_destination_get,
    sourceview_destination_set, sourceview_generate, sourceview_verify,
};
use crate::commands::projects::{
    projects_channels_dismiss_drift, projects_channels_reinfer, projects_create,
    projects_create_plan, projects_get, projects_list, projects_source_add, projects_source_remove,
    projects_update,
};
use crate::commands::protection::{
    plan_protection_check_cmd, protection_plan_acknowledged, source_protection_get,
    source_protection_set,
};
use crate::commands::review::review_queue;
use crate::commands::roots::{
    equipment_list, roots_delete, roots_list, roots_register, roots_remap, roots_remap_apply,
    scan_start, sources_set_active, sources_set_organization_state,
};
use crate::commands::search::search_global;
use crate::commands::sessions::{
    sessions_calendar, sessions_get, sessions_list, sessions_merge, sessions_split,
};
use crate::commands::settings::{
    settings_get, settings_overridable_keys, settings_restore_defaults,
    settings_source_override_set, settings_update,
};
use crate::commands::status::status_summary;
use crate::commands::target_favourites::{
    target_favourites_add, target_favourites_list, target_favourites_remove,
};
use crate::commands::target_lookup::{
    target_adopt, target_astro_format_batch, target_cache_clear, target_cone_search_confirm,
    target_cone_search_suggest, target_resolution_settings, target_resolution_settings_update,
    target_resolve, target_resolve_explicit, target_search,
};
use crate::commands::target_management as target_mgmt_cmds;
use crate::commands::targets::{targets_get, targets_list};
use crate::commands::tools::{
    tools_discover, tools_launch, tools_list, tools_update, tools_validate_path,
};
use crate::commands::tour::tour_complete_step;

pub const CRATE_NAME: &str = "desktop_shell";

/// Shared base for specta builder — chain common config and all production
/// commands.  Returns the builder before any feature-gated commands are added.
///
/// # Panics / Design Note
/// `collect_commands!` does not accept `cfg` attributes inside its token list,
/// so feature-gated commands must be added in a *separate* `.commands()` call
/// on a different `Builder` value.  Because `.commands()` **replaces** the
/// command set, we handle this by having two cfg-gated public `specta_builder`
/// functions that each call `.commands()` exactly once with the full command
/// list for that build variant.
fn base_builder() -> Builder<tauri::Wry> {
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
        // Spec 042 T011 — ErrorCode enum scaffold. Registered here so the
        // TypeScript union is emitted immediately without waiting for the
        // ContractError.code type change (US2).
        .typ::<contracts_core::error_code::ErrorCode>()
        // Spec 035 — SIMBAD target resolution DTOs (T007). These are pure
        // contract types whose commands land in later tasks (US1–5); register
        // them explicitly so the TypeScript surface exists ahead of the
        // commands that will reference them. Request/response roots pull in all
        // nested structs and enums transitively.
        .typ::<contracts_core::targets::TargetSearchRequest>()
        .typ::<contracts_core::targets::TargetSearchResponse>()
        .typ::<contracts_core::targets::TargetResolveSimbadRequest>()
        .typ::<contracts_core::targets::TargetResolveSimbadResponse>()
        .typ::<contracts_core::targets::ResolverSettingsGetRequest>()
        .typ::<contracts_core::targets::ResolverSettingsUpdateRequest>()
        .typ::<contracts_core::targets::ResolverSettingsResponse>()
}

/// Build the tauri-specta [`Builder`] populated with every typed command.
///
/// Reused by `run` (production) and `tests/bindings.rs` (TS emission).
///
/// When the `dev-tools` feature is enabled this function includes the
/// `dev.contracts.list`, `dev.calls.list`, and `dev.export` commands.
/// Without the feature those commands are absent from the binary entirely.
#[must_use]
#[allow(clippy::too_many_lines)]
#[cfg(not(feature = "dev-tools"))]
pub fn specta_builder() -> Builder<tauri::Wry> {
    base_builder().commands(collect_commands![
        // lifecycle (spec 002)
        provenance_read,
        lifecycle_transition_apply,
        lifecycle_transition_preview,
        lifecycle_ledger_list,
        // sessions
        sessions_list,
        sessions_get,
        sessions_calendar,
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
        // targets (spec 029 stubs — legacy list/get)
        targets_list,
        targets_get,
        // target management (spec 036 — gen-3, canonical_target model)
        target_mgmt_cmds::target_get,
        target_mgmt_cmds::target_list,
        target_mgmt_cmds::target_alias_add,
        target_mgmt_cmds::target_alias_remove,
        target_mgmt_cmds::target_display_alias_set,
        target_mgmt_cmds::target_display_alias_clear,
        // target history + notes (spec 023 US2/US3/US4)
        target_mgmt_cmds::target_sessions_list,
        target_mgmt_cmds::target_projects_list,
        target_mgmt_cmds::target_note_get,
        target_mgmt_cmds::target_note_update,
        // target favourites (spec 051 US2)
        target_favourites_list,
        target_favourites_add,
        target_favourites_remove,
        // target resolve (spec 035 — SIMBAD cache-first resolution)
        target_resolve,
        // target resolve — explicit entrypoint, TAP-first/Sesame-fallback (spec 052 P2)
        target_resolve_explicit,
        // target search (spec 035, US1)
        target_search,
        // target in-use promotion + resolve-cache clear (spec 052 P1)
        target_adopt,
        target_cache_clear,
        // cone-search suggestion at Inbox ingest (spec 052 P3)
        target_cone_search_suggest,
        target_cone_search_confirm,
        // resolver settings (spec 035, US5)
        target_resolution_settings,
        target_resolution_settings_update,
        // sexagesimal RA/Dec formatting (adopt target-match)
        target_astro_format_batch,
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
        archive_list,
        archive_plan_generate,
        // plan apply (spec 025)
        plans_apply_real,
        // channel-free plan apply variant (spec 037)
        plans_apply_direct,
        plans_cancel,
        plans_resume,
        plans_item_skip,
        plans_item_retry,
        plans_apply_status,
        // audit
        audit_list,
        audit_export,
        // log stream (spec 019)
        log_recent,
        log_export,
        // review
        review_queue,
        // roots & scan & equipment
        roots_list,
        roots_register,
        roots_register_batch,
        roots_remap,
        roots_remap_apply,
        roots_delete,
        scan_start,
        equipment_list,
        sources_set_organization_state,
        sources_set_active,
        // first-run wizard (spec 003)
        firstrun_state,
        firstrun_complete,
        firstrun_restart,
        // pattern resolver (spec 015)
        pattern_validate,
        pattern_resolve,
        pattern_preview,
        pattern_path_preview,
        // source protection (spec 016 US2–US4)
        source_protection_get,
        source_protection_set,
        plan_protection_check_cmd,
        protection_plan_acknowledged,
        // settings (spec 018)
        settings_get,
        settings_update,
        settings_restore_defaults,
        settings_source_override_set,
        settings_overridable_keys,
        // preferences
        preferences_get,
        preferences_set,
        // search
        search_global,
        // tour
        tour_complete_step,
        // guided first-project-flow (spec 010)
        guided_state_get,
        guided_step_complete,
        guided_dismiss,
        guided_restart,
        guided_activate,
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
        cleanup_plan_generate,
        cleanup_raw_frames_scan,
        cleanup_raw_frames_generate,
        // calibration tolerances (spec 030)
        calibration_tolerances_get,
        calibration_tolerances_update,
        // inbox (spec 005 + 030 + 039 + 041)
        inbox_scan,
        inbox_scan_folder,
        inbox_classify,
        inbox_confirm,
        inbox_reclassify,
        inbox_reclassify_v2,
        inbox_item_metadata,
        inbox_list,
        inbox_plan,
        inbox_plan_apply,
        inbox_plan_apply_all,
        inbox_plan_apply_selected,
        inbox_plan_cancel,
        inbox_stats,
        inbox_plan_list_open,
        inbox_property_registry,
        inbox_target_recommendations,
        // inventory (spec 006)
        inventory_list,
        // per-frame inventory (spec 048)
        inventory_frame_list,
        inventory_reconcile_run,
        inventory_frame_relink,
        inventory_root_config_get,
        inventory_root_config_set,
        // ingestion settings (spec 030)
        ingestion_settings_get,
        ingestion_settings_update,
        // tools (spec 011/030)
        tools_launch,
        tools_list,
        tools_update,
        tools_validate_path,
        tools_discover,
        // artifacts (spec 012)
        artifact_list,
        artifact_classify,
        artifact_mark_resolved,
        artifact_watcher_attach,
        artifact_watcher_detach,
        // manifests + notes (spec 024)
        manifest_list,
        manifest_get,
        note_get,
        note_update,
        manifest_reveal_in_os,
        // prepared source views (spec 026)
        preparedview_list,
        preparedview_remove,
        preparedview_regenerate,
        // source view generation (spec 049)
        sourceview_generate,
        sourceview_verify,
        sourceview_destination_get,
        sourceview_destination_set,
    ])
}

/// `dev-tools` variant: identical to the production builder plus the three
/// developer-diagnostics commands (spec 021).
///
/// Release binaries MUST NOT be compiled with the `dev-tools` feature.
#[must_use]
#[allow(clippy::too_many_lines)]
#[cfg(feature = "dev-tools")]
pub fn specta_builder() -> Builder<tauri::Wry> {
    base_builder().commands(collect_commands![
        // lifecycle (spec 002)
        provenance_read,
        lifecycle_transition_apply,
        lifecycle_transition_preview,
        lifecycle_ledger_list,
        // sessions
        sessions_list,
        sessions_get,
        sessions_calendar,
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
        // targets (spec 029 stubs — legacy list/get)
        targets_list,
        targets_get,
        // target management (spec 036 — gen-3, canonical_target model)
        target_mgmt_cmds::target_get,
        target_mgmt_cmds::target_list,
        target_mgmt_cmds::target_alias_add,
        target_mgmt_cmds::target_alias_remove,
        target_mgmt_cmds::target_display_alias_set,
        target_mgmt_cmds::target_display_alias_clear,
        // target history + notes (spec 023 US2/US3/US4)
        target_mgmt_cmds::target_sessions_list,
        target_mgmt_cmds::target_projects_list,
        target_mgmt_cmds::target_note_get,
        target_mgmt_cmds::target_note_update,
        // target favourites (spec 051 US2)
        target_favourites_list,
        target_favourites_add,
        target_favourites_remove,
        // target resolve (spec 035 — SIMBAD cache-first resolution)
        target_resolve,
        // target resolve — explicit entrypoint, TAP-first/Sesame-fallback (spec 052 P2)
        target_resolve_explicit,
        // target search (spec 035, US1)
        target_search,
        // target in-use promotion + resolve-cache clear (spec 052 P1)
        target_adopt,
        target_cache_clear,
        // cone-search suggestion at Inbox ingest (spec 052 P3)
        target_cone_search_suggest,
        target_cone_search_confirm,
        // resolver settings (spec 035, US5)
        target_resolution_settings,
        target_resolution_settings_update,
        // sexagesimal RA/Dec formatting (adopt target-match)
        target_astro_format_batch,
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
        archive_list,
        archive_plan_generate,
        // plan apply (spec 025)
        plans_apply_real,
        // channel-free plan apply variant (spec 037)
        plans_apply_direct,
        plans_cancel,
        plans_resume,
        plans_item_skip,
        plans_item_retry,
        plans_apply_status,
        // audit
        audit_list,
        audit_export,
        // log stream (spec 019)
        log_recent,
        log_export,
        // review
        review_queue,
        // roots & scan & equipment
        roots_list,
        roots_register,
        roots_register_batch,
        roots_remap,
        roots_remap_apply,
        roots_delete,
        scan_start,
        equipment_list,
        sources_set_organization_state,
        sources_set_active,
        // first-run wizard (spec 003)
        firstrun_state,
        firstrun_complete,
        firstrun_restart,
        // pattern resolver (spec 015)
        pattern_validate,
        pattern_resolve,
        pattern_preview,
        pattern_path_preview,
        // source protection (spec 016 US2–US4)
        source_protection_get,
        source_protection_set,
        plan_protection_check_cmd,
        protection_plan_acknowledged,
        // settings (spec 018)
        settings_get,
        settings_update,
        settings_restore_defaults,
        settings_source_override_set,
        settings_overridable_keys,
        // preferences
        preferences_get,
        preferences_set,
        // search
        search_global,
        // tour
        tour_complete_step,
        // guided first-project-flow (spec 010)
        guided_state_get,
        guided_step_complete,
        guided_dismiss,
        guided_restart,
        guided_activate,
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
        cleanup_plan_generate,
        cleanup_raw_frames_scan,
        cleanup_raw_frames_generate,
        // calibration tolerances (spec 030)
        calibration_tolerances_get,
        calibration_tolerances_update,
        // inbox (spec 005 + 030 + 039 + 041)
        inbox_scan,
        inbox_scan_folder,
        inbox_classify,
        inbox_confirm,
        inbox_reclassify,
        inbox_reclassify_v2,
        inbox_item_metadata,
        inbox_list,
        inbox_plan,
        inbox_plan_apply,
        inbox_plan_apply_all,
        inbox_plan_apply_selected,
        inbox_plan_cancel,
        inbox_stats,
        inbox_plan_list_open,
        inbox_property_registry,
        inbox_target_recommendations,
        // inventory (spec 006)
        inventory_list,
        // per-frame inventory (spec 048)
        inventory_frame_list,
        inventory_reconcile_run,
        inventory_frame_relink,
        inventory_root_config_get,
        inventory_root_config_set,
        // ingestion settings (spec 030)
        ingestion_settings_get,
        ingestion_settings_update,
        // tools (spec 011/030)
        tools_launch,
        tools_list,
        tools_update,
        tools_validate_path,
        tools_discover,
        // artifacts (spec 012)
        artifact_list,
        artifact_classify,
        artifact_mark_resolved,
        artifact_watcher_attach,
        artifact_watcher_detach,
        // manifests + notes (spec 024)
        manifest_list,
        manifest_get,
        note_get,
        note_update,
        manifest_reveal_in_os,
        // prepared source views (spec 026)
        preparedview_list,
        preparedview_remove,
        preparedview_regenerate,
        // source view generation (spec 049)
        sourceview_generate,
        sourceview_verify,
        sourceview_destination_get,
        sourceview_destination_set,
        // developer diagnostics (spec 021) — dev-tools build only
        dev_contracts_list,
        dev_calls_list,
        dev_export,
        dev_schema_get,
    ])
}

/// Menu id for the native "Settings…" application-menu item (spec 051 US5).
const MENU_ID_SETTINGS: &str = "menu-settings";

/// Enforce the min-size floor (spec 051 US4, T029) after
/// `tauri-plugin-window-state` restores a persisted size, in case a prior
/// app version persisted a smaller size than the current `tauri.conf.json`
/// `minWidth`/`minHeight` (1100x720) — mirrors the `astro-up` reference's own
/// explicit post-restore clamp (research.md's cited `lib.rs` excerpt).
fn enforce_min_window_size(window: &tauri::WebviewWindow) {
    const MIN_WIDTH: u32 = 1100;
    const MIN_HEIGHT: u32 = 720;

    if let Ok(size) = window.inner_size() {
        let w = size.width.max(MIN_WIDTH);
        let h = size.height.max(MIN_HEIGHT);
        if w != size.width || h != size.height {
            if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w, h))) {
                tracing::warn!("failed to enforce minimum window size: {e:?}");
            } else {
                tracing::info!(width = w, height = h, "enforced minimum window size");
            }
        }
    }
}

/// Off-screen-position fallback (spec 051 US4, T030/FR-013): if the restored
/// position has no overlap with any currently-connected display (e.g. a
/// second monitor the window was on has since been disconnected), recenter
/// the window instead of leaving it stranded off-screen.
fn recenter_if_offscreen(window: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(monitors)) =
        (window.outer_position(), window.outer_size(), window.available_monitors())
    else {
        return;
    };

    let win_right = pos.x + i32::try_from(size.width).unwrap_or(i32::MAX);
    let win_bottom = pos.y + i32::try_from(size.height).unwrap_or(i32::MAX);

    let on_screen = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        let mon_right = mp.x + i32::try_from(ms.width).unwrap_or(i32::MAX);
        let mon_bottom = mp.y + i32::try_from(ms.height).unwrap_or(i32::MAX);
        // Any overlap between the window rect and this monitor's rect.
        pos.x < mon_right && win_right > mp.x && pos.y < mon_bottom && win_bottom > mp.y
    });

    if !on_screen {
        if let Err(e) = window.center() {
            tracing::warn!("failed to recenter off-screen window: {e:?}");
        } else {
            tracing::info!("restored window position was off-screen; recentered");
        }
    }
}

/// Build the native application menu (spec 051 US5, T032): an App submenu
/// (About, Settings, Quit), a Window submenu, and a standard Edit submenu
/// (copy/cut/paste/select-all/undo/redo). The "Settings…" item has no native
/// dialog of its own — its click is handled by `on_menu_event` in
/// `build_app()`, which emits a frontend event for the existing Settings
/// route to handle (T033: reuse existing UI, no new native dialog).
fn build_native_menu(app: &tauri::App<tauri::Wry>) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = PredefinedMenuItem::about(app, Some("About PlateVault"), None)?;
    let settings =
        MenuItem::with_id(app, MENU_ID_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = Submenu::with_items(
        app,
        "PlateVault",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::close_window(app, None)?],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
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

    #[allow(unused_mut)]
    let mut tb = tauri::Builder::default()
        // Spec 051 US1: single-instance guard MUST be the first plugin
        // registered so a redirected second launch is intercepted during
        // `.build()` below — before any other plugin/state/window setup, and
        // therefore before `main()` ever reaches `Database::connect`/
        // `db.migrate()` (FR-003: the second launch performs no database
        // migration, seed, or write of its own).
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            tracing::info!(
                ?argv,
                %cwd,
                "second launch attempt redirected to existing instance"
            );
            // FR-002: focus/foreground the existing main window, restoring it
            // if minimized, instead of opening a new window or connection.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.unminimize() {
                    tracing::warn!("failed to unminimize main window: {e:?}");
                }
                if let Err(e) = window.show() {
                    tracing::warn!("failed to show main window: {e:?}");
                }
                if let Err(e) = window.set_focus() {
                    tracing::warn!("failed to focus main window: {e:?}");
                }
            } else {
                tracing::warn!("single-instance redirect: no `main` window found to focus");
            }
        }))
        // Spec 051 US4 (T027): window-state persistence. Registered right
        // after single-instance so a redirected second launch (which never
        // creates a window of its own) never touches this plugin's store
        // file. `window-state:default` is granted in
        // `capabilities/default.json` (T028).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Spec 051 US10 (T056): signed auto-update plugin. `updater:default` +
        // `process:default` (for the relaunch-to-apply step) are granted in
        // `capabilities/default.json`. The `plugins.updater.pubkey` in
        // `tauri.conf.json` is a documented placeholder until the real
        // minisign keypair/release pipeline land (T060 follow-up) — until
        // then `check_for_app_update` will only ever see "updater
        // unavailable" or a verification failure, never a real update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Spec 051 US7 (T041): diagnostics log file. `skip_logger()` is
        // required here — this app already installs a global `tracing`
        // subscriber (in `main.rs`, right after `build_app()` returns, once
        // the platform log directory is resolvable) that owns the single
        // process-wide `log`-facade logger slot via `tracing-subscriber`'s
        // default `tracing-log` bridge feature. Without `skip_logger()`, this
        // plugin would try to install a SECOND global logger and panic/lose
        // the race (FR-021's "not duplicated or dropped" requirement). With
        // it, the plugin still registers its `log` Tauri command (so
        // `@tauri-apps/plugin-log` calls from the frontend reach the ambient
        // logger), it just never owns that logger itself — the rotating file
        // target itself is `main.rs`'s `tracing_appender` layer, not this
        // plugin's own (skipped) fern dispatch.
        .plugin(tauri_plugin_log::Builder::new().skip_logger().build());

    // Tauri MCP bridge plugin (@hypothesi tauri-plugin-mcp-bridge) — dev/debug
    // builds only. Runs a WebSocket server on 0.0.0.0:9223 that the
    // @hypothesi/tauri-mcp-server MCP server connects to, letting an agent drive
    // the running app for automated UI testing. Requires `withGlobalTauri`, which
    // is enabled only via the dev-only `tauri.dev.conf.json` overlay (never in the
    // shipped config). `debug_assertions` is off in release builds, so this
    // surface is absent from shipped binaries.
    #[cfg(debug_assertions)]
    {
        tb = tb.plugin(tauri_plugin_mcp_bridge::init());
    }

    // E2E gate: embed the WebDriver server only when built with --features e2e.
    // The embedded server listens on 127.0.0.1:4445; connect via the
    // tauri-webdriver CLI (cargo install tauri-webdriver --locked) on :4444.
    // Release builds MUST omit the `e2e` feature (Constitution Principle V).
    // Complements the MCP bridge above: scripted thirtyfour+nextest gate vs.
    // agent-interactive debugging.
    #[cfg(feature = "e2e")]
    {
        tb = tb.plugin(tauri_plugin_webdriver::init());
    }

    tb
        // Spec 051 US5 (T033): the native "Settings" menu item has no native
        // dialog of its own — emit a frontend event and let the existing
        // Settings route handle navigation, matching the reference pattern
        // of reusing existing UI rather than inventing new native dialogs.
        .on_menu_event(|app, event| {
            if event.id() == MENU_ID_SETTINGS {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.emit("menu:open-settings", ()) {
                        tracing::warn!("failed to emit menu:open-settings: {e:?}");
                    }
                }
            }
            // Quit (T034): `PredefinedMenuItem::quit` already calls
            // `app.exit(0)` internally — no separate handling needed here.
            // This app has no existing close-confirmation logic to bypass
            // (verified: no `on_window_event`/`CloseRequested` handler exists
            // anywhere in this crate), so Quit is a plain, un-gated exit.
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // Spec 051 US4 (T029/T030): enforce the min-size floor and
            // off-screen fallback after tauri-plugin-window-state restores a
            // persisted size/position — it may restore geometry from a prior
            // app version or a since-disconnected monitor.
            if let Some(window) = app.get_webview_window("main") {
                enforce_min_window_size(&window);
                recenter_if_offscreen(&window);
            }

            // Spec 051 US5 (T032): native application menu — App submenu
            // (About/Settings/Quit), Window submenu, and a standard Edit
            // submenu (copy/cut/paste/select-all/undo/redo). Does not touch
            // any existing native/React context-menu code path (T035 — none
            // exists in this crate to touch).
            match build_native_menu(app) {
                Ok(menu) => {
                    if let Err(e) = app.set_menu(menu) {
                        tracing::warn!("failed to set native application menu: {e:?}");
                    }
                }
                Err(e) => tracing::warn!("failed to build native application menu: {e:?}"),
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
}

/// Check for a signed app update and, if one is available, emit an
/// `update-available` event the frontend can surface (spec 051 US10, T057).
///
/// Mirrors the reference `astro-up` `check_for_app_update` pattern: an
/// `Err` from `app.updater()` (plugin unavailable, e.g. non-bundled dev
/// builds) or from `.check()` (network/verification failure, or — until the
/// T060 follow-up replaces the placeholder `pubkey` — every real call) is
/// logged at `debug`/`warn` and treated as non-fatal (FR-031); it never
/// blocks or interrupts app startup.
pub(crate) async fn check_for_app_update(app: &AppHandle) {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            tracing::debug!("Updater not available: {e}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            tracing::info!(version = update.version.as_str(), "App update available");
            let _ = app.emit(
                "update-available",
                serde_json::json!({
                    "version": update.version,
                    "body": update.body,
                }),
            );
        }
        Ok(None) => {
            tracing::debug!("App is up to date");
        }
        Err(e) => {
            tracing::warn!("Update check failed: {e}");
        }
    }
}

/// Spawn the spec-035 US4/T043 background ingest-resolution drain.
///
/// Every interval the task rebuilds the resolver from the persisted
/// `resolver_settings`, drains the pending `ingest_resolution` queue
/// (cache-first → SIMBAD when online; cache-only when offline), then back-fills
/// `acquisition_session.canonical_target_id` for sessions whose frames resolved
/// this pass. Failures are logged, never fatal — the next pass retries.
fn spawn_ingest_resolution_drain(
    pool: SqlitePool,
    bus: EventBus,
    resolve_cache: targeting_resolver::simbad::ResolveCache,
) {
    use targeting_resolver::simbad::{SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT};
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(30);
        loop {
            tokio::time::sleep(interval).await;

            // Read resolver settings (online toggle + endpoint + timeout).
            let settings = persistence_db::repositories::q_desktop::get_resolver_settings(&pool)
                .await
                .unwrap_or(None);
            let (online_enabled, endpoint, timeout_secs) = settings.map_or_else(
                || (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10),
                |r| (r.online_enabled != 0, r.simbad_endpoint, r.request_timeout_secs),
            );

            // `SimbadResolver::new` never builds a reqwest/TLS client when
            // `online_enabled` is false (mirrors target.resolve FIX-3); cache
            // hits still resolve regardless.
            let config = SimbadConfig::from_settings(
                endpoint,
                u64::try_from(timeout_secs.max(1)).unwrap_or(10),
            );
            let drain = match SimbadResolver::new(&config, &resolve_cache, online_enabled) {
                Ok(resolver) => {
                    app_core::ingest_resolution::resolve_pending(
                        &pool,
                        &resolver,
                        Some(&bus),
                        online_enabled,
                        50,
                    )
                    .await
                }
                Err(e) => {
                    tracing::warn!("failed to build SimbadResolver for ingest drain: {e:?}");
                    continue;
                }
            };
            if let Err(e) = drain {
                tracing::warn!("ingest_resolution drain failed: {e:?}");
                continue;
            }

            // Back-fill sessions whose frames just resolved.
            if let Err(e) = app_core::ingest_sessions::backfill_session_targets(&pool).await {
                tracing::warn!("acquisition_session target back-fill failed: {e:?}");
            }
        }
    });
}

pub fn run_app(
    app: tauri::App,
    pool: SqlitePool,
    resolve_cache: targeting_resolver::simbad::ResolveCache,
    resolve_cache_path: std::path::PathBuf,
) {
    let bus = EventBus::with_pool(pool.clone());

    // Live event-bus subscribers. Start these *before* `bus`/`pool` are moved
    // into `AppState` below. Each spawns a tokio task on the runtime that
    // `#[tokio::main]` establishes around `run_app`.
    //  - spec 005: inbox plan listener → marks inbox items `resolved` once their
    //    split/restructure plan is applied.
    //  - spec 019: log forwarder → pushes audit + diagnostic entries to the
    //    webview `log:entry` channel. Forward at the most permissive level; the
    //    client filters by level.
    app_core::inbox::plan_listener::start_inbox_plan_listener(pool.clone(), &bus);
    crate::commands::log::start_log_forwarder(
        app.handle().clone(),
        &bus,
        contracts_core::log::LogLevel::Debug,
        pool.clone(),
    );
    // spec 024: manifest auto-generation on workflow-run completion.
    // The JoinHandle is intentionally dropped — the task runs independently.
    drop(app_core::project_manifests::spawn_workflow_run_subscriber(pool.clone(), bus.clone()));
    // spec 012 T008: per-project artifact filesystem watchers, attached/detached
    // via the `artifact.watcher.attach`/`artifact.watcher.detach` commands as the
    // project drawer opens/closes. No watcher runs until a project is attached.
    let artifact_watcher_registry = crate::watcher::new_artifact_watcher_registry();
    app.manage(artifact_watcher_registry);
    // spec 012 (WP-012-A): one-time, idempotent fix-up for `processing_artifacts`
    // rows the retired global root watcher (pre-#400) keyed by a library-root id
    // instead of the owning project's id. Runs once per app start, before any
    // per-project watcher attaches and records new (correctly-attributed) rows.
    {
        let fixup_pool = pool.clone();
        tokio::spawn(async move {
            match app_core::artifact::reattribute_root_keyed_artifacts(&fixup_pool).await {
                Ok((fixed, unmatched)) => {
                    if fixed > 0 || unmatched > 0 {
                        tracing::info!(
                            "artifact re-attribution fix-up: {fixed} row(s) corrected, \
                             {unmatched} row(s) left flagged (no matching project)"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("artifact re-attribution fix-up failed: {e:?}");
                }
            }
        });
    }

    // spec 018 T020: emit a settings.snapshot at session start, then every 5 minutes.
    // This gives the audit log a durable record of the active configuration even when
    // noisy keys (pattern, protectedCategories, …) haven't changed individually.
    {
        let snap_pool = pool.clone();
        let snap_bus = bus.clone();
        tokio::spawn(async move {
            // Session-start snapshot.
            if let Err(e) =
                app_core::settings::emit_snapshot(&snap_pool, &snap_bus, "session_start").await
            {
                tracing::warn!("settings.snapshot (session_start) failed: {e:?}");
            }
            // Debounce loop: emit every 5 minutes while the app is running.
            let interval = std::time::Duration::from_mins(5);
            loop {
                tokio::time::sleep(interval).await;
                if let Err(e) =
                    app_core::settings::emit_snapshot(&snap_pool, &snap_bus, "debounce_5min").await
                {
                    tracing::warn!("settings.snapshot (debounce_5min) failed: {e:?}");
                }
            }
        });
    }

    // spec 052 P1 (D2/T012): warm the shared redb resolve cache from the
    // bundled seed + existing durable canonical_target rows, in the
    // background — each cache entry is its own fsync'd write transaction, so
    // warming the full ~14k-object popular seed synchronously would freeze
    // startup for many seconds. First-run-guarded (`warm_bundled_on_first_run`
    // no-ops once already warmed); failure degrades to seed+cache typeahead
    // simply being emptier until the next launch, never blocks the UI.
    {
        let warm_cache = resolve_cache.cache();
        let warm_pool = pool.clone();
        tokio::spawn(async move {
            let namespace = simbad_resolver::identity::namespace("astro-plan.targets");
            match targeting_resolver::seed::warm_bundled_on_first_run(&warm_cache, &namespace).await
            {
                Ok(Some(count)) => tracing::info!("warmed {count} bundled target seed entries"),
                Ok(None) => tracing::debug!("resolve cache already warmed; skipping bundled seed"),
                Err(e) => tracing::warn!("failed to warm bundled target seed: {e}"),
            }
            match targeting_resolver::seed::warm_from_canonical_target(
                &warm_cache,
                &warm_pool,
                &namespace,
            )
            .await
            {
                Ok(count) if count > 0 => {
                    tracing::info!(
                        "warmed {count} durable canonical_target rows into resolve cache"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("failed to warm resolve cache from canonical_target: {e}"),
            }
        });
    }

    // spec 035 US4/T043: background ingest-resolution drain + session target
    // back-fill on an interval. Non-blocking; transient/offline outcomes leave
    // rows pending for the next pass.
    spawn_ingest_resolution_drain(pool.clone(), bus.clone(), resolve_cache.clone());

    // spec 051 US10 (T057): startup self-update check. Non-blocking, non-fatal
    // (FR-031) — failures/unavailability are logged and otherwise ignored.
    {
        let handle = app.handle().clone();
        tokio::spawn(async move {
            check_for_app_update(&handle).await;
        });
    }

    // Inbox + inventory commands take `State<'_, SqlitePool>` directly (rather
    // than via AppState), so the raw pool must be managed too. Without this they
    // fail at runtime with "state not managed for field `pool`" — which is why
    // the Inbox scan/classify pipeline only ever worked under mock mode.
    app.manage(pool.clone());

    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus, resolve_cache, resolve_cache_path);

    app.manage(state);

    // Developer diagnostics call buffer (spec 021).
    // Always managed so the type is available; only populated when dev-tools
    // feature is compiled in and devMode is on at runtime.
    #[cfg(feature = "dev-tools")]
    app.manage(CallBuffer::new());

    app.run(|_handle, _event| {});
}
