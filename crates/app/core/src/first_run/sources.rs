// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Register/list/remove a source, and the batch registration pipeline.

use audit::bus::EventBus;
use contracts_core::first_run::{
    OrganizationState, RegisterSourceBatchRequest, RegisterSourceBatchResponse,
    RegisterSourceRequest, RegisterSourceResponse, SetSourceOrganizationStateRequest,
    SetSourceOrganizationStateResponse, SourceKind, ERR_SOURCE_INVALID_ORGANIZATION_STATE,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity, JsonAny};
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

use audit::Outcome;

use crate::caches;

use super::{
    check_duplicate, check_overlap, db_to_contract, error_code_str, validate_path,
    write_source_register_audit,
};

/// Register a single source directory with path validation.
///
/// # Errors
///
/// Returns `ContractError` with dotted error codes for path validation,
/// duplicate detection, or database failures.
pub async fn register_source(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &RegisterSourceRequest,
) -> Result<RegisterSourceResponse, ContractError> {
    if let Err(e) = validate_path(&req.path) {
        write_source_register_audit(
            bus,
            &req.path,
            &req.path,
            req.kind,
            Outcome::Refused,
            Some(&error_code_str(e.code)),
        )
        .await?;
        return Err(*e);
    }
    if let Err(e) = check_duplicate(pool, &req.path, req.kind).await {
        write_source_register_audit(
            bus,
            &req.path,
            &req.path,
            req.kind,
            Outcome::Refused,
            Some(&error_code_str(e.code)),
        )
        .await?;
        return Err(e);
    }
    if let Err(e) = check_overlap(pool, &req.path, &[]).await {
        write_source_register_audit(
            bus,
            &req.path,
            &req.path,
            req.kind,
            Outcome::Refused,
            Some(&error_code_str(e.code)),
        )
        .await?;
        return Err(e);
    }
    let resp = match repo::register_source(pool, req).await {
        Ok(resp) => resp,
        Err(e) => {
            // FIX (review round 1 #2): the DB write was attempted (validation
            // + duplicate check already passed) and failed — audit as
            // `Failed`, not silently propagated.
            let err = db_to_contract(e);
            write_source_register_audit(
                bus,
                &req.path,
                &req.path,
                req.kind,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
            )
            .await?;
            return Err(err);
        }
    };
    // Invalidate after commit (F0 contract): a freshly registered id can't
    // already be cached, but this keeps the write site authoritative if a
    // removed root's id is ever reused.
    caches::invalidate_library_root(&resp.source_id);
    seed_new_source_protection(pool, &resp.source_id, req.kind).await;
    write_source_register_audit(bus, &resp.source_id, &req.path, req.kind, Outcome::Applied, None)
        .await?;
    Ok(resp)
}

/// Seed a freshly registered source's protection level (issue #730 — the real
/// `register_source`/`register_source_batch` entry points never called
/// `protection::seed_source_protection`, so new Inbox sources fell through to
/// the flat global default (`protected`) instead of `data-model.md`'s
/// Defaults Table). Best-effort: a seeding failure must not fail the
/// registration itself, which already committed.
async fn seed_new_source_protection(pool: &SqlitePool, source_id: &str, kind: SourceKind) {
    let kind_str: &'static str = kind.into();
    if let Err(e) = crate::protection::seed_source_protection(pool, source_id, kind_str).await {
        tracing::warn!(%source_id, kind = kind_str, error = ?e, "failed to seed source protection");
    }
}

/// Change a source's organization state after registration (spec 041, T030).
///
/// Affects only future confirms — it does not move or re-plan already-planned
/// files. `inbox`-kind sources may not be set to `organized`; doing so returns
/// [`ERR_SOURCE_INVALID_ORGANIZATION_STATE`] with [`ErrorSeverity::Blocking`].
///
/// # Errors
///
/// - `source.invalid_organization_state` — inbox source set to organized.
/// - `source.not_found` — no source with the given id.
/// - `internal.database` — database failure.
pub async fn set_source_organization_state(
    pool: &SqlitePool,
    req: &SetSourceOrganizationStateRequest,
) -> Result<SetSourceOrganizationStateResponse, ContractError> {
    repo::set_source_organization_state(pool, &req.source_id, req.organization_state)
        .await
        .map_err(|e| match e {
            persistence_db::DbError::NotFound(msg) => {
                ContractError::new(ErrorCode::SourceNotFound, msg, ErrorSeverity::Blocking, false)
            }
            persistence_db::DbError::CasFailed(msg)
                if msg.contains(ERR_SOURCE_INVALID_ORGANIZATION_STATE) =>
            {
                ContractError::new(
                    ErrorCode::SourceInvalidOrganizationState,
                    "inbox sources must remain unorganized",
                    ErrorSeverity::Blocking,
                    false,
                )
            }
            other => db_to_contract(other),
        })?;

    Ok(SetSourceOrganizationStateResponse {
        source_id: req.source_id.clone(),
        organization_state: req.organization_state,
    })
}

/// Read a source's organization state by source/root id (spec 041).
///
/// Returns `Unorganized` as the conservative default when the source row is
/// absent — an absent source means we never catalogue in place by accident.
///
/// # Errors
///
/// Returns `internal.database` on query failure.
pub async fn get_source_organization_state(
    pool: &SqlitePool,
    source_id: &str,
) -> Result<OrganizationState, ContractError> {
    let state = repo::get_source_organization_state(pool, source_id)
        .await
        .map_err(db_to_contract)?
        .unwrap_or(OrganizationState::Unorganized);
    Ok(state)
}

/// Validate every batch item, splitting into immediate `Failure` `BatchItem`s
/// (audited `Refused`) and the still-pending `(original_index, source)`
/// pairs the repository batch call will attempt. Extracted from
/// `register_source_batch` to keep it under clippy's line budget.
async fn partition_batch_sources<'a>(
    pool: &SqlitePool,
    bus: &EventBus,
    sources: &'a [RegisterSourceRequest],
) -> Result<
    (Vec<contracts_core::first_run::BatchItem>, Vec<(usize, &'a RegisterSourceRequest)>),
    ContractError,
> {
    use contracts_core::first_run::{BatchItem, ItemStatus};

    let mut items: Vec<BatchItem> = Vec::with_capacity(sources.len());
    let mut valid_sources: Vec<(usize, &RegisterSourceRequest)> = Vec::new();
    // Paths already accepted earlier in this same batch (not yet persisted),
    // so overlap is caught candidate-vs-candidate too, not only against
    // already-persisted roots (issue #501).
    let mut accepted_paths: Vec<String> = Vec::new();

    for (index, source) in sources.iter().enumerate() {
        // Short-circuit: only check for a duplicate/overlap once the path
        // itself is valid, and only check overlap once it's not a duplicate.
        let validation_err = match validate_path(&source.path) {
            Err(e) => Some(*e),
            Ok(()) => match check_duplicate(pool, &source.path, source.kind).await {
                Err(e) => Some(e),
                Ok(()) => check_overlap(pool, &source.path, &accepted_paths).await.err(),
            },
        };
        let Some(e) = validation_err else {
            accepted_paths.push(source.path.clone());
            valid_sources.push((index, source));
            continue;
        };
        let code_str = error_code_str(e.code);
        write_source_register_audit(
            bus,
            &source.path,
            &source.path,
            source.kind,
            Outcome::Refused,
            Some(&code_str),
        )
        .await?;
        items.push(BatchItem {
            index,
            status: ItemStatus::Failure,
            source_id: None,
            error: Some(code_str),
            error_detail: Some(JsonAny::new(serde_json::json!({ "message": e.message }))),
        });
    }

    Ok((items, valid_sources))
}

/// Audit + map the repository batch call's per-item results back to
/// `BatchItem`s. Extracted from `register_source_batch` to keep it under
/// clippy's line budget; audits `Failure` items too (review round 1 #3 —
/// these were previously dropped without a durable row).
async fn audit_batch_results(
    pool: &SqlitePool,
    bus: &EventBus,
    valid_sources: &[(usize, &RegisterSourceRequest)],
    repo_items: Vec<contracts_core::first_run::BatchItem>,
) -> Result<Vec<contracts_core::first_run::BatchItem>, ContractError> {
    use contracts_core::first_run::{BatchItem, ItemStatus};

    let mut items = Vec::with_capacity(repo_items.len());
    for (batch_idx, repo_item) in repo_items.into_iter().enumerate() {
        let (original_index, source) = valid_sources[batch_idx];
        match repo_item.status {
            ItemStatus::Success => {
                if let Some(source_id) = &repo_item.source_id {
                    seed_new_source_protection(pool, source_id, source.kind).await;
                    write_source_register_audit(
                        bus,
                        source_id,
                        &source.path,
                        source.kind,
                        Outcome::Applied,
                        None,
                    )
                    .await?;
                }
            }
            ItemStatus::Failure => {
                write_source_register_audit(
                    bus,
                    &source.path,
                    &source.path,
                    source.kind,
                    Outcome::Failed,
                    repo_item.error.as_deref(),
                )
                .await?;
            }
        }
        items.push(BatchItem {
            index: original_index,
            status: repo_item.status,
            source_id: repo_item.source_id,
            error: repo_item.error,
            error_detail: repo_item.error_detail,
        });
    }
    Ok(items)
}

/// Register multiple sources with per-item path validation.
///
/// Items that fail validation are marked as failures in the batch response
/// without preventing other items from succeeding.
///
/// # Errors
///
/// Returns `ContractError` only for catastrophic failures (connection loss).
pub async fn register_source_batch(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &RegisterSourceBatchRequest,
) -> Result<RegisterSourceBatchResponse, ContractError> {
    use contracts_core::first_run::{BatchStatus, ItemStatus};

    // Pre-validate all paths and build a filtered request for the repository.
    // Items that fail validation are recorded as failures immediately.
    let (mut items, valid_sources) = partition_batch_sources(pool, bus, &req.sources).await?;

    // Register validated sources via the repository batch.
    if !valid_sources.is_empty() {
        let batch_req = RegisterSourceBatchRequest {
            sources: valid_sources.iter().map(|(_, s)| (*s).clone()).collect(),
        };
        let batch_resp = match repo::register_source_batch(pool, &batch_req).await {
            Ok(resp) => resp,
            Err(e) => {
                // FIX (review round 1 #2): a catastrophic whole-batch failure
                // (connection loss) — every still-pending item was an
                // attempted registration; audit each as `Failed`.
                let err = db_to_contract(e);
                let reason = error_code_str(err.code);
                for (_, source) in &valid_sources {
                    write_source_register_audit(
                        bus,
                        &source.path,
                        &source.path,
                        source.kind,
                        Outcome::Failed,
                        Some(&reason),
                    )
                    .await?;
                }
                return Err(err);
            }
        };
        items.extend(audit_batch_results(pool, bus, &valid_sources, batch_resp.items).await?);
    }

    // Sort items by original index for deterministic output.
    items.sort_by_key(|item| item.index);

    // Invalidate after commit (F0 contract) for every newly registered root.
    for item in items.iter().filter(|i| i.status == ItemStatus::Success) {
        if let Some(source_id) = &item.source_id {
            caches::invalidate_library_root(source_id);
        }
    }

    let success_count = items.iter().filter(|i| i.status == ItemStatus::Success).count();
    let failure_count = items.iter().filter(|i| i.status == ItemStatus::Failure).count();

    let status = if failure_count == 0 {
        BatchStatus::Success
    } else if success_count == 0 {
        BatchStatus::Failure
    } else {
        BatchStatus::Partial
    };

    Ok(RegisterSourceBatchResponse { status, items })
}

/// List all registered sources.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_sources(pool: &SqlitePool) -> Result<Vec<RegisterSourceResponse>, ContractError> {
    repo::list_sources(pool).await.map_err(db_to_contract)
}

/// Remove a registered source by ID.
///
/// # Errors
///
/// Returns `ContractError` if the source is not found.
pub async fn remove_source(pool: &SqlitePool, id: &str) -> Result<(), ContractError> {
    repo::remove_source(pool, id).await.map_err(db_to_contract)
}
