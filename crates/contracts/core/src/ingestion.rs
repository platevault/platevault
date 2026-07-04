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
    /// Hashing strategy: `"lazy"` | `"eager"` | `"off"` — same vocabulary as
    /// the spec-018 `hashOnScan` settings key (data-sources scope). This is a
    /// distinct, ingestion-scoped setting (not a read of `hashOnScan`); the
    /// package-P12 UI wiring intentionally keeps them independent per-scope
    /// values rather than aliasing one to the other.
    pub hashing_mode: String,
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
    /// See [`IngestionSettings::hashing_mode`].
    pub hashing_mode: String,
    pub metadata_extraction: bool,
    pub exposure_grouping_tolerance_s: f64,
    pub temperature_grouping_tolerance_c: f64,
    pub default_filter: Option<String>,
}
