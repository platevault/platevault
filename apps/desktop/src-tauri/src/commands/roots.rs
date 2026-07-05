//! Root/scan/equipment commands exposed to the Tauri webview.
//!
//! `roots.register`, `roots.list`, `roots.remap`, and `roots.remap.apply`
//! delegate to the persistence layer via `app_core::first_run`.
//! `roots.list`'s `lastScanned` is derived from `inbox_source_groups`
//! (populated by the real `inbox.scan_folder` command the frontend "Rescan"
//! button now calls — P6a) and its `active` flag is derived from
//! `registered_sources.active` (P6b). `scan.start` remains a stub (unused by
//! the frontend as of P6a; kept for forward-compat) and `equipment.list` is a
//! stub until the real persistence layer is wired.
//!
//! `sources.set_active` and `roots.delete` (P6b) delegate to
//! `app_core::first_run::set_source_active`/`delete_source`. `roots.delete`
//! blocks with `root.has_dependents` when dependent records exist (decision
//! D8) — it never cascades or touches files on disk (constitution §I).

use contracts_core::first_run::{
    OrganizationState, RegisterSourceRequest, RegisterSourceResponse, ScanDepth,
    SetSourceOrganizationStateRequest, SetSourceOrganizationStateResponse, SourceKind,
};
use contracts_core::roots::{
    Equipment, IpcOperationHandle, LibraryRoot, RemapVerification, RootCategory,
};
use contracts_core::ContractError;
use contracts_core::JsonAny;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `roots.list` — returns all registered library roots from the database.
///
/// Each root's `online` flag reflects whether the path is currently accessible.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn roots_list(state: State<'_, AppState>) -> Result<Vec<LibraryRoot>, ContractError> {
    tracing::debug!("roots.list");

    let sources = persistence_db::repositories::first_run::list_sources(state.repo.pool())
        .await
        .map_err(|e| ContractError::internal(e.to_string()))?;

    // `lastScanned` is derived from `inbox_source_groups.last_scanned_at`
    // (P6a): every root kind is scanned through `inbox.scan_folder` (setup
    // wizard + Settings "Rescan"), so a root with no source-group rows simply
    // has never been scanned yet.
    let last_scanned = persistence_db::repositories::inbox::last_scanned_by_root(state.repo.pool())
        .await
        .map_err(|e| ContractError::internal(e.to_string()))?;

    // `active` is derived from `registered_sources.active` (P6b — Data
    // Sources Disable/Enable). Sources absent from the map (should not
    // happen post-migration, but defensive) default to active.
    let active_flags =
        persistence_db::repositories::first_run::list_active_flags(state.repo.pool())
            .await
            .map_err(|e| ContractError::internal(e.to_string()))?;

    let roots = sources
        .into_iter()
        .map(|s| {
            let online = std::path::Path::new(&s.path).exists();
            let category = match s.kind {
                contracts_core::first_run::SourceKind::Calibration => RootCategory::Calibration,
                contracts_core::first_run::SourceKind::Project => RootCategory::Project,
                contracts_core::first_run::SourceKind::Inbox => RootCategory::Inbox,
                contracts_core::first_run::SourceKind::LightFrames => RootCategory::Raw,
            };
            let last_scanned = last_scanned.get(&s.source_id).cloned();
            let active = active_flags.get(&s.source_id).copied().unwrap_or(true);
            LibraryRoot {
                id: s.source_id,
                path: s.path,
                category,
                online,
                file_count: 0,
                last_scanned,
                active,
            }
        })
        .collect();

    Ok(roots)
}

/// `roots.register` — register a new library root.
///
/// Delegates to `app_core::first_run::register_source` for path validation,
/// duplicate detection, and persistence. The `scan_settings` parameter is
/// reserved for future scan configuration; currently only `scanDepth` is
/// extracted.
///
/// # Errors
/// Returns `Err(String)` on path validation failure, duplicate, or DB error.
#[tauri::command]
#[specta::specta]
pub async fn roots_register(
    state: State<'_, AppState>,
    path: String,
    category: String,
    scan_settings: JsonAny,
) -> Result<RegisterSourceResponse, ContractError> {
    tracing::debug!(
        "roots.register path={path} category={category} scan_settings={scan_settings:?}"
    );

    let kind = match category.as_str() {
        "calibration" => SourceKind::Calibration,
        "project" => SourceKind::Project,
        "inbox" => SourceKind::Inbox,
        // "light_frames" and any unknown category default to LightFrames.
        _ => SourceKind::LightFrames,
    };

    // Extract scan_depth from scan_settings if provided.
    let scan_depth = scan_settings.0.get("scanDepth").and_then(|v| v.as_str()).map_or(
        ScanDepth::Recursive,
        |s| match s {
            "single" => ScanDepth::Single,
            _ => ScanDepth::Recursive,
        },
    );

    // Inbox sources are always unorganized; all other sources default to organized.
    let organization_state = if kind == SourceKind::Inbox {
        contracts_core::first_run::OrganizationState::Unorganized
    } else {
        contracts_core::first_run::OrganizationState::Organized
    };

    let req =
        RegisterSourceRequest { kind, path, kind_subtype: None, scan_depth, organization_state };

    app_core::first_run::register_source(state.repo.pool(), &req).await
}

/// `sources.set_organization_state` — change a source's organization state
/// (spec 041, T030). Affects only future confirms; inbox sources may not be
/// set to `organized`.
///
/// # Errors
/// Returns `Err(String)` on `source.invalid_organization_state`,
/// `source.not_found`, or DB error.
#[tauri::command]
#[specta::specta]
pub async fn sources_set_organization_state(
    state: State<'_, AppState>,
    source_id: String,
    organization_state: OrganizationState,
) -> Result<SetSourceOrganizationStateResponse, String> {
    tracing::debug!(
        "sources.set_organization_state source_id={source_id} state={organization_state:?}"
    );

    let req = SetSourceOrganizationStateRequest { source_id, organization_state };

    app_core::first_run::set_source_organization_state(state.repo.pool(), &req)
        .await
        .map_err(|e| e.message)
}

/// `roots.remap` — preview a root path remap (P6a).
///
/// Delegates to `app_core::first_run::remap_root` for path validation and
/// sample-path verification against the real `registered_sources` row.
///
/// # Errors
/// Returns `ContractError` (`source.not_found`, `path.not_exists`,
/// `path.not_directory`, `path.permission_denied`, or `internal.database`).
#[tauri::command]
#[specta::specta]
pub async fn roots_remap(
    state: State<'_, AppState>,
    root_id: String,
    new_path: String,
) -> Result<RemapVerification, ContractError> {
    tracing::debug!("roots.remap root_id={root_id} new_path={new_path}");
    app_core::first_run::remap_root(state.repo.pool(), &root_id, &new_path).await
}

/// `roots.remap.apply` — apply a previously previewed root remap (P6a).
///
/// Delegates to `app_core::first_run::apply_root_remap`, which updates the
/// root's stored path in `registered_sources` and publishes a `root.remapped`
/// audit event.
///
/// # Errors
/// Returns `ContractError` (`source.not_found`, `path.not_exists`,
/// `path.not_directory`, `path.permission_denied`, or `internal.database`).
#[tauri::command]
#[specta::specta]
pub async fn roots_remap_apply(
    state: State<'_, AppState>,
    root_id: String,
    new_path: String,
    verified: bool,
) -> Result<(), ContractError> {
    tracing::debug!("roots.remap.apply root_id={root_id} new_path={new_path} verified={verified}");
    app_core::first_run::apply_root_remap(
        state.repo.pool(),
        &state.bus,
        &root_id,
        &new_path,
        verified,
    )
    .await
}

/// `sources.set_active` — enable or disable a registered source (P6b).
///
/// Delegates to `app_core::first_run::set_source_active`. Disabled roots are
/// excluded from scan/ingest surfaces but retain their full history; this is
/// a visibility flag, not a deletion.
///
/// # Errors
/// Returns `ContractError` (`source.not_found` or `internal.database`).
#[tauri::command]
#[specta::specta]
pub async fn sources_set_active(
    state: State<'_, AppState>,
    root_id: String,
    active: bool,
) -> Result<(), ContractError> {
    tracing::debug!("sources.set_active root_id={root_id} active={active}");
    app_core::first_run::set_source_active(state.repo.pool(), &state.bus, &root_id, active).await
}

/// `roots.delete` — permanently remove a root's registration (P6b, decision D8).
///
/// Delegates to `app_core::first_run::delete_source`, which blocks with
/// `root.has_dependents` when dependent records (inbox items, plan items,
/// file records, sessions) still reference the root — no cascade-nullify.
/// Files on disk are never touched (constitution §I).
///
/// # Errors
/// Returns `ContractError` (`source.not_found`, `root.has_dependents`, or
/// `internal.database`).
#[tauri::command]
#[specta::specta]
pub async fn roots_delete(
    state: State<'_, AppState>,
    root_id: String,
) -> Result<(), ContractError> {
    tracing::debug!("roots.delete root_id={root_id}");
    app_core::first_run::delete_source(state.repo.pool(), &state.bus, &root_id).await
}

/// `scan.start` — start a filesystem scan, optionally for specific roots.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn scan_start(
    root_ids: Option<Vec<String>>,
) -> Result<IpcOperationHandle, ContractError> {
    tracing::debug!("stub: scan.start root_ids={root_ids:?}");
    Ok(IpcOperationHandle { operation_id: "op-scan-001".to_owned(), kind: "scan".to_owned() })
}

/// `equipment.list` — returns all registered equipment.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn equipment_list() -> Result<Vec<Equipment>, ContractError> {
    tracing::debug!("stub: equipment.list");
    Ok(vec![
        Equipment {
            id: "eq-001".to_owned(),
            name: "ASI2600MM Pro".to_owned(),
            kind: "camera".to_owned(),
            aliases: vec!["ZWO ASI2600MM".to_owned()],
        },
        Equipment {
            id: "eq-002".to_owned(),
            name: "Esprit 100ED".to_owned(),
            kind: "telescope".to_owned(),
            aliases: vec!["SW Esprit 100ED".to_owned()],
        },
        Equipment {
            id: "eq-003".to_owned(),
            name: "EQ6-R Pro".to_owned(),
            kind: "mount".to_owned(),
            aliases: vec!["EQ6R".to_owned()],
        },
    ])
}
