// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Library workflow settings IPC (D-W114): read and save the settings
//! document whole under its revision. It holds the framing margins,
//! calibration matching thresholds, group keywords and default View mode
//! (LIB-FR-04, PRJ-FR-31, CAL-FR-20/21, PREP-FR-04), the calibration
//! settings (CAL-FR-15, J36 S8) and each band's Moon-avoidance curve
//! (PLAN-FR-02).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]).
//! A refused save returns its [`platevault_core::ErrorResponse`] naming
//! [`WORKFLOW_SETTINGS_ID`], and the last saved settings stay in effect.

use std::sync::Arc;

use persistence_library::WORKFLOW_SETTINGS_ID;
use platevault_core::library::Library;
use platevault_core::{Revision, WorkflowSettings, WorkflowSettingsRecord};
use tauri::State;

use super::library::{fail, Reply};

/// The workflow settings at their revision; the defaults at revision 0
/// while none are saved.
///
/// # Errors
/// `PersistenceFailure` when the catalog or its recorded settings can't be
/// read.
#[tauri::command]
#[specta::specta]
pub async fn workflow_settings_get(
    library: State<'_, Arc<Library>>,
) -> Reply<WorkflowSettingsRecord> {
    library.workflow_settings().await.map_err(fail(Some(WORKFLOW_SETTINGS_ID)))
}

/// Save the whole settings document over `expected_revision`.
///
/// # Errors
/// `InvalidInput` for an invalid setting, `Conflict` for a stale revision and
/// a retryable `PersistenceFailure` when the save did not commit; nothing is
/// stored on any of them.
#[tauri::command]
#[specta::specta]
pub async fn workflow_settings_save(
    library: State<'_, Arc<Library>>,
    settings: WorkflowSettings,
    expected_revision: Revision,
) -> Reply<WorkflowSettingsRecord> {
    library
        .save_workflow_settings(expected_revision, &settings)
        .await
        .map_err(fail(Some(WORKFLOW_SETTINGS_ID)))
}
