// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 007 / spec 043 P8 calibration tolerances commands.
//!
//! Backed by the `calibration_tolerances` singleton table (migration 0008 +
//! 0051) via `app_core::calibration::{tolerances_get, tolerances_update}`.
//! `require_same_offset` additionally feeds
//! `calibration_core::ranking::MatchingRuleConfig::require_same_offset`
//! through `app_core::calibration`'s `load_config` (see
//! `crates/app/calibration/src/matching.rs`).

use contracts_core::calibration_tolerances::{CalibrationTolerances, UpdateCalibrationTolerances};
use contracts_core::ContractError;
use tauri::State;

use crate::AppState;

/// `calibration.tolerances.get` — returns current calibration matching tolerances.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn calibration_tolerances_get(
    state: State<'_, AppState>,
) -> Result<CalibrationTolerances, ContractError> {
    tracing::debug!("calibration.tolerances.get");
    app_core::calibration::tolerances_get(state.repo.pool()).await
}

/// `calibration.tolerances.update` — update calibration matching tolerances.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn calibration_tolerances_update(
    state: State<'_, AppState>,
    request: UpdateCalibrationTolerances,
) -> Result<CalibrationTolerances, ContractError> {
    tracing::debug!(
        "calibration.tolerances.update temp={}C exp={}s require_same_offset={}",
        request.temperature_tolerance_c,
        request.exposure_tolerance_s,
        request.require_same_offset,
    );
    app_core::calibration::tolerances_update(state.repo.pool(), request).await
}
