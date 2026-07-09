//! Cleanup policy contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::inventory_frame::RawFrameType;

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
    /// `"trash"` (OS-native recycle bin). Canonical vocabulary per migration
    /// 0040 / spec 033 vocab split: `archive | trash`. Defaults to `"archive"`
    /// when absent; any other value is rejected with `value.invalid`.
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

// ── Raw sub-frame cleanup candidates (spec 048 US3) ────────────────────────
//
// A separate namespace from `CleanupCandidate`/`CleanupScanResult` above,
// which enumerate a PROJECT's `processing_artifacts` (spec 012/030). These
// types enumerate a ROOT's or SESSION's raw `file_record` inventory (spec
// 048) — a distinct scope and shape (frame_id/session_id/frame_type instead
// of file_path/data_type), matching `specs/048-per-frame-inventory/contracts/operations.md`.
// The two-step scan/generate shape and the shared apply path (PR #408
// overlap guard, `.astro-plan-archive/<planId>/`) are reused, not
// duplicated — see `app_core::cleanup_generator::{scan_raw_frames, generate_raw_frame_plan}`.

/// Scope for `cleanup.candidates.scan` (raw sub-frame variant) — exactly one
/// of `session_id`/`root_id` is expected to be set.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RawFrameCleanupScope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
}

/// Request envelope for the raw sub-frame `cleanup.candidates.scan`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RawFrameCleanupScanRequest {
    pub scope: RawFrameCleanupScope,
    /// Restrict to specific raw frame kinds; all kinds when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<RawFrameType>>,
}

/// One raw sub-frame cleanup candidate (a present, non-protected `file_record`).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RawFrameCleanupCandidate {
    pub frame_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub root_id: String,
    pub relative_path: String,
    pub frame_type: RawFrameType,
    pub size_bytes: i64,
    /// Resolved protection level (e.g. `"protected"`/`"unprotected"`),
    /// surfaced BEFORE generating a plan (constitution II).
    pub protection: String,
    /// Confidence the classification is correct, `0.0..=1.0`. Raw frame
    /// classification is deterministic (derived from the owning session's
    /// kind, not inferred), so this is always `1.0` today; the field exists
    /// so a future ambiguous-classification path has somewhere to report
    /// uncertainty (FR-023).
    pub confidence: f64,
}

/// Response payload for the raw sub-frame `cleanup.candidates.scan`.
/// Grouping by session is a client-side concern over `session_id` on each
/// candidate — no separate grouped shape is needed.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RawFrameCleanupScanResponse {
    pub candidates: Vec<RawFrameCleanupCandidate>,
    pub total_reclaimable_bytes: i64,
}

/// Request envelope for the raw sub-frame `cleanup.plan.generate`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RawFrameCleanupGenerateRequest {
    pub selected_frame_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// `"archive"` (default) or `"trash"` — canonical vocabulary per
    /// migration 0040 / spec 033 vocab split.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destructive_destination: Option<String>,
}
