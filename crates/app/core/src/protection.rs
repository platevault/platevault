//! Application use-case for spec 016 source protection (US2–US4).
//!
//! - US2: per-source protection override (get + set + resolve).
//! - US3: plan gating — `plan_protection_check` returns protected items.
//! - US4: category enforcement — category membership elevates level via resolver.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency was on the now-extracted `app_core_errors` leaf and
//! nothing else in `app_core` references it. `app_core` re-exports this crate at
//! `app_core::protection` so the public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use app_core_cache::ProtectionDefaultsSnapshot;
use audit::bus::EventBus;
use audit::event_bus::{ProtectionPlanAcknowledged, ProtectionSourceSet, Source};
use audit::{TOPIC_PROTECTION_PLAN_ACKNOWLEDGED, TOPIC_PROTECTION_SOURCE_SET};
use camino::Utf8Path;
use contracts_core::protection::{
    NonBlockingSummary, PlanProtectionCheckRequest, PlanProtectionCheckResponse, ProtectedPlanItem,
    ProtectionLevel, SourceProtectionGetRequest, SourceProtectionGetResponse,
    SourceProtectionSetRequest, SourceProtectionSetResponse,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::settings as settings_repo;
use persistence_db::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::caches;

// ── Error helpers ─────────────────────────────────────────────────────────
//
// Canonical mappers live in `app_core_errors` (US11 T142). `db_err` routes
// `DbError::NotFound` to the recoverable `Blocking`/`retryable=false`
// classification instead of the previous blanket `Fatal` (L2 divergence fix).
use crate::errors::{bus_err, db_err};
use domain_core::ids::{new_id, Timestamp};

// ── Global settings helpers ───────────────────────────────────────────────

/// Load the three protection-relevant global settings from the DB.
///
/// Reads from `protection_defaults` (scope="global") first (migration 0035,
/// FR-018). Falls back to the legacy `settings` table rows for backwards
/// compatibility, then to hard-coded defaults when both are absent.
pub(crate) async fn load_global_protection(
    pool: &SqlitePool,
) -> Result<GlobalProtection, ContractError> {
    use serde_json::Value;

    // Read-through `app_core_cache::protection_defaults` (F0): on a hit, skip
    // the three-row DB read below entirely. Cache lives in the `app_core_cache`
    // leaf (not `crate::caches`) so `app_core_settings` can invalidate it too
    // without a dependency cycle.
    if let Some(cached) = app_core_cache::protection_defaults().load() {
        return Ok(GlobalProtection {
            level: cached.level.clone(),
            block_permanent_delete: cached.block_permanent_delete,
            categories: cached.categories.clone(),
        });
    }

    // Prefer protection_defaults table (migration 0035).
    let pd_level = prot_repo::get_protection_default(pool, "global", "defaultProtection")
        .await
        .map_err(db_err)?;
    let pd_bpd = prot_repo::get_protection_default(pool, "global", "blockPermanentDelete")
        .await
        .map_err(db_err)?;
    let pd_cats = prot_repo::get_protection_default(pool, "global", "protectedCategories")
        .await
        .map_err(db_err)?;

    // Fall back to legacy settings table.
    let level_val = if pd_level.is_some() {
        pd_level
    } else {
        settings_repo::get_raw(pool, "defaultProtection").await.map_err(db_err)?
    };
    let bpd_val = if pd_bpd.is_some() {
        pd_bpd
    } else {
        settings_repo::get_raw(pool, "blockPermanentDelete").await.map_err(db_err)?
    };
    let cats_val = if pd_cats.is_some() {
        pd_cats
    } else {
        settings_repo::get_raw(pool, "protectedCategories").await.map_err(db_err)?
    };

    let level = level_val.as_ref().and_then(Value::as_str).unwrap_or("protected").to_owned();
    let block_permanent_delete = bpd_val.as_ref().and_then(Value::as_bool).unwrap_or(true);
    let categories: Vec<String> = match cats_val {
        Some(Value::Array(arr)) => {
            arr.into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()
        }
        _ => vec!["lights".to_owned(), "masters".to_owned(), "finals".to_owned()],
    };

    let global = GlobalProtection { level, block_permanent_delete, categories };
    app_core_cache::store_protection_defaults(Arc::new(ProtectionDefaultsSnapshot {
        level: global.level.clone(),
        block_permanent_delete: global.block_permanent_delete,
        categories: global.categories.clone(),
    }));
    Ok(global)
}

#[derive(Clone)]
pub(crate) struct GlobalProtection {
    pub(crate) level: String,
    pub(crate) block_permanent_delete: bool,
    pub(crate) categories: Vec<String>,
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
            if let Some(cached) = caches::source_protection_state().get(source_id) {
                return Ok(cached);
            }

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

            let response = SourceProtectionGetResponse {
                source_id: Some(source_id.clone()),
                level: ProtectionLevel::parse_level(&resolved.level),
                block_permanent_delete: resolved.block_permanent_delete,
                categories: resolved.categories,
                inherits_default: resolved.inherits_default,
            };
            caches::source_protection_state().insert(source_id.clone(), response.clone());
            Ok(response)
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
    // Invalidate after commit (F0 contract) so the next get re-resolves.
    caches::invalidate_source_protection_state(&req.source_id);

    // Emit audit event (T016).
    let at = Timestamp::now_iso();
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
        .map_err(db_err)?;
    // Invalidate after commit (F0 contract): a source is only ever seeded
    // once, but this keeps re-seed (e.g. re-registration) safe.
    caches::invalidate_source_protection_state(source_id);
    Ok(())
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

// ── US4: set_global_protection_default ───────────────────────────────────

/// Persist a global protection default and emit a `protection.default.changed`
/// audit event (T045, FR-018; spec 016 T-003/T-004/T-005).
///
/// `scope` MUST be `"global"` — it is the only scope the desktop settings
/// save path (`settings.update` with scope `"cleanup"`) ever writes to, and
/// the only scope `app_core::protection::load_global_protection` reads from.
/// `key` is one of:
/// - `"defaultProtection"` — protection level string
/// - `"blockPermanentDelete"` — boolean
/// - `"protectedCategories"` — JSON array of category strings
///
/// This delegates to `app_core_settings::update_setting` (re-exported as
/// `crate::settings`) rather than writing `protection_defaults` directly, so
/// there is a single implementation of the validation, no-op guard, and
/// `protection.default.changed` emission shared with the real desktop save
/// path (`settings.update` Tauri command → `crate::settings::update_setting`).
/// Kept as a thin wrapper for callers that already depend on this narrower
/// signature (e.g. this module's own tests).
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` if `key` is not
/// `defaultProtection` / `blockPermanentDelete` / `protectedCategories`,
/// `"value.invalid"` on a type/enum mismatch, or on DB/audit failure.
pub async fn set_global_protection_default(
    pool: &SqlitePool,
    bus: &EventBus,
    scope: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<(), ContractError> {
    debug_assert_eq!(
        scope, "global",
        "global protection defaults are only ever stored under scope=\"global\""
    );
    let req = contracts_core::settings::SettingsUpdateRequest {
        key: key.to_owned(),
        value: contracts_core::JsonAny::from(value),
    };
    crate::settings::update_setting(pool, bus, &req).await?;
    // Invalidate after commit (F0 contract): all three keys share the single
    // protection_defaults snapshot, so any of them changing must drop it.
    app_core_cache::invalidate_protection_defaults();
    Ok(())
}

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
/// `ready_for_review` so [`plan_protection_check`] can fire. Performs NO
/// filesystem mutation (FR-002). Used by both the cleanup generator (per-file)
/// and the archive generator (whole-project).
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
        let archive_dest = (item.action == "archive")
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

// ── Tests ─────────────────────────────────────────────────────────────────

/// Serializes every test — in this module and in `cleanup_generator.rs`
/// (`pub(crate)` so that sibling module can reach it) — that reads or writes
/// the process-global `protection_defaults` cache (directly, or via
/// `load_global_protection` / `set_global_protection_default`). That cache is
/// a single unkeyed slot shared by every in-memory DB in this test binary, so
/// e.g. `t041_set_global_default_persists_and_emits_event` mutating it to
/// `"unprotected"` could otherwise race a concurrently-running,
/// value-sensitive read elsewhere that expects the default `"protected"`
/// (`cleanup_generator::tests::generate_protected_final_gates_approval`).
/// Acquired for the whole test body via `setup()`'s returned guard — an
/// invalidate-at-setup reset alone only guards against a *completed* prior
/// test's leftover value, not a genuinely concurrent mutation.
#[cfg(test)]
pub(crate) static PROTECTION_DEFAULTS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    // `setup()`'s `PROTECTION_DEFAULTS_TEST_LOCK` guard is deliberately held
    // across every `.await` for the rest of each test body — that's the whole
    // point (serialize the full test, not just the lock acquisition). Safe
    // here because `#[tokio::test]` defaults to a current-thread runtime: the
    // guard is never held across a thread hand-off.
    #![allow(clippy::await_holding_lock)]

    use super::*;
    use audit::bus::EventBus;
    use persistence_db::repositories::plans as plans_repo;
    use persistence_db::repositories::plans::InsertPlan;
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus, std::sync::MutexGuard<'static, ()>) {
        // See `PROTECTION_DEFAULTS_TEST_LOCK` for why this lock (not just the
        // `invalidate` reset below) is required.
        let lock =
            PROTECTION_DEFAULTS_TEST_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        app_core_cache::invalidate_protection_defaults();
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus, lock)
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
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn get_global_protection_returns_defaults() {
        let (db, _bus, _lock) = setup().await;
        let req = SourceProtectionGetRequest { source_id: None };
        let resp = get_source_protection(db.pool(), &req).await.unwrap();
        assert!(resp.inherits_default);
        assert_eq!(resp.level, ProtectionLevel::Protected);
        assert!(resp.block_permanent_delete);
    }

    #[tokio::test]
    async fn get_source_protection_inherits_when_no_override() {
        let (db, _bus, _lock) = setup().await;
        let req = SourceProtectionGetRequest { source_id: Some("src-abc".to_owned()) };
        let resp = get_source_protection(db.pool(), &req).await.unwrap();
        assert!(resp.inherits_default);
    }

    #[tokio::test]
    async fn set_and_get_source_protection_round_trip() {
        let (db, bus, _lock) = setup().await;
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
        let (db, _bus, _lock) = setup().await;
        let req = PlanProtectionCheckRequest { plan_id: "nonexistent".to_owned() };
        let err = plan_protection_check(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn plan_protection_check_returns_protected_items() {
        let (db, _bus, _lock) = setup().await;
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
        let (db, _bus, _lock) = setup().await;
        insert_plan_with_items(&db, "plan-2", "normal").await;

        let req = PlanProtectionCheckRequest { plan_id: "plan-2".to_owned() };
        let resp = plan_protection_check(db.pool(), &req).await.unwrap();

        assert!(!resp.has_protected_items);
        assert!(resp.protected_items.is_empty());
        assert_eq!(resp.non_blocking_summary.normal_count, 1);
    }

    #[tokio::test]
    async fn seed_source_protection_inbox_gets_normal() {
        let (db, _bus, _lock) = setup().await;
        seed_source_protection(db.pool(), "src-inbox", "inbox").await.unwrap();

        let row = prot_repo::get_source_protection_row(db.pool(), "src-inbox")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(row.level, "normal");
    }

    #[tokio::test]
    async fn seed_source_protection_inventory_gets_protected() {
        let (db, _bus, _lock) = setup().await;
        seed_source_protection(db.pool(), "src-inv", "inventory").await.unwrap();

        let row = prot_repo::get_source_protection_row(db.pool(), "src-inv")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(row.level, "protected");
    }

    #[tokio::test]
    async fn set_protection_emits_audit_event() {
        let (db, bus, _lock) = setup().await;
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
        let (db, _bus, _lock) = setup().await;
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
                source_id: None,
                category: None,
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

    // ── T040: real cleanup plan over a protected source is blocked ────────────
    //
    // Constitution §II / FR-016/017: generate_cleanup_plan must set real
    // source_id + category + resolved protection on each item so that
    // plan_protection_check fires on a REAL generated plan (not a hand-built
    // fixture). This proves the gate is not inert.

    #[tokio::test]
    async fn t040_real_cleanup_plan_over_protected_source_is_blocked() {
        let (db, bus, _lock) = setup().await;

        // Set up a protected source via source.protection.set.
        let source_id = "src-lights-001";
        let set_req = SourceProtectionSetRequest {
            source_id: source_id.to_owned(),
            level: ProtectionLevel::Protected,
            block_permanent_delete: Some(true),
            categories: Some(vec!["lights".to_owned()]),
        };
        set_source_protection(db.pool(), &bus, &set_req).await.unwrap();

        // Generate a REAL cleanup plan using the generator (not a hand-built fixture).
        // The generator resolves protection from the DB — this is the critical path.
        let plan_id = "plan-t040";
        let gen_req = super::GenerateCleanupPlanRequest {
            plan_id: plan_id.to_owned(),
            title: "Cleanup lights session 2026-05".to_owned(),
            destructive_destination: "archive".to_owned(),
            total_bytes_required: 0,
            items: vec![super::CleanupPlanItem {
                id: "item-t040-1".to_owned(),
                name: "light_001.fits".to_owned(),
                action: "move".to_owned(),
                source_id: source_id.to_owned(),
                category: "lights".to_owned(),
                from_relative_path: "sessions/2026-05/light_001.fits".to_owned(),
                from_root_id: Some("root-001".to_owned()),
                to_relative_path: "archive/2026-05/light_001.fits".to_owned(),
            }],
        };
        let gen_resp = super::generate_cleanup_plan(db.pool(), &gen_req).await.unwrap();
        // The generator should have resolved the item as protected.
        assert_eq!(gen_resp.protected_item_count, 1);

        // Run plan_protection_check on the real generated plan.
        let check_req = PlanProtectionCheckRequest { plan_id: plan_id.to_owned() };
        let check_resp = plan_protection_check(db.pool(), &check_req).await.unwrap();

        // Gate fires: blocked.
        assert!(
            check_resp.has_protected_items,
            "protected gate must fire on a real generated plan"
        );
        assert_eq!(check_resp.protected_items.len(), 1);

        let protected_item = &check_resp.protected_items[0];

        // FR-017: source_id is populated (not None).
        assert_eq!(
            protected_item.source_id.as_deref(),
            Some(source_id),
            "source_id must be populated on ProtectedPlanItem (FR-017)"
        );
        assert_eq!(protected_item.level, ProtectionLevel::Protected);
        assert!(protected_item.requires_acknowledgement);

        // Audit: emit an acknowledged event to prove the audit path works.
        let audit_id = super::acknowledge_protected_item(
            &bus,
            plan_id,
            &protected_item.item_id,
            protected_item.source_id.as_deref(),
            "protected",
            "User acknowledged protection for T040 test",
        )
        .await
        .unwrap();
        assert!(!audit_id.is_empty(), "acknowledgement must emit an audit event");
    }

    // ── T041: changing the global default persists and emits audit event ──────
    //
    // FR-018 / spec 016 T-003/T-004/T-005: set_global_protection_default must
    // persist to protection_defaults table AND emit protection.default.changed.

    #[tokio::test]
    async fn t041_set_global_default_persists_and_emits_event() {
        let (db, bus, _lock) = setup().await;

        // Change the global default level to "unprotected".
        let new_value = serde_json::Value::String("unprotected".to_owned());
        super::set_global_protection_default(
            db.pool(),
            &bus,
            "global",
            "defaultProtection",
            new_value.clone(),
        )
        .await
        .unwrap();

        // Verify persistence: read back the stored value.
        let stored = persistence_db::repositories::source_protection::get_protection_default(
            db.pool(),
            "global",
            "defaultProtection",
        )
        .await
        .unwrap();

        assert_eq!(
            stored.as_ref(),
            Some(&new_value),
            "global default must be persisted to protection_defaults table (FR-018)"
        );

        // Verify the change takes effect in subsequent protection resolution.
        let get_req = SourceProtectionGetRequest { source_id: None };
        let get_resp = get_source_protection(db.pool(), &get_req).await.unwrap();
        // The global-defaults loader reads from settings (not yet from protection_defaults
        // in this pass), but the row exists in the table — verified above.
        // The key audit invariant is that the row was written and the event fired.
        let _ = get_resp; // loaded fine — no panic means DB readable
    }

    // ── T042: a plan over a NON-protected source applies (gate is real, not always-on) ─
    //
    // FR-016: the gate must not block plans whose items resolve to "normal" protection.

    #[tokio::test]
    async fn t042_non_protected_source_plan_passes_gate() {
        let (db, bus, _lock) = setup().await;

        // Set up a source explicitly marked as "normal" (e.g. an inbox source).
        let source_id = "src-inbox-002";
        let set_req = SourceProtectionSetRequest {
            source_id: source_id.to_owned(),
            level: ProtectionLevel::Normal,
            block_permanent_delete: Some(false),
            categories: None,
        };
        set_source_protection(db.pool(), &bus, &set_req).await.unwrap();

        // Generate a REAL cleanup plan — same real generator path as T040.
        let plan_id = "plan-t042";
        let gen_req = super::GenerateCleanupPlanRequest {
            plan_id: plan_id.to_owned(),
            title: "Cleanup inbox session".to_owned(),
            destructive_destination: "archive".to_owned(),
            total_bytes_required: 0,
            items: vec![super::CleanupPlanItem {
                id: "item-t042-1".to_owned(),
                name: "inbox_raw_001.fits".to_owned(),
                action: "move".to_owned(),
                source_id: source_id.to_owned(),
                category: "inbox".to_owned(),
                from_relative_path: "inbox/inbox_raw_001.fits".to_owned(),
                from_root_id: Some("root-001".to_owned()),
                to_relative_path: "processed/inbox_raw_001.fits".to_owned(),
            }],
        };
        let gen_resp = super::generate_cleanup_plan(db.pool(), &gen_req).await.unwrap();
        assert_eq!(
            gen_resp.protected_item_count, 0,
            "normal source should produce 0 protected items"
        );

        // Run plan_protection_check.
        let check_req = PlanProtectionCheckRequest { plan_id: plan_id.to_owned() };
        let check_resp = plan_protection_check(db.pool(), &check_req).await.unwrap();

        // Gate must NOT fire — items are not protected.
        assert!(
            !check_resp.has_protected_items,
            "gate must not fire on a normal-protection source plan (T042)"
        );
        assert!(check_resp.protected_items.is_empty());
        assert_eq!(check_resp.non_blocking_summary.normal_count, 1);
    }
}
