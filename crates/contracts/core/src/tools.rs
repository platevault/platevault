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

// ── Spec 012: Artifact observation DTOs ───────────────────────────────────────

/// Summary of a single observed `ProcessingArtifact` row (spec 012, artifact.list).
///
/// Matches the `Artifact` shape from `specs/012-processing-artifact-observation/contracts/artifact.list.json`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub id: String,
    pub project_id: String,
    /// Attribution to a tool launch from spec 011; `None` when unattributed.
    pub tool_launch_id: Option<String>,
    /// Project-relative path.
    pub path: String,
    /// `intermediate` | `master` | `final`
    pub kind: String,
    /// Workflow-profile tool id (e.g. `pixinsight`, `siril`).
    pub tool: String,
    pub detected_at: String,
    pub last_seen_at: String,
    /// `present` | `missing` | `user_resolved_missing`
    pub state: String,
    pub classification_confidence: f64,
    /// `rule` | `manual_override` | `fallback`
    pub classification_source: String,
    pub size_bytes: i64,
}

/// Request DTO for `artifact.list` (spec 012 T020/TX01).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactListRequest {
    pub project_id: String,
    /// Optional state filter. If empty/omitted, defaults to `["present","missing"]`.
    #[serde(default)]
    pub include_states: Vec<String>,
}

/// Response DTO for `artifact.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactListResponse {
    pub artifacts: Vec<ArtifactSummary>,
}

/// Request DTO for `artifact.classify` (spec 012 T014/TX01).
///
/// `kind = None` clears the manual override and triggers rule re-classification (A6).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactClassifyRequest {
    pub artifact_id: String,
    pub project_id: String,
    /// `Some("intermediate"|"master"|"final")` to override; `None` to clear.
    pub kind: Option<String>,
    pub reason: Option<String>,
}

/// Response DTO for `artifact.classify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactClassifyResponse {
    pub artifact: ArtifactSummary,
}

/// Request DTO for `artifact.mark_resolved` (spec 012 T024).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMarkResolvedRequest {
    pub artifact_id: String,
    pub project_id: String,
}
