// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 030 ingestion settings commands (package P12: real persistence).
//!
//! Values are persisted through `app_core::settings::ingestion` — a thin
//! use-case wrapper over the existing spec-018 settings key/value store
//! (`persistence_db::repositories::settings::{get_raw,set_raw}`). See that
//! module's doc comment for why a new table was not needed.
//!
//! NOTE (consumer check, P12): no scan/watch/ingest pipeline code reads these
//! values yet. Persisting them here does not, by itself, change scan
//! behaviour — a future spec must wire a consumer (e.g. the filesystem watcher
//! honouring `watcher_enabled`/`follow_symlinks`/`follow_junctions`, or the
//! ingest grouping pipeline honouring the exposure/temperature tolerances)
//! before toggling these settings has any observable effect.

use contracts_core::ingestion::{IngestionSettings, UpdateIngestionSettings};
use contracts_core::ContractError;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `ingestion.settings.get` — returns current ingestion/scan settings,
/// merging any persisted overrides with in-code defaults.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn ingestion_settings_get(
    state: State<'_, AppState>,
) -> Result<IngestionSettings, ContractError> {
    tracing::debug!("ingestion.settings.get");
    app_core::settings::ingestion::get_ingestion_settings(state.repo.pool()).await
}

/// `ingestion.settings.update` — validates, persists, and returns the
/// persisted ingestion/scan settings.
///
/// # Errors
/// Returns `Err(ContractError)` with code `"value.invalid"` for a negative
/// tolerance, or on database failure.
#[tauri::command]
#[specta::specta]
pub async fn ingestion_settings_update(
    state: State<'_, AppState>,
    request: UpdateIngestionSettings,
) -> Result<IngestionSettings, ContractError> {
    tracing::debug!(
        "ingestion.settings.update watcher={} scan_on_startup={}",
        request.watcher_enabled,
        request.scan_on_startup,
    );
    app_core::settings::ingestion::update_ingestion_settings(state.repo.pool(), request).await
}
