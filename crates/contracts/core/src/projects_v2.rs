//! Spec 008 project create/update/source/channel contract DTOs.
//!
//! These types correspond to the seven JSON Schemas under
//! `specs/008-project-create-onboard-edit/contracts/`.
//!
//! Naming follows camelCase (A7 exception for the newer contracts:
//! `project.source.remove`, `project.channels.reinfer`,
//! `project.channels.dismiss_drift`). Older contracts (`project.create`,
//! `project.update`, `project.source.add`) use `snake_case` for backward
//! compatibility with the existing DB/contract layer.
//!
//! All types derive `specta::Type` so tauri-specta can emit TS bindings.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared sub-types ──────────────────────────────────────────────────────────

/// Role of a linked source within a project (spec 008 data-model.md §`ProjectSource`).
///
/// Canonical definition for this spec. Re-exported from `projects.rs` so existing
/// command code that imports from that module continues to compile.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SourceRole {
    Light,
    Dark,
    Flat,
    Bias,
}

/// Selection state for a linked source within a project (spec 008).
///
/// Canonical definition for this spec. Re-exported from `projects.rs`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SourceSelection {
    Selected,
    Candidate,
}

/// Processing tool selection for a project (canonical list from data-model.md).
///
/// Renamed `ProjectTool` to avoid collision with `contracts_core::tools::ProcessingTool`
/// (the tool-detection/registration struct). Same three values; different purpose.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
pub enum ProjectTool {
    PixInsight,
    Siril,
    #[serde(rename = "Planetary Suite")]
    PlanetarySuite,
}

impl ProjectTool {
    /// Convert to the canonical string stored in the database.
    #[must_use]
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::PixInsight => "PixInsight",
            Self::Siril => "Siril",
            Self::PlanetarySuite => "Planetary Suite",
        }
    }

    /// Parse from a database string.
    ///
    /// # Errors
    ///
    /// Returns `Err` for unknown values.
    pub fn from_db_str(s: &str) -> Result<Self, String> {
        match s {
            "PixInsight" => Ok(Self::PixInsight),
            "Siril" => Ok(Self::Siril),
            "Planetary Suite" => Ok(Self::PlanetarySuite),
            other => Err(format!("unknown tool: {other}")),
        }
    }
}

/// A project channel (inferred or manually added).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelDto {
    pub label: String,
    /// `"inferred"` or `"manual"`
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    /// Total sub-frame (light) count across all linked sources whose
    /// `filter_snapshot` matches this channel's `label` (P7: server-side
    /// aggregation, previously derived client-side).
    pub sub_frames: u32,
    /// Total integration time in seconds across the same matching sources
    /// (`frames_snapshot * parse(exposure_snapshot)` summed per source).
    pub total_integration_s: u64,
}

/// A project source (Inventory session link with snapshot fields).
///
/// `role` and `selection` are present in the spec 008 data model
/// (data-model.md §`ProjectSource`). They are spec 008's canonical definition
/// and ensure `SourceRole` + `SourceSelection` are emitted by specta.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceDto {
    pub inventory_id: String,
    pub name: String,
    pub frames: u32,
    pub filter: String,
    pub exposure: String,
    pub linked_at: String,
    /// Calibration frame role for this source (light, dark, flat, bias).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<SourceRole>,
    /// Selection state (selected = included in processing; candidate = pending review).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<SourceSelection>,
}

/// A project summary for list views (spec 008 read surface).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    pub id: String,
    pub name: String,
    pub tool: ProjectTool,
    pub lifecycle: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub channel_drift: bool,
    pub source_count: u32,
    pub created_at: String,
    pub updated_at: String,
    /// FR-020: typed blocked reason kind when lifecycle == "blocked". Null otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason_kind: Option<String>,
    /// FR-020: free-form note for the blocked reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason_note: Option<String>,
}

/// A project detail (sources + channels included).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailDto {
    pub id: String,
    pub name: String,
    pub tool: ProjectTool,
    pub lifecycle: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub channel_drift: ChannelDriftDto,
    pub sources: Vec<ProjectSourceDto>,
    pub channels: Vec<ProjectChannelDto>,
    pub created_at: String,
    pub updated_at: String,
    /// The associated spec-035 canonical target (when one was selected at
    /// project creation), resolved for display. `None` when the project has no
    /// canonical-target association. Additive; coexists with the legacy
    /// spec-013 target association.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_target: Option<ProjectCanonicalTarget>,
    /// FR-020: typed blocked reason kind when lifecycle == "blocked". Null otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason_kind: Option<String>,
    /// FR-020: free-form note for the blocked reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason_note: Option<String>,
}

/// A project's associated spec-035 canonical target, resolved for display on the
/// project detail read path (spec 035 US1 #2).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCanonicalTarget {
    /// UUID of the `canonical_target`.
    pub id: String,
    /// Canonical display designation (e.g. `M 31`).
    pub primary_designation: String,
    /// Curated common name (e.g. `Andromeda Galaxy`) when one exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
}

/// Channel drift state embedded in project.get (FR-010).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDriftDto {
    pub has_new_sources: bool,
    /// `"re_infer"` or `"dismiss"` — only meaningful when `has_new_sources == true`.
    pub suggested_action: String,
}

// ── project.create ────────────────────────────────────────────────────────────

/// Request body for `projects.create` (spec 008, contract version 2.0.0).
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateRequest {
    pub request_id: String,
    pub name: String,
    pub tool: ProjectTool,
    pub path: String,
    #[serde(default)]
    pub initial_sources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Optional UUID of a spec-035 `canonical_target` the user selected in the
    /// project-creation target search. Additive and nullable; coexists with the
    /// legacy spec-013 `projects.target_id` (reconciliation is a future
    /// decision). Existing callers omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_target_id: Option<String>,
}

/// Successful result from `projects.create`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateResult {
    pub project_id: String,
    /// Initial lifecycle state. `"setup_incomplete"` when the project has no sources at create time;
    /// may auto-transition to `"ready"` when sources are provided in the create request (FR-008).
    pub lifecycle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    pub channels: Vec<ProjectChannelDto>,
    pub audit_id: String,
    pub created_at: String,
}

// ── project.update ────────────────────────────────────────────────────────────

/// Request body for `projects.update`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateRequest {
    pub request_id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ProjectTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Successful result from `projects.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateResult {
    pub project_id: String,
    pub fields_updated: Vec<String>,
    pub audit_id: String,
    pub updated_at: String,
}

// ── project.source.add ────────────────────────────────────────────────────────

/// Request body for `projects.source.add`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceAddRequest {
    pub request_id: String,
    pub project_id: String,
    pub inventory_session_id: String,
}

/// Successful result from `projects.source.add`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceAddResult {
    pub project_id: String,
    pub source_added: ProjectSourceDto,
    pub channels: Vec<ProjectChannelDto>,
    pub audit_id: String,
    pub linked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_lifecycle: Option<String>,
}

// ── project.source.remove ─────────────────────────────────────────────────────

/// Request body for `projects.source.remove`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceRemoveRequest {
    pub request_id: String,
    pub project_id: String,
    /// The `inventory_session_id` of the `ProjectSource` to remove.
    pub project_source_id: String,
    #[serde(default)]
    pub confirm_last_source: bool,
}

/// Successful result from `projects.source.remove`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceRemoveResult {
    pub project_id: String,
    pub removed_source_id: String,
    pub audit_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_lifecycle: Option<String>,
}

// ── project.channels.reinfer ──────────────────────────────────────────────────

/// Request body for `projects.channels.reinfer`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelsReinferRequest {
    pub request_id: String,
    pub project_id: String,
}

/// Successful result from `projects.channels.reinfer`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelsReinferResult {
    pub project_id: String,
    pub channels: Vec<ProjectChannelDto>,
    pub audit_id: String,
    pub updated_at: String,
}

// ── project.channels.dismiss_drift ───────────────────────────────────────────

/// Request body for `projects.channels.dismiss_drift`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelsDismissDriftRequest {
    pub request_id: String,
    pub project_id: String,
}

/// Successful result from `projects.channels.dismiss_drift`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelsDismissDriftResult {
    pub project_id: String,
    pub audit_id: String,
    pub dismissed_at: String,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn processing_tool_db_str_roundtrips() {
        for s in ["PixInsight", "Siril", "Planetary Suite"] {
            let tool = ProjectTool::from_db_str(s).unwrap();
            assert_eq!(tool.as_db_str(), s);
        }
    }

    #[test]
    fn processing_tool_rejects_unknown_string() {
        assert!(ProjectTool::from_db_str("Photoshop").is_err());
    }

    #[test]
    fn planetary_suite_serializes_with_space() {
        let tool = ProjectTool::PlanetarySuite;
        let json = serde_json::to_string(&tool).unwrap();
        assert_eq!(json, r#""Planetary Suite""#);
    }
}
