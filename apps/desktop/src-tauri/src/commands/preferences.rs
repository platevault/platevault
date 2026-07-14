// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 029 preferences stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use std::collections::HashMap;

use contracts_core::enums::{Density, ViewMode};
use contracts_core::preferences::{AppPreferences, SessionsGroupBy, SessionsView, TourCompleted};
use contracts_core::ContractError;
use contracts_core::JsonAny;

/// `preferences.get` — returns current application preferences.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn preferences_get() -> Result<AppPreferences, ContractError> {
    tracing::debug!("stub: preferences.get");
    Ok(AppPreferences {
        sidebar_collapsed: false,
        density: Density::Comfortable,
        project_view_modes: HashMap::new(),
        default_project_view: ViewMode::Combined,
        sessions_group_by: SessionsGroupBy::None,
        sessions_view: SessionsView::List,
        tour_completed: TourCompleted { step1: false, step2: false, step3: false },
        setup_completed: false,
    })
}

/// `preferences.set` — update a single preference key.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn preferences_set(key: String, value: JsonAny) -> Result<(), ContractError> {
    tracing::debug!("stub: preferences.set key={key} value={value:?}");
    Ok(())
}
