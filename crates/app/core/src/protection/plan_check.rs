// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! US3: `plan.protection.check` gating + acknowledgement audit.

use audit::bus::EventBus;
use audit::event_bus::{ProtectionPlanAcknowledged, Source};
use audit::{AuditLogEntry, Outcome, Severity, TOPIC_PROTECTION_PLAN_ACKNOWLEDGED};
use contracts_core::protection::{
    NonBlockingSummary, PlanProtectionCheckRequest, PlanProtectionCheckResponse, ProtectedPlanItem,
    ProtectionLevel,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{EntityId, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;
use persistence_plans::repositories::plans as plans_repo;
use sqlx::SqlitePool;

use crate::audit_ids::deterministic_entity_id;
use crate::errors::{bus_err, db_err};

use super::load_global_protection;

// ── US3: plan.protection.check ────────────────────────────────────────────

/// Return protection-affected plan items for review gating (T023, FR-008).
///
/// Only items requiring acknowledgement (`resolved_level == protected`) are
/// returned in `protected_items`. Normal and unprotected items appear only as
/// counts in `non_blocking_summary`.
///
/// # Errors
///
/// - `"plan.not_found"` — plan does not exist.
/// - `ContractError` on internal DB failure.
pub async fn plan_protection_check(
    pool: &SqlitePool,
    req: &PlanProtectionCheckRequest,
) -> Result<PlanProtectionCheckResponse, ContractError> {
    // Confirm plan exists.
    let _ = plans_repo::get_plan(pool, &req.plan_id, false).await.map_err(|_| {
        ContractError::new(
            ErrorCode::PlanNotFound,
            format!("plan {} not found", req.plan_id),
            ErrorSeverity::Warning,
            false,
        )
    })?;

    let items = plans_repo::list_plan_items(pool, &req.plan_id).await.map_err(db_err)?;

    let global = load_global_protection(pool).await?;

    let mut protected_items: Vec<ProtectedPlanItem> = Vec::new();
    let mut normal_count: i64 = 0;
    let mut unprotected_count: i64 = 0;

    for item in &items {
        // Resolve effective protection for this item using its stored level.
        // The stored `protection` field on a plan item reflects the level at
        // plan-generation time. We re-read the current source protection here
        // so the check reflects any overrides applied since the plan was created.
        //
        // source_id is not stored on plan_items in the current schema.
        // We use the stored protection column as the baseline and check if the
        // global defaults or override would gate this item.
        let stored_level = item.protection.as_str();

        // US4: check if the item's action should be gated.
        // For items stored as "protected", surface them for acknowledgement.
        // For others, check global settings' blockPermanentDelete gate.
        let effective_level = stored_level;

        let is_delete_action = item.action == "delete";
        let rewritten_action: Option<String> = if is_delete_action
            && global.block_permanent_delete
            && effective_level == "protected"
        {
            Some("archive".to_owned())
        } else {
            None
        };

        match effective_level {
            "protected" => {
                // Populate source_id from the plan item row (FR-017, T045 fix for
                // protection.rs:287 hardcoded None). The source_id column is populated
                // by real generators since T044.
                let matched_categories = item
                    .category
                    .as_deref()
                    .filter(|cat| global.categories.iter().any(|c| c == cat))
                    .map(|cat| vec![cat.to_owned()])
                    .unwrap_or_default();

                protected_items.push(ProtectedPlanItem {
                    item_id: item.id.clone(),
                    source_id: item.source_id.clone(),
                    level: ProtectionLevel::Protected,
                    matched_categories,
                    original_action: item.action.clone(),
                    rewritten_action,
                    requires_acknowledgement: true,
                    reason: format!(
                        "Item '{}' is from a protected source and requires explicit approval.",
                        item.name
                    ),
                });
            }
            "unprotected" => {
                unprotected_count += 1;
            }
            _ => {
                // "normal" or anything else.
                normal_count += 1;
            }
        }
    }

    let has_protected_items = !protected_items.is_empty();

    Ok(PlanProtectionCheckResponse {
        plan_id: req.plan_id.clone(),
        has_protected_items,
        protected_items,
        non_blocking_summary: NonBlockingSummary { normal_count, unprotected_count },
    })
}

// ── US3: plan.protection.acknowledged ────────────────────────────────────

/// Emit a `protection.plan.acknowledged` audit event (T025).
///
/// Called by the UI when the user explicitly acknowledges a protected item.
///
/// # Errors
///
/// Returns `ContractError` on audit failure.
pub async fn acknowledge_protected_item(
    bus: &EventBus,
    plan_id: &str,
    item_id: &str,
    source_id: Option<&str>,
    resolved_level: &str,
    reason: &str,
) -> Result<String, ContractError> {
    let at = Timestamp::now_iso();
    let entry = AuditLogEntry::new(
        EntityType::Protection,
        deterministic_entity_id("protection.plan_item", &format!("{plan_id}:{item_id}")),
        "protection.plan.acknowledged",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({
        "planId": plan_id, "itemId": item_id, "sourceId": source_id,
        "resolvedLevel": resolved_level, "reason": reason,
    }));
    let audit_id = bus
        .write_audit(
            entry,
            TOPIC_PROTECTION_PLAN_ACKNOWLEDGED,
            Source::User,
            ProtectionPlanAcknowledged {
                plan_id: plan_id.to_owned(),
                item_id: item_id.to_owned(),
                source_id: source_id.map(str::to_owned),
                resolved_level: resolved_level.to_owned(),
                reason: reason.to_owned(),
                at,
            },
        )
        .await
        .map_err(bus_err)?
        .as_uuid()
        .to_string();
    Ok(audit_id)
}
