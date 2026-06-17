//! Contract DTOs for spec 026 — generated source view removal/regeneration.
//!
//! Mirrors `specs/026-generated-project-source-view-removal/contracts/`.
//!
//! Both operations return a `plan_id` that enters the standard spec 017/025
//! pipeline (approve → apply). The remove operation hard-codes the destructive
//! destination to `archive` (R-026-Dest-Archive, GRILL 2026-05-22).
//!
//! Error codes surface upstream spec 017/025 error codes in addition to the
//! view-specific ones listed here.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared error codes ────────────────────────────────────────────────────────

/// Error codes for preparedview.remove and preparedview.regenerate.
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
pub enum PreparedViewErrorCode {
    /// The requested view does not exist in the database.
    ViewNotFound,
    /// Another plan is currently applying against this view.
    ViewInUse,
    /// The view's `kind` does not match one or more item `materialization` values.
    /// Requires manual resolution before any operation is permitted.
    ViewMixedKind,
    /// The view strategy is not supported in v1 (hardlink is deferred to v1.x).
    ViewUnsupportedKind,
    /// The owning project is `archived`; use the spec 009 unarchive path first.
    LifecycleReadOnly,
}

// ── View summary DTO ──────────────────────────────────────────────────────────

/// Summary of a `PreparedSourceView` for display in project detail.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewSummary {
    pub id: String,
    pub project_id: String,
    /// View strategy: `symlink`, `junction`, `copy`, or `hardlink` (reserved).
    pub kind: String,
    /// View lifecycle state (spec 026 data-model).
    pub state: String,
    pub created_at: String,
    pub removed_at: Option<String>,
    pub item_count: i64,
    /// Per-item inventory references (FR-033 / T078).
    /// Each entry is the `view_relative_path` recorded for that inventory item.
    pub items: Vec<PreparedViewItemDetail>,
}

/// Detail of a single view item.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewItemDetail {
    pub id: String,
    pub inventory_item_id: String,
    pub view_relative_path: String,
    pub materialization: String,
    pub last_observed_state: String,
}

// ── preparedview.list ─────────────────────────────────────────────────────────

/// Request: list all prepared source views for a project.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewListRequest {
    pub project_id: String,
}

/// Response: list of view summaries.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewListResponse {
    pub views: Vec<PreparedViewSummary>,
}

// ── preparedview.remove ───────────────────────────────────────────────────────

/// Request: create a `ViewRemovalPlan` for a generated source view.
///
/// Destructive destination is always `archive`; no field is accepted here
/// (R-026-Dest-Archive, GRILL 2026-05-22).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewRemoveRequest {
    pub view_id: String,
}

/// Success response for `preparedview.remove`. The caller should route
/// `plan_id` through the standard plan review (`plans.approve` then
/// `plan.apply`) before the view is physically removed.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewRemoveResponse {
    /// The id of the `ViewRemovalPlan` (a `FilesystemPlan` with origin
    /// `prepared_view_removal`). Route through spec 017/025 pipeline.
    pub plan_id: String,
}

// ── preparedview.regenerate ───────────────────────────────────────────────────

/// Request: create a `ViewRegenerationPlan` for a previously generated
/// (possibly removed) source view.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewRegenerateRequest {
    pub view_id: String,
}

/// Success response for `preparedview.regenerate`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedViewRegenerateResponse {
    /// The id of the `ViewRegenerationPlan` (a `FilesystemPlan` with origin
    /// `prepared_view_regeneration`). Route through spec 017/025 pipeline.
    pub plan_id: String,
    /// Warnings for inventory items that could not be resolved in the current
    /// inventory (e.g. root remapped or item deleted).
    pub unresolved_item_count: u32,
}
