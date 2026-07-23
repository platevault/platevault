// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Archive management contract DTOs (spec 017 US2/US6, C5 reconciliation).
//!
//! The Archive surface lists projects whose lifecycle has reached `archived`
//! (the terminal closure of the requires-plan gate, driven by a successful
//! `origin = archive` plan apply). Each row carries the `archived_via_plan_id`
//! so the archive-management operations (`archive.send_to_trash`,
//! `archive.permanently_delete`) can act on the owning plan in O(1).

use serde::{Deserialize, Serialize};
use specta::Type;

/// One archived entity row for the Archive page. `"project"` (C5 design) or
/// `"master"` (#886) today — no session/target tabs until a real archival
/// model for them is designed.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// Archived entity id (a project or calibration-master id).
    pub id: String,
    /// Display name (project name, or the master's file name for `"master"`
    /// rows).
    pub name: String,
    /// Entity kind: `"project"` or `"master"`.
    pub entity_type: String,
    /// When the entity was archived (ISO-8601). For a project, when it
    /// reached the `archived` lifecycle state; masters have no lifecycle
    /// state machine, so this is the plan-apply finalize timestamp.
    pub archived_at: String,
    /// Human-readable reason (the archive plan title). `None` when the owning
    /// plan row no longer exists (spec-030 Q16 / FR-136 — never an empty-string
    /// sentinel standing in for absence).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The entity's original on-disk location (project-relative library path
    /// for a project row; root-relative file path for a master row).
    pub original_path: String,
    /// Bytes moved into the app-managed archive by the owning plan. `None`
    /// when unresolved (spec-030 Q16 / FR-136 — never a sentinel 0, "Size 0 KB").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    /// Plan that archived this entity. Drives the management operations
    /// (`archive.send_to_trash` / `archive.permanently_delete`). `None` only
    /// for legacy rows archived before this column existed.
    pub archived_via_plan_id: Option<String>,
    /// Absolute on-disk path to the app-managed archive folder holding this
    /// entity's files (`<parent-of-first-item>/.astro-plan-archive/
    /// <planId>/`, #874). Derived from the owning plan's first archived item
    /// at read time; `None` when the owning plan is missing or has no
    /// archived items to derive a folder from — never a fabricated path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_folder_path: Option<String>,
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
    /// Diagnostic sentence explaining an empty plan (#603): set only when
    /// `item_count == 0`, so the review UI can render a reason instead of a
    /// bare disabled "Approve & apply" button. `None` whenever the plan has
    /// items — never a filler string standing in for "everything's fine".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty_reason: Option<String>,
}

/// Result of `archive.plan.generate_restore` (#885) — a reviewable
/// un-archive plan created in `ready_for_review`, moving a project's
/// previously archived files back to their recorded original locations.
/// Never auto-applied (constitution II).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRestorePlanResult {
    /// Id of the newly created restore plan (in `ready_for_review` state).
    pub plan_id: String,
    /// Total number of restore items placed on the plan (one per archived
    /// item the original archive plan actually moved).
    pub item_count: u32,
    /// Number of items that resolved to a protected protection level and will
    /// gate plan approval until acknowledged (constitution II).
    pub protected_item_count: u32,
}
