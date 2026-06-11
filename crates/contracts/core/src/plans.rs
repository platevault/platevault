//! Filesystem plan contract DTOs for the Tauri IPC surface (spec 017).
//!
//! These types mirror the JSON Schema contracts under
//! `specs/017-cleanup-archive-review-plans/contracts/`.
//!
//! Field names are camelCase (R-Env-1). The review-side state machine writes
//! only `draft`, `ready_for_review`, `approved`, and `discarded`; apply-side
//! states (`applying`, `paused`, `applied`, `partially_applied`, `failed`,
//! `cancelled`) are written exclusively by spec 025's executor.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Re-exported for convenience ───────────────────────────────────────────────

pub use crate::lifecycle::PlanState;

// ── Enums ─────────────────────────────────────────────────────────────────────

/// Plan origin — which generator created this plan.
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
pub enum PlanOrigin {
    Inbox,
    Restructure,
    Cleanup,
    Archive,
    Project,
}

/// Execution shape of a plan.
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
pub enum PlanType {
    Split,
    Restructure,
    Cleanup,
    Archive,
    SourceMap,
}

/// Per-plan destination for destructive items (R-Trash-1).
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
pub enum DestructiveDestination {
    Archive,
    OsTrash,
}

/// Action to perform on a single filesystem item.
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
pub enum PlanItemAction {
    Move,
    Archive,
    Delete,
    Link,
    Write,
}

/// Protection status from spec 016.
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
pub enum PlanItemProtection {
    Normal,
    Protected,
}

/// Per-item lifecycle state.
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
pub enum PlanItemState {
    Pending,
    Applying,
    Succeeded,
    Failed,
    Skipped,
    Cancelled,
}

// ── Plan summary (list view) ──────────────────────────────────────────────────

/// Plan summary row — returned by `plans.list`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub origin: PlanOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_path: Option<String>,
    pub state: PlanState,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discarded_at: Option<String>,
    pub items_total: i64,
    pub items_applied: i64,
    pub items_failed: i64,
    pub items_skipped: i64,
    pub items_cancelled: i64,
    pub items_pending: i64,
    pub total_bytes_required: i64,
    pub destructive_destination: DestructiveDestination,
    pub plan_type: PlanType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_plan_id: Option<String>,
}

// ── Plan item ─────────────────────────────────────────────────────────────────

/// A provenance label/value pair for how an item was inferred.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceEntry {
    pub label: String,
    pub value: String,
}

/// A single item within a plan detail view.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanItemDetail {
    pub id: String,
    pub index: i64,
    pub name: String,
    pub action: PlanItemAction,
    pub from: String,
    pub to: String,
    pub reason: String,
    pub protection: PlanItemProtection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked: Option<String>,
    pub state: PlanItemState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Vec<ProvenanceEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_mtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_path: Option<String>,
}

// ── Plan detail (get view) ────────────────────────────────────────────────────

/// Full plan detail returned by `plans.get`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanDetail {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub origin: PlanOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_path: Option<String>,
    pub state: PlanState,
    pub plan_type: PlanType,
    pub destructive_destination: DestructiveDestination,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_plan_id: Option<String>,
    pub items_total: i64,
    pub items_applied: i64,
    pub items_failed: i64,
    pub items_skipped: i64,
    pub items_cancelled: i64,
    pub items_pending: i64,
    pub total_bytes_required: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discarded_at: Option<String>,
    pub created_at: String,
    pub items: Vec<PlanItemDetail>,
}

// ── Request / Response types ──────────────────────────────────────────────────

/// Request for `plans.list`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_filter: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_filter: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// Response for `plans.list`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanListResponse {
    pub plans: Vec<PlanSummary>,
}

/// Response for `plans.get`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanGetResponse {
    pub plan: PlanDetail,
}

/// Response for `plans.approve` (A1, R-FS-1).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanApproveResponse {
    pub plan_id: String,
    pub new_state: String,
    /// HMAC token (A1): consumed by spec 025 `plan.apply`.
    pub approval_token: String,
    pub approved_at: String,
}

/// Response for `plans.discard` (A5).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanDiscardResponse {
    pub plan_id: String,
    pub discarded_at: String,
}

/// Filter for which parent items to materialise into a retry plan (R-Retry-1).
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
pub enum RetryItemsFilter {
    Failed,
    Cancelled,
    All,
}

/// Response for `plans.retry`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanRetryResponse {
    pub new_plan_id: String,
    pub parent_plan_id: String,
    pub items_total: i64,
}

/// Response for `archive.send_to_trash`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSendToTrashResponse {
    pub plan_id: String,
    pub items_moved: i64,
    pub audit_id: String,
}

/// Response for `archive.permanently_delete`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePermanentlyDeleteResponse {
    pub plan_id: String,
    pub items_deleted: i64,
    pub audit_id: String,
}
