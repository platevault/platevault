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

/// Request for `cleanup.plan.generate` — the second step of the two-step cleanup
/// flow (D11). `cleanup.scan` is a pure preview; this command materialises a
/// reviewable cleanup plan (plan row + items) via the spec-016 protection
/// generator. Generating a plan performs NO filesystem mutation (FR-002).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCleanupPlanRequest {
    /// Project whose observed artifacts are scanned for cleanup candidates.
    pub project_id: String,
    /// Optional plan title; a default is derived from the project when absent.
    #[serde(default)]
    pub title: Option<String>,
    /// Per-plan destructive destination: `"archive"` (default, app-managed) or
    /// `"os_trash"` (FR-016). Defaults to `"archive"` when absent.
    #[serde(default)]
    pub destructive_destination: Option<String>,
}

/// Result of `cleanup.plan.generate`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCleanupPlanResult {
    /// Id of the newly created plan (in `ready_for_review` state).
    pub plan_id: String,
    /// Total number of cleanup items placed on the plan.
    pub item_count: u32,
    /// Number of items that resolved to a protected protection level and will
    /// gate plan approval until acknowledged (constitution II).
    pub protected_item_count: u32,
}
