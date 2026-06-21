//! Spec 030 ingestion settings commands (T026).
//!
//! Stubs that return default ingestion settings and accept updates.
//! Real persistence will be wired when the ingestion settings repository
//! is built.

use contracts_core::ingestion::{IngestionSettings, UpdateIngestionSettings};
use contracts_core::ContractError;

/// `ingestion.settings.get` — returns current ingestion/scan settings.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn ingestion_settings_get() -> Result<IngestionSettings, ContractError> {
    tracing::debug!("stub: ingestion.settings.get");
    Ok(default_ingestion_settings())
}

/// `ingestion.settings.update` — update ingestion/scan settings.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn ingestion_settings_update(
    request: UpdateIngestionSettings,
) -> Result<IngestionSettings, ContractError> {
    tracing::debug!(
        "stub: ingestion.settings.update watcher={} scan_on_startup={}",
        request.watcher_enabled,
        request.scan_on_startup,
    );
    // Echo back as if persisted.
    Ok(IngestionSettings {
        watcher_enabled: request.watcher_enabled,
        scan_on_startup: request.scan_on_startup,
        follow_symlinks: request.follow_symlinks,
        follow_junctions: request.follow_junctions,
        eager_hashing: request.eager_hashing,
        metadata_extraction: request.metadata_extraction,
        exposure_grouping_tolerance_s: request.exposure_grouping_tolerance_s,
        temperature_grouping_tolerance_c: request.temperature_grouping_tolerance_c,
        default_filter: request.default_filter,
    })
}

fn default_ingestion_settings() -> IngestionSettings {
    IngestionSettings {
        watcher_enabled: true,
        scan_on_startup: true,
        follow_symlinks: false,
        follow_junctions: false,
        eager_hashing: false,
        metadata_extraction: true,
        exposure_grouping_tolerance_s: 2.0,
        temperature_grouping_tolerance_c: 5.0,
        default_filter: None,
    }
}
