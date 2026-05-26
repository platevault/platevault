//! Status summary contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub sessions: u32,
    pub calibration_sets: u32,
    pub targets: u32,
    pub projects: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeHealth {
    pub path: String,
    pub label: Option<String>,
    pub free_bytes: u64,
    pub total_bytes: u64,
    pub warning: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RootHealth {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub online: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatusSummary {
    pub inbox_count: u32,
    pub library: LibraryStats,
    pub cleanup_reclaimable_bytes: u64,
    pub volumes: Vec<VolumeHealth>,
    pub roots: Vec<RootHealth>,
}
