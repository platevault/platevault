//! Contract DTOs for spec 049 — `sourceview.generate` (source view
//! first-materialization).
//!
//! Mirrors `specs/049-source-view-generation/contracts/sourceview.generate.json`.
//! Follows the same bare-success-DTO convention as
//! `crate::prepared_views::PreparedViewRegenerateResponse` (spec 026):
//! transport envelope fields (`status`/`contractVersion`/`requestId`) are
//! handled by the Tauri/IPC layer; failures surface as `ContractError` rather
//! than an embedded `errors` array.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Non-blocking review warning surfaced with a generation plan (FR-010a,
/// FR-019, FR-004b, FR-018).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerationWarning {
    pub code: GenerationWarningCode,
    pub message: String,
    /// Affected source references / group identifiers.
    #[serde(default)]
    pub items: Vec<String>,
}

/// Warning codes for `sourceview.generate` (contract `$defs/Warning.code`).
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum GenerationWarningCode {
    /// Light view generated without matched calibration; unmatched groups listed (FR-010a).
    NoCalibrationApplied,
    /// A source is missing/unresolved and was skipped/flagged (FR-019).
    UnresolvedSource,
    /// A saved link kind was not achievable for a drive-scope; a documented
    /// fallback was applied (FR-004b).
    CapabilityDrift,
    /// A destination path exceeds the Windows 260-char limit (FR-018).
    LongPath,
}

/// Request: create a `prepared_view_generation` plan first-materializing a
/// project's selected lights + matched calibration as link actions.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceViewGenerateRequest {
    pub project_id: String,
    /// Workflow/processing profile selecting the tree layout (spec 011).
    /// Defaults to the project's active profile (WBPP first).
    #[serde(default)]
    pub profile_id: Option<String>,
    /// Optional per-generation destination path override (FR-021b).
    #[serde(default)]
    pub destination_override: Option<String>,
    /// Explicit opt-in to copy materialization when no link kind is
    /// achievable. Default `false` — the app never silently copies (FR-003).
    #[serde(default)]
    pub copy_opt_in: bool,
    /// When `true`, any missing/unresolved source fails the whole plan; when
    /// `false` (default), unresolved sources are skipped and flagged (FR-019).
    #[serde(default)]
    pub strict: bool,
}

/// Success response for `sourceview.generate`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceViewGenerateResponse {
    /// The id of the produced generation plan (`FilesystemPlan` with origin
    /// `prepared_view_generation`, plan type `source_view_generation`). Enters
    /// the standard spec 017/025 pipeline: approve, then apply.
    pub plan_id: String,
    /// Non-blocking review warnings surfaced with the plan.
    #[serde(default)]
    pub warnings: Vec<GenerationWarning>,
}
