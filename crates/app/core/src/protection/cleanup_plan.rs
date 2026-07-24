// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! US4: cleanup/archive plan generation (`generate_cleanup_plan` /
//! `generate_plan`) and the shared protection-resolved plan generator tail.

use camino::Utf8Path;
use contracts_core::ContractError;
use persistence_plans::repositories::plans as plans_repo;
use persistence_plans::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;

use crate::errors::db_err;

use super::load_global_protection;

// ── US4: generate_cleanup_plan ────────────────────────────────────────────

/// A single item description for cleanup plan generation.
///
/// Callers provide real `source_id` and `category` so the generator can resolve
/// the effective protection level from the DB.
pub struct CleanupPlanItem {
    /// Opaque item id (caller-supplied or generated).
    pub id: String,
    /// Display name (file name or path tail).
    pub name: String,
    /// Cleanup action: `"move"`, `"archive"`, or `"delete"`.
    pub action: String,
    /// Real source FK (FR-016).
    pub source_id: String,
    /// Classification category (FR-016), e.g. `"lights"`, `"masters"`.
    pub category: String,
    /// Source-relative path.
    pub from_relative_path: String,
    /// Library root id.
    pub from_root_id: Option<String>,
    /// Destination-relative path (may be empty for archive/delete).
    pub to_relative_path: String,
}

/// Minimum request for generating a cleanup plan.
pub struct GenerateCleanupPlanRequest {
    pub plan_id: String,
    pub title: String,
    pub destructive_destination: String,
    /// Bytes the plan will require at its destination once applied (FR-012 /
    /// spec 025 D17). For cleanup plans this is the total size of archive-action
    /// items (items sent to trash or deleted need no destination space). The
    /// apply executor's free-space pre-flight reads this; the generator only
    /// populates it.
    pub total_bytes_required: i64,
    pub items: Vec<CleanupPlanItem>,
}

/// Generalised request for generating any protection-resolved plan (D12 shared
/// helper). [`GenerateCleanupPlanRequest`] is the cleanup-specialised façade
/// over this; the whole-project archive generator (spec 017 WP-B) reuses the
/// same protection-resolution tail with `origin`/`plan_type` = `archive`.
pub struct GeneratePlanRequest {
    pub plan_id: String,
    pub title: String,
    /// Plan origin (`"cleanup"`, `"archive"`, …) — drives the plans-list origin
    /// filter (FR-010).
    pub origin: String,
    /// Plan type (`"cleanup"`, `"archive"`, …).
    pub plan_type: String,
    /// Origin context carried on the plan row. The archive generator stores the
    /// project id here so the apply path can drive the lifecycle closure.
    pub origin_path: Option<String>,
    pub destructive_destination: String,
    /// Per-item `reason` label stored on every item.
    pub reason: String,
    /// See [`GenerateCleanupPlanRequest::total_bytes_required`].
    pub total_bytes_required: i64,
    pub items: Vec<CleanupPlanItem>,
}

/// Response from `generate_cleanup_plan`.
pub struct GenerateCleanupPlanResponse {
    pub plan_id: String,
    /// Number of items tagged as protected (gate will block apply until acknowledged).
    pub protected_item_count: usize,
}

/// Generate a cleanup/archive plan, tagging each item with its real `source_id`,
/// `category`, and resolved `protection` level (FR-016, T044).
///
/// This is the real generator path that makes `plan_protection_check` fire on
/// actual cleanup plans (fixes the PHANTOM gate from validation finding T1-1).
///
/// Each item's effective protection is resolved by calling `resolve_protection`
/// against the DB, so per-source overrides and global defaults are respected.
///
/// # Errors
///
/// Returns `ContractError` on DB failure.
pub async fn generate_cleanup_plan(
    pool: &SqlitePool,
    req: &GenerateCleanupPlanRequest,
) -> Result<GenerateCleanupPlanResponse, ContractError> {
    generate_plan(
        pool,
        &GeneratePlanRequest {
            plan_id: req.plan_id.clone(),
            title: req.title.clone(),
            origin: "cleanup".to_owned(),
            plan_type: "cleanup".to_owned(),
            origin_path: None,
            destructive_destination: req.destructive_destination.clone(),
            reason: "cleanup".to_owned(),
            total_bytes_required: req.total_bytes_required,
            // CleanupPlanItem is not Clone; move the items in by rebuilding the
            // request is avoidable — callers hand us a borrowed req, so clone
            // the item fields into fresh CleanupPlanItems.
            items: req
                .items
                .iter()
                .map(|i| CleanupPlanItem {
                    id: i.id.clone(),
                    name: i.name.clone(),
                    action: i.action.clone(),
                    source_id: i.source_id.clone(),
                    category: i.category.clone(),
                    from_relative_path: i.from_relative_path.clone(),
                    from_root_id: i.from_root_id.clone(),
                    to_relative_path: i.to_relative_path.clone(),
                })
                .collect(),
        },
    )
    .await
}

/// Compute an absolute, collision-free archive destination for an
/// `action = "archive"` plan item (spec 037 Journey 6/7 bugfix).
///
/// **Prior bug (found while adding Layer-2 archive/cleanup apply coverage,
/// spec 037):** `archive_path` was hardcoded to `None` for every plan item
/// regardless of action, so the spec-025 executor's fallback used
/// `to_relative_path` verbatim. Both generators leave that fallback
/// unusable: `archive_generator` sets it equal to the source path (apply then
/// fails every item with `conflict.destination_exists`, since source ==
/// destination), and `cleanup_generator` leaves it an empty string. Neither
/// path had ever been exercised by a real filesystem apply before this spec —
/// see the coverage-matrix "Archive/cleanup plan apply" gap.
///
/// Destination convention: `<parent-dir-of-source>/.astro-plan-archive/
/// <planId>/<itemId>-<fileName>`. Anchoring on the source file's own parent
/// directory (rather than a resolved library root) keeps this fix local to
/// the shared generator tail — no root/project-path lookup required — and
/// `item_id` (already globally unique per plan) guarantees no collision
/// between same-named files. A single unified per-plan archive root (one
/// folder regardless of how many source directories a project's artifacts
/// span) is a reasonable follow-up but not required for a correct, safe,
/// never-overwriting apply.
fn compute_archive_destination(plan_id: &str, item_id: &str, from_relative_path: &str) -> String {
    let src = Utf8Path::new(from_relative_path);
    let file_name = src.file_name().unwrap_or(from_relative_path);
    let parent = src.parent().map_or(".", Utf8Path::as_str);
    format!("{parent}/.astro-plan-archive/{plan_id}/{item_id}-{file_name}")
}

/// Generalised protection-resolved plan generator (D12 shared tail).
///
/// Creates the plan row (in `draft`), inserts each item with its real
/// `source_id`/`category`/resolved `protection` level, then advances the plan to
/// `ready_for_review` so [`crate::protection::plan_protection_check`] can fire.
/// Performs NO filesystem mutation (FR-002). Used by both the cleanup generator
/// (per-file) and the archive generator (whole-project).
///
/// # Errors
///
/// Returns `ContractError` on DB failure.
pub async fn generate_plan(
    pool: &SqlitePool,
    req: &GeneratePlanRequest,
) -> Result<GenerateCleanupPlanResponse, ContractError> {
    // Create the plan in draft state.
    plans_repo::insert_plan(
        pool,
        &plans_repo::InsertPlan {
            id: &req.plan_id,
            title: &req.title,
            origin: &req.origin,
            origin_path: req.origin_path.as_deref(),
            plan_type: &req.plan_type,
            destructive_destination: &req.destructive_destination,
            parent_plan_id: None,
            total_bytes_required: req.total_bytes_required,
        },
    )
    .await
    .map_err(db_err)?;

    // Load global protection once for the whole plan.
    let global = load_global_protection(pool).await?;

    let mut protected_item_count = 0;

    for (idx, item) in req.items.iter().enumerate() {
        // Resolve effective protection for this item using real source_id + category.
        let resolved = prot_repo::resolve_protection(
            pool,
            &item.source_id,
            Some(&item.category),
            &global.level,
            global.block_permanent_delete,
            &global.categories,
        )
        .await
        .map_err(db_err)?;

        // The `plan_items.protection` column only permits 'normal' | 'protected'
        // (migration 0014 CHECK). `resolve_protection` can return "unprotected"
        // for a source with an explicit unprotected override, so map it to
        // 'normal' for storage — both are non-gating from the plan's view.
        let protection = if resolved.level == "unprotected" { "normal" } else { &resolved.level };
        if protection == "protected" {
            protected_item_count += 1;
        }

        // Bugfix (spec 037 Journey 6/7): compute a real, distinct archive
        // destination for `archive`-action items instead of always storing
        // `None` (see `compute_archive_destination` doc for why the old
        // fallback made every real archive apply fail). `to_relative_path`
        // is also set to the same value so the plan-review UI's destination
        // preview shows where the file will actually land, rather than
        // repeating the source path or showing nothing.
        //
        // Issue #806: only compute the `.astro-plan-archive/` convention when
        // the plan's chosen destination is actually the archive folder. A
        // `trash`-destination plan has no app-managed archive subfolder to
        // preview, so fabricating one here misled the review table's
        // DESTINATION column even though the plan header correctly showed
        // "System trash".
        let archive_dest = (item.action == "archive" && req.destructive_destination != "trash")
            .then(|| compute_archive_destination(&req.plan_id, &item.id, &item.from_relative_path));
        let to_relative_path: &str = archive_dest.as_deref().unwrap_or(&item.to_relative_path);

        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &item.id,
                plan_id: &req.plan_id,
                item_index: i64::try_from(idx).unwrap_or(i64::MAX),
                name: &item.name,
                action: &item.action,
                from_root_id: item.from_root_id.as_deref(),
                from_relative_path: &item.from_relative_path,
                to_root_id: None,
                to_relative_path,
                reason: &req.reason,
                protection,
                linked_entity: None,
                provenance_json: None,
                archive_path: archive_dest.as_deref(),
                source_id: Some(&item.source_id),
                category: Some(&item.category),
            },
        )
        .await
        .map_err(db_err)?;
    }

    // Advance to ready_for_review so plan_protection_check can run.
    plans_repo::update_plan_state(pool, &req.plan_id, "ready_for_review").await.map_err(db_err)?;

    Ok(GenerateCleanupPlanResponse { plan_id: req.plan_id.clone(), protected_item_count })
}
