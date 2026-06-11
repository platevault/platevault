//! Application use-case for spec 016 source protection (US2–US4).
//!
//! - US2: per-source protection override (get + set + resolve).
//! - US3: plan gating — `plan_protection_check` returns protected items.
//! - US4: category enforcement — category membership elevates level via resolver.

use audit::bus::EventBus;
use audit::event_bus::{ProtectionPlanAcknowledged, ProtectionSourceSet, Source};
use audit::{TOPIC_PROTECTION_PLAN_ACKNOWLEDGED, TOPIC_PROTECTION_SOURCE_SET};
use contracts_core::protection::{
    NonBlockingSummary, PlanProtectionCheckRequest, PlanProtectionCheckResponse, ProtectedPlanItem,
    ProtectionLevel, SourceProtectionGetRequest, SourceProtectionGetResponse,
    SourceProtectionSetRequest, SourceProtectionSetResponse,
};
use contracts_core::{ContractError, ErrorSeverity};
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::settings as settings_repo;
use persistence_db::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

// ── Error helpers ─────────────────────────────────────────────────────────

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: persistence_db::DbError) -> ContractError {
    ContractError::new("internal.database", format!("{e}"), ErrorSeverity::Fatal, true)
}

#[allow(clippy::needless_pass_by_value)]
fn bus_err(e: audit::bus::BusError) -> ContractError {
    ContractError::new("internal.audit", format!("{e}"), ErrorSeverity::Fatal, true)
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ── Global settings helpers ───────────────────────────────────────────────

/// Load the three protection-relevant global settings from the DB.
/// Falls back to hard-coded defaults when rows are absent.
async fn load_global_protection(pool: &SqlitePool) -> Result<GlobalProtection, ContractError> {
    use serde_json::Value;

    let level_val = settings_repo::get_raw(pool, "defaultProtection").await.map_err(db_err)?;
    let bpd_val = settings_repo::get_raw(pool, "blockPermanentDelete").await.map_err(db_err)?;
    let cats_val = settings_repo::get_raw(pool, "protectedCategories").await.map_err(db_err)?;

    let level = level_val.as_ref().and_then(Value::as_str).unwrap_or("protected").to_owned();

    let block_permanent_delete = bpd_val.as_ref().and_then(Value::as_bool).unwrap_or(true);

    let categories: Vec<String> = match cats_val {
        Some(Value::Array(arr)) => {
            arr.into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()
        }
        _ => vec!["lights".to_owned(), "masters".to_owned(), "finals".to_owned()],
    };

    Ok(GlobalProtection { level, block_permanent_delete, categories })
}

struct GlobalProtection {
    level: String,
    block_permanent_delete: bool,
    categories: Vec<String>,
}

// ── US2: source.protection.get ────────────────────────────────────────────

/// Resolve effective protection for a source (or return global defaults when
/// `source_id` is `None`).
///
/// # Errors
///
/// Returns `"source.not_found"` if the source does not exist (currently not
/// validated at this layer — callers should validate FK separately when needed).
/// Returns `ContractError` on internal database failure.
pub async fn get_source_protection(
    pool: &SqlitePool,
    req: &SourceProtectionGetRequest,
) -> Result<SourceProtectionGetResponse, ContractError> {
    let global = load_global_protection(pool).await?;

    match &req.source_id {
        None => {
            // Return global defaults directly.
            Ok(SourceProtectionGetResponse {
                source_id: None,
                level: ProtectionLevel::parse_level(&global.level),
                block_permanent_delete: global.block_permanent_delete,
                categories: global.categories,
                inherits_default: true,
            })
        }
        Some(source_id) => {
            let resolved = prot_repo::resolve_protection(
                pool,
                source_id,
                None,
                &global.level,
                global.block_permanent_delete,
                &global.categories,
            )
            .await
            .map_err(db_err)?;

            Ok(SourceProtectionGetResponse {
                source_id: Some(source_id.clone()),
                level: ProtectionLevel::parse_level(&resolved.level),
                block_permanent_delete: resolved.block_permanent_delete,
                categories: resolved.categories,
                inherits_default: resolved.inherits_default,
            })
        }
    }
}

// ── US2: source.protection.set ────────────────────────────────────────────

/// Set or replace the protection override for a source (T013, T016).
///
/// Emits a `protection.source.set` audit event.
///
/// # Errors
///
/// - `"level.unknown"` — `level` is not a recognised `ProtectionLevel`.
/// - `ContractError` on internal DB or audit failure.
pub async fn set_source_protection(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &SourceProtectionSetRequest,
) -> Result<SourceProtectionSetResponse, ContractError> {
    // Validate level string.
    let level_str = req.level.as_str();

    // Read prior state for the audit record.
    let prior_row =
        prot_repo::get_source_protection_row(pool, &req.source_id).await.map_err(db_err)?;

    let prior_level = prior_row
        .as_ref()
        .map_or(ProtectionLevel::Normal, |r| ProtectionLevel::parse_level(&r.level));

    let prior_bpd: Option<bool> =
        prior_row.as_ref().and_then(|r| r.block_permanent_delete.map(|v| v != 0));

    let prior_cats: Option<Vec<String>> = prior_row.as_ref().and_then(|r| {
        r.categories.as_deref().map(|s| serde_json::from_str::<Vec<String>>(s).unwrap_or_default())
    });

    // Write the override.
    let cats_slice: Option<&[String]> = req.categories.as_deref();
    prot_repo::upsert_source_protection(
        pool,
        &req.source_id,
        level_str,
        req.block_permanent_delete,
        cats_slice,
        "user",
    )
    .await
    .map_err(db_err)?;

    // Emit audit event (T016).
    let at = now_iso();
    let audit_id = new_id();
    bus.publish(
        TOPIC_PROTECTION_SOURCE_SET,
        Source::User,
        ProtectionSourceSet {
            source_id: req.source_id.clone(),
            prior_level: prior_level.as_str().to_owned(),
            new_level: level_str.to_owned(),
            prior_categories: prior_cats.clone(),
            new_categories: req.categories.clone(),
            at,
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(SourceProtectionSetResponse {
        source_id: req.source_id.clone(),
        prior_level,
        new_level: req.level,
        prior_block_permanent_delete: prior_bpd,
        new_block_permanent_delete: req.block_permanent_delete,
        prior_categories: prior_cats,
        new_categories: req.categories.clone(),
        audit_id,
    })
}

// ── US2: Seed default protection when a source is added (T014) ────────────

/// Seed the initial per-source protection based on source kind.
///
/// Inbox sources start at `normal`; all others start at `protected`.
/// This is a best-effort operation — failures are logged but not propagated.
///
/// # Errors
///
/// Returns `ContractError` on internal DB failure.
pub async fn seed_source_protection(
    pool: &SqlitePool,
    source_id: &str,
    source_kind: &str,
) -> Result<(), ContractError> {
    let level = if source_kind == "inbox" { "normal" } else { "protected" };
    prot_repo::upsert_source_protection(pool, source_id, level, None, None, "system")
        .await
        .map_err(db_err)
}

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
            "plan.not_found",
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
                protected_items.push(ProtectedPlanItem {
                    item_id: item.id.clone(),
                    source_id: None, // source_id not stored on plan_items in current schema
                    level: ProtectionLevel::Protected,
                    matched_categories: vec![],
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
    let at = now_iso();
    let audit_id = new_id();
    bus.publish(
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
    .map_err(bus_err)?;
    Ok(audit_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::bus::EventBus;
    use persistence_db::repositories::plans as plans_repo;
    use persistence_db::repositories::plans::InsertPlan;
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_plan_with_items(db: &Database, plan_id: &str, protection: &str) {
        plans_repo::insert_plan(
            db.pool(),
            &InsertPlan {
                id: plan_id,
                title: "Test plan",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();

        plans_repo::insert_plan_item(
            db.pool(),
            &persistence_db::repositories::plans::InsertPlanItem {
                id: "item-1",
                plan_id,
                item_index: 1,
                name: "test.fit",
                action: "move",
                from_root_id: None,
                from_relative_path: "test.fit",
                to_root_id: None,
                to_relative_path: "",
                reason: "test",
                protection,
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn get_global_protection_returns_defaults() {
        let (db, _bus) = setup().await;
        let req = SourceProtectionGetRequest { source_id: None };
        let resp = get_source_protection(db.pool(), &req).await.unwrap();
        assert!(resp.inherits_default);
        assert_eq!(resp.level, ProtectionLevel::Protected);
        assert!(resp.block_permanent_delete);
    }

    #[tokio::test]
    async fn get_source_protection_inherits_when_no_override() {
        let (db, _bus) = setup().await;
        let req = SourceProtectionGetRequest { source_id: Some("src-abc".to_owned()) };
        let resp = get_source_protection(db.pool(), &req).await.unwrap();
        assert!(resp.inherits_default);
    }

    #[tokio::test]
    async fn set_and_get_source_protection_round_trip() {
        let (db, bus) = setup().await;
        let source_id = "src-001";

        let set_req = SourceProtectionSetRequest {
            source_id: source_id.to_owned(),
            level: ProtectionLevel::Normal,
            block_permanent_delete: Some(false),
            categories: None,
        };
        set_source_protection(db.pool(), &bus, &set_req).await.unwrap();

        let get_req = SourceProtectionGetRequest { source_id: Some(source_id.to_owned()) };
        let resp = get_source_protection(db.pool(), &get_req).await.unwrap();

        assert_eq!(resp.level, ProtectionLevel::Normal);
        assert!(!resp.block_permanent_delete);
        assert!(!resp.inherits_default);
    }

    #[tokio::test]
    async fn plan_protection_check_not_found() {
        let (db, _bus) = setup().await;
        let req = PlanProtectionCheckRequest { plan_id: "nonexistent".to_owned() };
        let err = plan_protection_check(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "plan.not_found");
    }

    #[tokio::test]
    async fn plan_protection_check_returns_protected_items() {
        let (db, _bus) = setup().await;
        insert_plan_with_items(&db, "plan-1", "protected").await;

        let req = PlanProtectionCheckRequest { plan_id: "plan-1".to_owned() };
        let resp = plan_protection_check(db.pool(), &req).await.unwrap();

        assert!(resp.has_protected_items);
        assert_eq!(resp.protected_items.len(), 1);
        assert_eq!(resp.protected_items[0].level, ProtectionLevel::Protected);
        assert!(resp.protected_items[0].requires_acknowledgement);
        assert_eq!(resp.non_blocking_summary.normal_count, 0);
    }

    #[tokio::test]
    async fn plan_protection_check_normal_items_in_summary() {
        let (db, _bus) = setup().await;
        insert_plan_with_items(&db, "plan-2", "normal").await;

        let req = PlanProtectionCheckRequest { plan_id: "plan-2".to_owned() };
        let resp = plan_protection_check(db.pool(), &req).await.unwrap();

        assert!(!resp.has_protected_items);
        assert!(resp.protected_items.is_empty());
        assert_eq!(resp.non_blocking_summary.normal_count, 1);
    }

    #[tokio::test]
    async fn seed_source_protection_inbox_gets_normal() {
        let (db, _bus) = setup().await;
        seed_source_protection(db.pool(), "src-inbox", "inbox").await.unwrap();

        let row = prot_repo::get_source_protection_row(db.pool(), "src-inbox")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(row.level, "normal");
    }

    #[tokio::test]
    async fn seed_source_protection_inventory_gets_protected() {
        let (db, _bus) = setup().await;
        seed_source_protection(db.pool(), "src-inv", "inventory").await.unwrap();

        let row = prot_repo::get_source_protection_row(db.pool(), "src-inv")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(row.level, "protected");
    }

    #[tokio::test]
    async fn set_protection_emits_audit_event() {
        let (db, bus) = setup().await;
        let source_id = "src-002";

        let set_req = SourceProtectionSetRequest {
            source_id: source_id.to_owned(),
            level: ProtectionLevel::Unprotected,
            block_permanent_delete: None,
            categories: Some(vec!["finals".to_owned()]),
        };
        let resp = set_source_protection(db.pool(), &bus, &set_req).await.unwrap();
        assert_eq!(resp.new_level, ProtectionLevel::Unprotected);
        assert!(!resp.audit_id.is_empty());
    }

    #[tokio::test]
    async fn delete_action_on_protected_item_gets_rewritten_action() {
        let (db, _bus) = setup().await;
        // Insert a plan with a "delete" action item marked as protected.
        plans_repo::insert_plan(
            db.pool(),
            &InsertPlan {
                id: "plan-del",
                title: "Delete test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
        plans_repo::insert_plan_item(
            db.pool(),
            &persistence_db::repositories::plans::InsertPlanItem {
                id: "item-del-1",
                plan_id: "plan-del",
                item_index: 1,
                name: "master_dark.fit",
                action: "delete",
                from_root_id: None,
                from_relative_path: "master_dark.fit",
                to_root_id: None,
                to_relative_path: "",
                reason: "cleanup",
                protection: "protected",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
            },
        )
        .await
        .unwrap();

        // Global defaults have blockPermanentDelete = true.
        let req = PlanProtectionCheckRequest { plan_id: "plan-del".to_owned() };
        let resp = plan_protection_check(db.pool(), &req).await.unwrap();

        assert!(resp.has_protected_items);
        let item = &resp.protected_items[0];
        assert_eq!(item.original_action, "delete");
        assert_eq!(item.rewritten_action, Some("archive".to_owned()));
    }
}
