//! Root/scan/equipment commands exposed to the Tauri webview.
//!
//! `roots.register` and `roots.list` delegate to the persistence layer.
//! Remaining commands are stubs until the real persistence layer is wired.

use contracts_core::first_run::{
    RegisterSourceRequest, RegisterSourceResponse, ScanDepth, SourceKind,
};
use contracts_core::roots::{
    Equipment, IpcOperationHandle, LibraryRoot, RemapSample, RemapVerification, RootCategory,
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
            LibraryRoot {
                id: s.source_id,
                path: s.path,
                category,
                online,
                file_count: 0,
                last_scanned: None,
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

    let req = RegisterSourceRequest { kind, path, kind_subtype: None, scan_depth };

    app_core::first_run::register_source(state.repo.pool(), &req).await
}

/// `roots.remap` — preview a root path remap.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn roots_remap(
    root_id: String,
    new_path: String,
) -> Result<RemapVerification, ContractError> {
    tracing::debug!("stub: roots.remap root_id={root_id} new_path={new_path}");
    Ok(RemapVerification {
        root_id,
        original_path: "/old/path".to_owned(),
        new_path,
        samples: vec![
            RemapSample { relative_path: "M31/light_001.fits".to_owned(), found: true },
            RemapSample { relative_path: "M31/light_002.fits".to_owned(), found: true },
            RemapSample { relative_path: "M31/dark_001.fits".to_owned(), found: true },
        ],
        all_verified: true,
    })
}

/// `roots.remap.apply` — apply a verified root remap.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn roots_remap_apply(root_id: String, verified: bool) -> Result<(), ContractError> {
    tracing::debug!("stub: roots.remap.apply root_id={root_id} verified={verified}");
    Ok(())
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
