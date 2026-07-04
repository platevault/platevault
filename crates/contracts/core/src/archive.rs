//! Archive management contract DTOs (spec 017 US2/US6, C5 reconciliation).
//!
//! The Archive surface lists projects whose lifecycle has reached `archived`
//! (the terminal closure of the requires-plan gate, driven by a successful
//! `origin = archive` plan apply). Each row carries the `archived_via_plan_id`
//! so the archive-management operations (`archive.send_to_trash`,
//! `archive.permanently_delete`) can act on the owning plan in O(1).

use serde::{Deserialize, Serialize};
use specta::Type;

/// One archived entity row for the Archive page (C5 design: projects only).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// Archived entity id (a project id in the current design).
    pub id: String,
    /// Display name (project name).
    pub name: String,
    /// Entity kind. Always `"project"` today (D7/D14: no session/master/target
    /// tabs until a real archival model for them is designed).
    pub entity_type: String,
    /// When the entity reached the `archived` lifecycle state (ISO-8601).
    pub archived_at: String,
    /// Human-readable reason (the archive plan title when available).
    pub reason: String,
    /// The entity's original on-disk location (project-relative library path).
    pub original_path: String,
    /// Bytes moved into the app-managed archive by the owning plan.
    pub size_bytes: i64,
    /// Plan that archived this entity. Drives the management operations
    /// (`archive.send_to_trash` / `archive.permanently_delete`). `None` only
    /// for legacy rows archived before this column existed.
    pub archived_via_plan_id: Option<String>,
}

/// Response for `archive.list` — every project currently in `archived`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListResponse {
    pub entries: Vec<ArchiveEntry>,
}

/// Result of `archive.plan.generate` — a whole-project archive plan created in
/// `ready_for_review` (constitution II: reviewable, never auto-applied).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateArchivePlanResult {
    /// Id of the newly created archive plan (in `ready_for_review` state).
    pub plan_id: String,
    /// Total number of archive items placed on the plan.
    pub item_count: u32,
    /// Number of items that resolved to a protected protection level and will
    /// gate plan approval until acknowledged (constitution II).
    pub protected_item_count: u32,
}
