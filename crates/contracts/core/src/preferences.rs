// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! App preferences contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `AppPreferences` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::enums::{Density, ViewMode};

// ── Structs ─────────────────────────────────────────────────────────────────

/// Tour completion state tracking.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TourCompleted {
    pub step1: bool,
    pub step2: bool,
    pub step3: bool,
}

/// Sessions grouping mode.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SessionsGroupBy {
    None,
    Target,
    Month,
    Filter,
    Train,
}

/// Sessions view mode.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SessionsView {
    List,
    Calendar,
}

/// Detail-panel dock placement for a list page.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum DockPlacement {
    Side,
    Bottom,
}

/// Per-page detail-dock state.
///
/// `placement` is three-state: `Some(Side)` / `Some(Bottom)` pin the dock,
/// `None` means "auto" — follow the window-width rule (#1066).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetailDockPref {
    pub placement: Option<DockPlacement>,
    pub width: Option<f64>,
}

/// Application-level user preferences.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub sidebar_collapsed: bool,
    pub density: Density,
    pub project_view_modes: std::collections::HashMap<String, ViewMode>,
    pub default_project_view: ViewMode,
    pub sessions_group_by: SessionsGroupBy,
    pub sessions_view: SessionsView,
    pub tour_completed: TourCompleted,
    pub setup_completed: bool,
    /// Keyed by `dockId` (the adopting list page, e.g. `"sessions"`).
    pub detail_dock: std::collections::HashMap<String, DetailDockPref>,
}
