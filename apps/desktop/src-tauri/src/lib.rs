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

use crate::commands::artifacts::{artifact_classify, artifact_list, artifact_mark_resolved};
use crate::commands::audit::{audit_export, audit_list};
use crate::commands::calibration::{
    calibration_masters_get, calibration_masters_list, calibration_match_assign,
    calibration_match_suggest, calibration_match_suggest_batch, calibration_matches,
};
use crate::commands::calibration_tolerances::{
    calibration_tolerances_get, calibration_tolerances_update,
};
use crate::commands::cleanup::{cleanup_policy_get, cleanup_policy_update, cleanup_scan};
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
    inbox_reclassify, inbox_scan, inbox_scan_folder, inbox_stats,
};
use crate::commands::ingestion::{ingestion_settings_get, ingestion_settings_update};
use crate::commands::inventory::{inventory_list, inventory_session_review};
use crate::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, lifecycle_transition_preview,
    provenance_read, AppState,
};
use crate::commands::log::{log_export, log_recent};
use crate::commands::manifests::{
    manifest_get, manifest_list, manifest_reveal_in_os, note_get, note_update,
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
use crate::commands::prepared_views::{
    preparedview_list, preparedview_regenerate, preparedview_remove,
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
    equipment_list, roots_list, roots_register, roots_remap, roots_remap_apply, scan_start,
    sources_set_organization_state,
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
use crate::commands::target_lookup::{
    target_resolution_settings, target_resolution_settings_update, target_resolve, target_search,
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
        // target resolve (spec 035 — SIMBAD cache-first resolution)
        target_resolve,
        // target search (spec 035, US1)
        target_search,
        // resolver settings (spec 035, US5)
        target_resolution_settings,
        target_resolution_settings_update,
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
        scan_start,
        equipment_list,
        sources_set_organization_state,
        // first-run wizard (spec 003)
        firstrun_state,
        firstrun_complete,
        firstrun_restart,
        // pattern resolver (spec 015)
        pattern_validate,
        pattern_resolve,
        pattern_preview,
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
        // calibration tolerances (spec 030)
        calibration_tolerances_get,
        calibration_tolerances_update,
        // inbox (spec 005 + 030 + 039 + 041)
        inbox_scan,
        inbox_scan_folder,
        inbox_classify,
        inbox_confirm,
        inbox_reclassify,
        inbox_item_metadata,
        inbox_list,
        inbox_plan,
        inbox_plan_apply,
        inbox_plan_apply_all,
        inbox_plan_apply_selected,
        inbox_plan_cancel,
        inbox_stats,
        inbox_plan_list_open,
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
        // artifacts (spec 012)
        artifact_list,
        artifact_classify,
        artifact_mark_resolved,
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
        // target resolve (spec 035 — SIMBAD cache-first resolution)
        target_resolve,
        // target search (spec 035, US1)
        target_search,
        // resolver settings (spec 035, US5)
        target_resolution_settings,
        target_resolution_settings_update,
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
        scan_start,
        equipment_list,
        sources_set_organization_state,
        // first-run wizard (spec 003)
        firstrun_state,
        firstrun_complete,
        firstrun_restart,
        // pattern resolver (spec 015)
        pattern_validate,
        pattern_resolve,
        pattern_preview,
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
        // calibration tolerances (spec 030)
        calibration_tolerances_get,
        calibration_tolerances_update,
        // inbox (spec 005 + 030 + 039 + 041)
        inbox_scan,
        inbox_scan_folder,
        inbox_classify,
        inbox_confirm,
        inbox_reclassify,
        inbox_item_metadata,
        inbox_list,
        inbox_plan,
        inbox_plan_apply,
        inbox_plan_apply_all,
        inbox_plan_apply_selected,
        inbox_plan_cancel,
        inbox_stats,
        inbox_plan_list_open,
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
        // artifacts (spec 012)
        artifact_list,
        artifact_classify,
        artifact_mark_resolved,
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
        // developer diagnostics (spec 021) — dev-tools build only
        dev_contracts_list,
        dev_calls_list,
        dev_export,
        dev_schema_get,
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

    #[allow(unused_mut)]
    let mut tb = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

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

    tb.invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
}

/// Spawn the spec-035 US4/T043 background ingest-resolution drain.
///
/// Every interval the task rebuilds the resolver from the persisted
/// `resolver_settings`, drains the pending `ingest_resolution` queue
/// (cache-first → SIMBAD when online; cache-only when offline), then back-fills
/// `acquisition_session.canonical_target_id` for sessions whose frames resolved
/// this pass. Failures are logged, never fatal — the next pass retries.
fn spawn_ingest_resolution_drain(pool: SqlitePool, bus: EventBus) {
    use targeting_resolver::simbad::{
        OfflineResolver, SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT,
    };
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(30);
        loop {
            tokio::time::sleep(interval).await;

            // Read resolver settings (online toggle + endpoint + timeout).
            let settings: Option<(i64, String, i64)> = sqlx::query_as(
                "SELECT online_enabled, simbad_endpoint, request_timeout_secs \
                 FROM resolver_settings WHERE id = 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
            let (online_enabled, endpoint, timeout_secs) = settings.map_or_else(
                || (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10),
                |(o, e, t)| (o != 0, e, t),
            );

            // When online, build a SimbadResolver (falling back to offline if the
            // client fails to build, mirroring target.resolve FIX-3); otherwise
            // drain cache-only.
            let drain = if online_enabled {
                let config = SimbadConfig::from_settings(
                    endpoint,
                    u64::try_from(timeout_secs.max(1)).unwrap_or(10),
                );
                match SimbadResolver::new(&config) {
                    Ok(resolver) => {
                        app_core::ingest_resolution::resolve_pending(
                            &pool,
                            &resolver,
                            Some(&bus),
                            true,
                            50,
                        )
                        .await
                    }
                    Err(_) => {
                        app_core::ingest_resolution::resolve_pending(
                            &pool,
                            &OfflineResolver,
                            Some(&bus),
                            false,
                            50,
                        )
                        .await
                    }
                }
            } else {
                app_core::ingest_resolution::resolve_pending(
                    &pool,
                    &OfflineResolver,
                    Some(&bus),
                    false,
                    50,
                )
                .await
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

pub fn run_app(app: tauri::App, pool: SqlitePool) {
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
    // spec 012: artifact filesystem watcher → artifact.detected + artifact.classified events.
    crate::watcher::spawn_artifact_watcher(pool.clone(), bus.clone());

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

    // spec 035 US4/T043: background ingest-resolution drain + session target
    // back-fill on an interval. Non-blocking; transient/offline outcomes leave
    // rows pending for the next pass.
    spawn_ingest_resolution_drain(pool.clone(), bus.clone());

    // Inbox + inventory commands take `State<'_, SqlitePool>` directly (rather
    // than via AppState), so the raw pool must be managed too. Without this they
    // fail at runtime with "state not managed for field `pool`" — which is why
    // the Inbox scan/classify pipeline only ever worked under mock mode.
    app.manage(pool.clone());

    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus);

    app.manage(state);

    // Developer diagnostics call buffer (spec 021).
    // Always managed so the type is available; only populated when dev-tools
    // feature is compiled in and devMode is on at runtime.
    #[cfg(feature = "dev-tools")]
    app.manage(CallBuffer::new());

    app.run(|_handle, _event| {});
}
