//! Settings contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `SettingsData` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Scoped settings data (general, naming, calibration, etc.).
///
/// `values` is a free-form JSON object keyed by setting name.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsData {
    pub scope: String,
    pub values: crate::JsonAny,
}
