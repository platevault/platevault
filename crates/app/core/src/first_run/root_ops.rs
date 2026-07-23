// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Root active toggle + delete (P6b).

use audit::bus::EventBus;
use audit::event_bus::{RootActiveChanged, RootDeleted, Source};
use audit::event_bus::{TOPIC_ROOT_ACTIVE_CHANGED, TOPIC_ROOT_DELETED};
use audit::{AuditLogEntry, Outcome, Severity};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

use crate::audit_ids::deterministic_entity_id;
use crate::caches;
use crate::errors::bus_err;

use super::{db_to_contract, error_code_str, get_root_or_not_found, write_root_op_refusal};

/// Set a root's active/enabled flag (`sources.set_active`, P6b).
///
/// Disabled roots are excluded from scan/ingest surfaces but retain their
/// full history (sessions, plan items, file records, inbox items) — this is
/// a visibility flag, not a deletion (constitution §I). Publishes a
/// best-effort `root.active_changed` audit event.
///
/// # Errors
///
/// - `source.not_found` — no root with `root_id`.
/// - `internal.database` — persistence failure.
pub async fn set_source_active(
    pool: &SqlitePool,
    bus: &EventBus,
    root_id: &str,
    active: bool,
) -> Result<(), ContractError> {
    let (_, path) = match get_root_or_not_found(pool, root_id).await {
        Ok(v) => v,
        Err(e) => {
            write_root_op_refusal(
                bus,
                root_id,
                "root.active_changed",
                Outcome::Failed,
                &error_code_str(e.code),
            )
            .await?;
            return Err(e);
        }
    };

    if let Err(e) = repo::set_source_active(pool, root_id, active).await {
        // FIX (review round 1 #2): the write was attempted (root exists) and
        // failed — audit as `Failed`.
        let err = db_to_contract(e);
        write_root_op_refusal(
            bus,
            root_id,
            "root.active_changed",
            Outcome::Failed,
            &error_code_str(err.code),
        )
        .await?;
        return Err(err);
    }

    // Write durable audit row + live event (T125, FR-130/FR-131).
    let entry = AuditLogEntry::new(
        EntityType::LibraryRoot,
        deterministic_entity_id("root", root_id),
        "root.active_changed",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({"path": path, "active": active}));
    bus.write_audit(
        entry,
        TOPIC_ROOT_ACTIVE_CHANGED,
        Source::User,
        RootActiveChanged { root_id: root_id.to_owned(), path, active },
    )
    .await
    .map_err(bus_err)?;

    Ok(())
}

/// Delete a root's registration (`roots.delete`, P6b, decision D8).
///
/// Blocks with `root.has_dependents` when any dependent records reference
/// this root (inbox items, plan items, file records, acquisition/calibration
/// sessions) — deliberately NO cascade-nullify (constitution §II: no silent
/// orphaning). Files on disk are NEVER touched (constitution §I): only the
/// `registered_sources` row (and any already-orphaned `inbox_items` for it —
/// none should remain once the dependents check passes) is removed.
///
/// Publishes a best-effort `root.deleted` audit event on success.
///
/// # Errors
///
/// - `source.not_found` — no root with `root_id`.
/// - `root.has_dependents` — dependent records exist; see `details` for the
///   per-category breakdown (`RootDependencyCounts`).
/// - `internal.database` — persistence failure.
pub async fn delete_source(
    pool: &SqlitePool,
    bus: &EventBus,
    root_id: &str,
) -> Result<(), ContractError> {
    let (kind, path) = match get_root_or_not_found(pool, root_id).await {
        Ok(v) => v,
        Err(e) => {
            write_root_op_refusal(
                bus,
                root_id,
                "root.deleted",
                Outcome::Failed,
                &error_code_str(e.code),
            )
            .await?;
            return Err(e);
        }
    };

    let counts = match repo::count_root_dependents(pool, root_id).await {
        Ok(v) => v,
        Err(e) => {
            // FIX (review round 1 #2): the dependents check was attempted
            // (root exists) and failed — audit as `Failed`.
            let err = db_to_contract(e);
            write_root_op_refusal(
                bus,
                root_id,
                "root.deleted",
                Outcome::Failed,
                &error_code_str(err.code),
            )
            .await?;
            return Err(err);
        }
    };
    if !counts.is_empty() {
        write_root_op_refusal(
            bus,
            root_id,
            "root.deleted",
            Outcome::Refused,
            "root.has_dependents",
        )
        .await?;
        let details = serde_json::to_value(counts).unwrap_or_default();
        return Err(ContractError::new(
            ErrorCode::RootHasDependents,
            format!("root {root_id} has dependent records and cannot be deleted"),
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(details));
    }

    if let Err(e) = repo::remove_source(pool, root_id).await {
        // FIX (review round 1 #2): the delete was attempted (root exists, no
        // dependents) and failed — audit as `Failed`.
        let err = db_to_contract(e);
        write_root_op_refusal(
            bus,
            root_id,
            "root.deleted",
            Outcome::Failed,
            &error_code_str(err.code),
        )
        .await?;
        return Err(err);
    }
    // Invalidate after commit: the root row (and its path) no longer exists,
    // so a still-cached path would otherwise resurface for a deleted root.
    caches::invalidate_library_root(root_id);

    // Write durable audit row + live event (T125, FR-130/FR-131).
    let kind_str: &'static str = kind.into();
    let entry = AuditLogEntry::new(
        EntityType::LibraryRoot,
        deterministic_entity_id("root", root_id),
        "root.deleted",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({"path": path, "kind": kind_str}));
    bus.write_audit(
        entry,
        TOPIC_ROOT_DELETED,
        Source::User,
        RootDeleted { root_id: root_id.to_owned(), path, kind: kind_str.to_owned() },
    )
    .await
    .map_err(bus_err)?;

    Ok(())
}
