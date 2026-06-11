//! Processing tool contract DTOs for the Tauri IPC surface (spec 011 T005).
//!
//! Covers:
//! - Legacy `ProcessingTool` / `UpdateProcessingTool` / `ToolPathValidation`
//!   (kept for backwards-compat with existing frontend invocations).
//! - New: `ToolProfileSummary`, `ToolLaunchRequest`, `ToolLaunchResponse`,
//!   `ToolProfileListRequest`, `ToolProfileListResponse`, `ToolDiscoverRequest`,
//!   `ToolDiscoverResponse` (spec 011 T005/T006).

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Legacy DTOs (stable surface — do not remove) ──────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingTool {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub detected: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessingTool {
    pub id: String,
    pub path: Option<String>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolPathValidation {
    pub path: String,
    pub valid: bool,
    pub reason: Option<String>,
}

// ── Spec 011 new DTOs ─────────────────────────────────────────────────────────

/// Settings-joined summary of a tool profile (tool.profile.list response item).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // These are distinct orthogonal flags per spec 011 data-model
pub struct ToolProfileSummary {
    /// Stable `[a-z][a-z0-9_]*` identifier (C2).
    pub id: String,
    /// Display name.
    pub name: String,
    /// True when `executable_path` is set and non-blank in Settings.
    pub configured: bool,
    /// True when configured AND the executable currently exists at scan time.
    pub available: bool,
    pub supports_open_folder: bool,
    /// User-controlled visibility flag.
    pub enabled: bool,
    /// True when the path came from auto-detection and has not been explicitly saved.
    pub auto_detected: bool,
    /// Current executable path (from Settings). `None` when not configured.
    pub executable_path: Option<String>,
}

// ── tool.launch ───────────────────────────────────────────────────────────────

/// Request DTO for `tool.launch` (spec 011 T005).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolLaunchRequest {
    pub project_id: String,
    pub tool_id: String,
    /// When `true`, suppress the re-launch guard and always spawn a new instance.
    pub force: bool,
}

/// Outcome of a `tool.launch` invocation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolLaunchResponse {
    pub status: ToolLaunchStatus,
    /// Uuid of the `tool_launches` row (spec 012 correlation handle).
    pub launch_id: Option<String>,
    /// OS process id; `None` on macOS `open -b` launches.
    pub pid: Option<u32>,
    pub launched_at: Option<String>,
    pub working_dir: Option<String>,
    pub audit_id: Option<String>,
    /// Populated on error outcomes.
    pub error: Option<ToolLaunchError>,
    /// Re-launch guard: `true` when a prior instance appears still alive.
    /// The caller should surface a confirmation modal and re-send with `force=true`.
    pub prior_instance_alive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolLaunchStatus {
    Success,
    Error,
    /// Prior instance alive; client should confirm and resend with `force=true`.
    PriorInstanceAlive,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolLaunchError {
    pub code: String,
    pub message: String,
}

// ── tool.profile.list ─────────────────────────────────────────────────────────

/// Request DTO for `tool.profile.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolProfileListRequest {
    pub request_id: String,
}

/// Response DTO for `tool.profile.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolProfileListResponse {
    pub tools: Vec<ToolProfileSummary>,
}

// ── tool.discover ─────────────────────────────────────────────────────────────

/// Request DTO for `tool.discover` (auto-detect installed tool paths).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiscoverRequest {
    /// When set, only discover for this tool id. `None` = discover all.
    pub tool_id: Option<String>,
}

/// Single discovery result entry.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiscoveryEntry {
    pub tool_id: String,
    pub path: String,
    pub available: bool,
}

/// Response DTO for `tool.discover`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiscoverResponse {
    pub entries: Vec<ToolDiscoveryEntry>,
}
