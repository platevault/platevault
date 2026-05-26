//! Cleanup policy contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CleanupAction {
    Keep,
    Archive,
    Delete,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPolicyEntry {
    pub data_type: String,
    pub action: CleanupAction,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPolicy {
    pub entries: Vec<CleanupPolicyEntry>,
    pub auto_on_completion: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCleanupPolicy {
    pub entries: Vec<CleanupPolicyEntry>,
    pub auto_on_completion: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    pub file_path: String,
    pub data_type: String,
    pub size_bytes: u64,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScanResult {
    pub project_id: String,
    pub candidates: Vec<CleanupCandidate>,
    pub total_reclaimable_bytes: u64,
}
