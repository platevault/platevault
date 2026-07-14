// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 029 tour stubs exposed to the Tauri webview.
//!
//! Stub implementations for guided-tour step completion tracking.

use contracts_core::ContractError;

/// `tour.complete_step` — mark a tour step as completed.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn tour_complete_step(step: String) -> Result<(), ContractError> {
    tracing::debug!("stub: tour.complete_step step={step}");
    Ok(())
}
