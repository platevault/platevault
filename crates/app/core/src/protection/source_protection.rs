// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! US2: `source.protection.get` / `.set`, and seed-on-source-add.

use audit::bus::EventBus;
use audit::event_bus::{ProtectionSourceSet, Source};
use audit::{AuditLogEntry, Outcome, Severity, TOPIC_PROTECTION_SOURCE_SET};
use contracts_core::protection::{
    ProtectionLevel, SourceProtectionGetRequest, SourceProtectionGetResponse,
    SourceProtectionSetRequest, SourceProtectionSetResponse,
};
use contracts_core::ContractError;
use domain_core::ids::{EntityId, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;
use persistence_plans::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;

use crate::audit_ids::deterministic_entity_id;
use crate::caches;
use crate::errors::{bus_err, db_err};

use super::load_global_protection;

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
    // Capture the defaults epoch BEFORE loading the globals a resolved
    // response will embed: if a defaults change lands mid-resolve, the entry
    // is tagged with the pre-change epoch and the next get re-resolves
    // instead of serving the stale mix (issue #563).
    let defaults_epoch = app_core_cache::protection_defaults_epoch();
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
            // An epoch mismatch means the global defaults changed since this
            // entry was resolved — treat it as a miss (see `caches.rs` for
            // why the entry embeds default-derived values).
            if let Some((epoch, cached)) = caches::source_protection_state().get(source_id) {
                if epoch == defaults_epoch {
                    return Ok(cached);
                }
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
            caches::source_protection_state()
                .insert(source_id.clone(), (defaults_epoch, response.clone()));
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
        .map_or(ProtectionLevel::Unprotected, |r| ProtectionLevel::parse_level(&r.level));

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

    // Write durable audit row + live event (T016, T123: FR-130/FR-131).
    let at = Timestamp::now_iso();
    let entry = AuditLogEntry::new(
        EntityType::Protection,
        deterministic_entity_id("protection.source", &req.source_id),
        "protection.source.set",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({
        "sourceId": req.source_id,
        "before": {"level": prior_level.as_str(), "blockPermanentDelete": prior_bpd, "categories": prior_cats},
        "after": {"level": level_str, "blockPermanentDelete": req.block_permanent_delete, "categories": req.categories},
    }));
    let audit_id = bus
        .write_audit(
            entry,
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
        .map_err(bus_err)?
        .as_uuid()
        .to_string();

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
/// Inbox sources start at `unprotected`; all others start at `protected`.
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
    let level = if source_kind == "inbox" { "unprotected" } else { "protected" };
    prot_repo::upsert_source_protection(pool, source_id, level, None, None, "system")
        .await
        .map_err(db_err)?;
    // Invalidate after commit (F0 contract): a source is only ever seeded
    // once, but this keeps re-seed (e.g. re-registration) safe.
    caches::invalidate_source_protection_state(source_id);
    Ok(())
}
