//! Ingestion settings contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[allow(clippy::struct_excessive_bools)] // IPC DTO mirrors frontend toggle flags
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IngestionSettings {
    pub watcher_enabled: bool,
    pub scan_on_startup: bool,
    pub follow_symlinks: bool,
    pub follow_junctions: bool,
    pub eager_hashing: bool,
    pub metadata_extraction: bool,
    pub exposure_grouping_tolerance_s: f64,
    pub temperature_grouping_tolerance_c: f64,
    pub default_filter: Option<String>,
}

#[allow(clippy::struct_excessive_bools)] // IPC DTO mirrors frontend toggle flags
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIngestionSettings {
    pub watcher_enabled: bool,
    pub scan_on_startup: bool,
    pub follow_symlinks: bool,
    pub follow_junctions: bool,
    pub eager_hashing: bool,
    pub metadata_extraction: bool,
    pub exposure_grouping_tolerance_s: f64,
    pub temperature_grouping_tolerance_c: f64,
    pub default_filter: Option<String>,
}
