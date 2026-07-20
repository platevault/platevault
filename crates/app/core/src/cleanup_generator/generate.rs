// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Generate (reviewable plan) — D11 step 2.

use contracts_core::cleanup::{CleanupAction, GenerateCleanupPlanResult};
use contracts_core::ContractError;
use domain_core::ids::new_id;
use persistence_db::repositories::projects as projects_repo;
use sqlx::SqlitePool;

use crate::protection::{self, CleanupPlanItem, GenerateCleanupPlanRequest};

use super::policy::get_policy;
use super::scan::{action_map, scan_with_policy};
use super::{file_name, DataType};

// ── Generate (reviewable plan) ─────────────────────────────────────────────

/// Materialise a reviewable cleanup plan for a project (D11 step 2).
///
/// Runs [`super::scan`] to collect candidates, maps each to a
/// [`CleanupPlanItem`] (with the project id as its source and the data type's
/// protected-category as its category), then delegates to
/// [`crate::protection::generate_cleanup_plan`] which persists the plan +
/// items and resolves per-item protection. The returned counts let the caller
/// show how many items will gate approval.
///
/// Generating a plan performs NO filesystem mutation (FR-002).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn generate(
    pool: &SqlitePool,
    project_id: &str,
    title: Option<&str>,
    destructive_destination: Option<&str>,
) -> Result<GenerateCleanupPlanResult, ContractError> {
    // Load the policy once and reuse the snapshot for both the scan and the
    // item-building action map, so a concurrent policy update cannot make the
    // candidate set and the per-item actions disagree.
    let policy = get_policy(pool).await?;
    let scan_result = scan_with_policy(pool, project_id, &policy).await?;
    let actions = action_map(&policy);

    let plan_id = new_id();

    // Derive a title from the project when the caller did not supply one.
    let resolved_title = match title {
        Some(t) => t.to_owned(),
        None => match projects_repo::get_project(pool, project_id).await {
            Ok(p) => format!("Cleanup: {}", p.name),
            Err(_) => "Cleanup plan".to_owned(),
        },
    };

    let destination = destructive_destination.unwrap_or("archive").to_owned();

    let items: Vec<CleanupPlanItem> = scan_result
        .candidates
        .iter()
        .enumerate()
        .map(|(idx, candidate)| {
            let data_type = DataType::from_policy_str(&candidate.data_type);
            let action = actions.get(data_type.as_str()).copied().unwrap_or(CleanupAction::Keep);
            let action_str = match action {
                CleanupAction::Delete => "delete",
                // Keep should not occur (scan already filtered it), but default
                // to the non-destructive archive action if it somehow does.
                CleanupAction::Archive | CleanupAction::Keep => "archive",
            };
            CleanupPlanItem {
                id: format!("{plan_id}-item-{idx}"),
                name: file_name(&candidate.file_path).to_owned(),
                action: action_str.to_owned(),
                source_id: project_id.to_owned(),
                category: data_type.protection_category().to_owned(),
                from_relative_path: candidate.file_path.clone(),
                from_root_id: None,
                to_relative_path: String::new(),
            }
        })
        .collect();

    let item_count = u32::try_from(items.len()).unwrap_or(u32::MAX);

    // Real destination byte requirement (FR-012 / spec 025 D17): only
    // archive-action items occupy space in the app-managed archive folder;
    // delete/trash items need none. Sum the sizes of the archive-action
    // candidates so the apply executor's free-space pre-flight has data.
    let total_bytes_required: i64 = scan_result
        .candidates
        .iter()
        .zip(items.iter())
        .filter(|(_, item)| item.action == "archive")
        .map(|(candidate, _)| i64::try_from(candidate.size_bytes).unwrap_or(i64::MAX))
        .fold(0_i64, i64::saturating_add);

    let gen_req = GenerateCleanupPlanRequest {
        plan_id: plan_id.clone(),
        title: resolved_title,
        destructive_destination: destination,
        total_bytes_required,
        items,
    };

    let resp = protection::generate_cleanup_plan(pool, &gen_req).await?;

    Ok(GenerateCleanupPlanResult {
        plan_id: resp.plan_id,
        item_count,
        protected_item_count: u32::try_from(resp.protected_item_count).unwrap_or(u32::MAX),
    })
}
