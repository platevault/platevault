//! Filesystem plan contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `FilesystemPlan`,
//! `PlanDetail`, and `PlanItem` in `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::lifecycle::PlanState;
use crate::provenance::ProvenanceOrigin;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of filesystem plan.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PlanKind {
    ProjectStructure,
    SourceView,
    SourceViewRemoval,
    Archive,
    Cleanup,
    RootRemap,
    Manifest,
}

/// Action to perform on a single filesystem item.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemAction {
    Mkdir,
    Move,
    Copy,
    Link,
    Junction,
    Write,
    Archive,
    Trash,
    Delete,
}

/// Status of a single plan item.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemStatus {
    Pending,
    Applied,
    Failed,
    Skipped,
    Protected,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// Dry-run result summary.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DryRunResult {
    pub passed: u32,
    pub warnings: u32,
    pub failures: u32,
}

/// A single item within a filesystem plan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub action: PlanItemAction,
    pub source_path: String,
    pub dest_path: String,
    pub status: PlanItemStatus,
    pub dry_run_ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection_reason: Option<String>,
    pub provenance: ProvenanceOrigin,
}

/// A filesystem plan as seen in list/detail views.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemPlan {
    pub id: String,
    pub kind: PlanKind,
    pub state: PlanState,
    pub items: Vec<PlanItem>,
    pub dry_run_result: DryRunResult,
    pub has_destructive: bool,
    pub reclaim_bytes: u64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
}

/// Safety summary for a plan detail view.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanSafetySummary {
    pub item_count: u32,
    pub reclaim_bytes: u64,
    pub trash_count: u32,
    pub archive_count: u32,
    pub delete_count: u32,
    pub protected_count: u32,
}

/// Extended detail view of a filesystem plan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanDetail {
    // Flattened base fields from FilesystemPlan.
    pub id: String,
    pub kind: PlanKind,
    pub state: PlanState,
    pub items: Vec<PlanItem>,
    pub dry_run_result: DryRunResult,
    pub has_destructive: bool,
    pub reclaim_bytes: u64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
    // Detail-only fields.
    pub summary: PlanSafetySummary,
}
