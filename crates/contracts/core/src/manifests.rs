//! Spec 024 — Project manifest and notes contract DTOs.
//!
//! Mirrors the JSON schemas in
//! `specs/024-project-manifests-and-notes/contracts/`.
//!
//! All types derive `specta::Type` for tauri-specta TS binding generation.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── Shared sub-types ──────────────────────────────────────────────────────────

/// Why a manifest was generated.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ManifestReason {
    Created,
    SourceChange,
    LifecycleTransition,
    CleanupApplied,
    WorkflowRun,
}

impl ManifestReason {
    /// Canonical `snake_case` string (matches DB enum and JSON schema enum).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::SourceChange => "source_change",
            Self::LifecycleTransition => "lifecycle_transition",
            Self::CleanupApplied => "cleanup_applied",
            Self::WorkflowRun => "workflow_run",
        }
    }

    /// Parse from a DB / contract string.
    ///
    /// # Errors
    /// Returns `Err` for unknown values.
    pub fn from_db_str(s: &str) -> Result<Self, String> {
        match s {
            "created" => Ok(Self::Created),
            "source_change" => Ok(Self::SourceChange),
            "lifecycle_transition" => Ok(Self::LifecycleTransition),
            "cleanup_applied" => Ok(Self::CleanupApplied),
            "workflow_run" => Ok(Self::WorkflowRun),
            other => Err(format!("unknown manifest reason: {other}")),
        }
    }
}

/// Lightweight summary for the manifest list drawer accordion.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSummaryDto {
    pub id: String,
    pub reason: ManifestReason,
    pub timestamp: String,
    /// Project-relative path (e.g. `notes/manifest-…md`).
    pub path: String,
    /// `true` when the manifest carries an expandable structured body.
    pub has_body: bool,
}

/// Full manifest including structured body.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDto {
    pub id: String,
    pub project_id: String,
    pub reason: ManifestReason,
    pub timestamp: String,
    pub path: String,
    pub version: i64,
    pub body: ManifestBodyDto,
}

/// Structured body of a manifest snapshot.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestBodyDto {
    pub lifecycle_state: String,
    /// Snapshot of linked Inventory items by role (opaque JSON, specta-safe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_map: Option<JsonAny>,
    /// Calibration choice snapshot (opaque JSON, specta-safe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calibration: Option<JsonAny>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generated_views: Vec<GeneratedViewRefDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// A reference to a generated source view embedded in a manifest body.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct GeneratedViewRefDto {
    pub id: String,
    pub path: String,
}

// ── project.manifest.list ─────────────────────────────────────────────────────

/// Request for `project.manifest.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestListRequest {
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// Response for `project.manifest.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestListResponse {
    pub manifests: Vec<ManifestSummaryDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

// ── project.manifest.get ──────────────────────────────────────────────────────

/// Request for `project.manifest.get`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestGetRequest {
    pub manifest_id: String,
}

/// Response for `project.manifest.get`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestGetResponse {
    pub manifest: ManifestDto,
}

// ── project.note.update ───────────────────────────────────────────────────────

/// Request for `project.note.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteUpdateRequest {
    pub project_id: String,
    /// Full replacement markdown body (≤16 384 UTF-8 bytes). Empty string clears notes.
    pub content: String,
}

/// Successful response for `project.note.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteUpdateResult {
    pub project_id: String,
    pub updated_at: String,
}

/// Error returned by manifest and note operations.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestOpError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<JsonAny>,
}

impl std::fmt::Display for ManifestOpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ManifestOpError {}

// ── project.note.get ─────────────────────────────────────────────────────────

/// Request for `project.note.get`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteGetRequest {
    pub project_id: String,
}

/// Response for `project.note.get`.
///
/// `content` is `None` when no note has been saved for this project yet.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteGetResult {
    pub project_id: String,
    pub content: Option<String>,
}

// ── Reveal in OS ──────────────────────────────────────────────────────────────

/// Request for `project.manifest.reveal_in_os`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRevealRequest {
    /// Absolute path of the manifest file to reveal.
    pub path: String,
}
