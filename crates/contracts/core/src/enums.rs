//! Shared enums NOT defined in domain-specific contract modules.
//!
//! Enums that span multiple command groups or UI concerns live here.
//! Domain-specific enums live in their respective modules (e.g.
//! `CalibrationKind` in `calibration`, `PlanItemAction` in `plans`).

use serde::{Deserialize, Serialize};
use specta::Type;

/// Project detail view mode.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ViewMode {
    Center,
    Pipeline,
    Combined,
}

/// UI density preference.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    Compact,
    Comfortable,
    Spacious,
}
