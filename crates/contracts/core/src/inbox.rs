//! Inbox contract DTOs for the Tauri IPC surface (spec 005).
//!
//! Matches `specs/005-inbox-mixed-folder-split/contracts/`:
//!   - `inbox.classify.json` (v1.1.0)
//!   - `inbox.confirm.json`  (v1.1.0)
//!   - `inbox.reclassify.json` (v1.0.0)

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Legacy scan DTOs (retained for backward compat with spec 030) ─────────────

/// A file entry discovered during an inbox scan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxFileEntry {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub extension: String,
}

/// Result of an inbox scan operation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanResult {
    pub root_id: String,
    pub entries: Vec<InboxFileEntry>,
    pub total_count: u32,
    pub total_size_bytes: u64,
}

// ── inbox.classify ────────────────────────────────────────────────────────────

/// Request for `inbox.classify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxClassifyRequest {
    pub inbox_item_id: String,
    #[serde(default)]
    pub force_rescan: bool,
    /// Absolute path to the inbox root on disk (needed by the use case to
    /// locate files). Not in the JSON Schema (transport detail).
    pub root_absolute_path: String,
}

/// One frame-type breakdown entry in a classify response.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxBreakdownEntry {
    pub kind: String,
    pub count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_preview: Option<String>,
    pub sample_files: Vec<String>,
}

/// Response from `inbox.classify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxClassifyResponse {
    pub inbox_item_id: String,
    /// `"single_type"` | `"mixed"` | `"unclassified"`
    #[serde(rename = "type")]
    pub classification_type: String,
    /// Present only when `type == "single_type"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type: Option<String>,
    pub content_signature: String,
    pub breakdown: Vec<InboxBreakdownEntry>,
    /// Relative file paths whose IMAGETYP was absent, unreadable, or unmapped.
    pub unclassified_files: Vec<String>,
    pub sample_files: Vec<String>,
    pub computed_at: String,
}

// ── inbox.confirm ─────────────────────────────────────────────────────────────

/// Request for `inbox.confirm`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmRequest {
    pub inbox_item_id: String,
    /// `"split"` for mixed items; `"confirm"` for `single_type` items.
    pub action: String,
    pub content_signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_destination: Option<String>,
    /// Absolute path to the inbox root on disk (needed to read FITS/XISF
    /// headers for destination resolution). Not in the JSON Schema contract
    /// (Tauri transport detail only).
    pub root_absolute_path: String,
}

/// Response from `inbox.confirm`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmResponse {
    pub plan_id: String,
    /// Always `"ready_for_review"` for plans created here.
    pub plan_state: String,
    pub items_total: u32,
}

// ── inbox.reclassify ──────────────────────────────────────────────────────────

/// A single file override in a reclassify request.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyOverride {
    pub file_path: String,
    pub frame_type: String,
}

/// Request for `inbox.reclassify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyRequest {
    pub inbox_item_id: String,
    pub overrides: Vec<InboxReclassifyOverride>,
}

/// Response from `inbox.reclassify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyResponse {
    pub inbox_item_id: String,
    /// `"single_type"` | `"mixed"` | `"unclassified"` after re-aggregation.
    pub updated_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type: Option<String>,
    pub remaining_unclassified: u32,
    pub applied_count: u32,
}

// ── inbox.scan.folder ─────────────────────────────────────────────────────────

/// Request to scan a root directory and discover inbox items.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanFolderRequest {
    pub root_id: String,
    pub root_absolute_path: String,
    #[serde(default)]
    pub follow_symlinks: bool,
}

/// A discovered inbox item returned from the scan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemSummary {
    pub inbox_item_id: String,
    pub relative_path: String,
    pub file_count: u32,
    pub lane: String,
    pub state: String,
    pub content_signature: String,
}

/// Response from `inbox.scan.folder`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanFolderResponse {
    pub root_id: String,
    pub items: Vec<InboxItemSummary>,
}

// ── Cross-root unacknowledged list (spec 039) ─────────────────────────────────

/// One unacknowledged inbox item returned by `inbox.list`.
///
/// Extends `InboxItemSummary` with the root's id and absolute path so the UI
/// can group/label items by root without a second call.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxListItem {
    pub inbox_item_id: String,
    pub root_id: String,
    /// Absolute path of the registered root (for display and confirm calls).
    pub root_absolute_path: String,
    pub relative_path: String,
    pub file_count: u32,
    pub lane: String,
    pub state: String,
    pub content_signature: String,
}

/// Response from `inbox.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxListResponse {
    pub items: Vec<InboxListItem>,
    /// Whether the list was capped at `limit` (true = there may be more).
    pub capped: bool,
    /// Maximum items per response (matches the server-side cap).
    pub limit: u32,
}
