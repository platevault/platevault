// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! First-run source registration and wizard use cases (spec 003).
//!
//! Thin orchestration layer adding path validation, error mapping to
//! contract error codes, and audit event emission on top of the
//! persistence repository.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b) as a pure
//! leaf: it has zero `crate::` references and nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::first_run` so the
//! public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use audit::bus::EventBus;
use audit::event_bus::{
    FirstRunCompleted, RootActiveChanged, RootDeleted, RootRemapped, Source, SourceCountByKind,
    TOPIC_FIRST_RUN_COMPLETED, TOPIC_ROOT_ACTIVE_CHANGED, TOPIC_ROOT_DELETED, TOPIC_ROOT_REMAPPED,
};
use audit::{AuditLogEntry, Outcome, Severity};
use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartResponse, FirstRunStateResponse, OrganizationState,
    RegisterSourceBatchRequest, RegisterSourceBatchResponse, RegisterSourceRequest,
    RegisterSourceResponse, SetSourceOrganizationStateRequest, SetSourceOrganizationStateResponse,
    SourceKind, ERR_SOURCE_INVALID_ORGANIZATION_STATE,
};
use contracts_core::roots::{RemapSample, RemapVerification};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity, JsonAny};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

use crate::audit_ids::deterministic_entity_id;
use crate::caches;
use crate::errors::bus_err;

// ── Path validation ─────────────────────────────────────────────────────────

/// Validate that the given path exists, is a directory, and is readable.
///
/// Returns a `ContractError` with a dotted error code on failure.
fn validate_path(path: &str) -> Result<(), Box<ContractError>> {
    let metadata = std::fs::metadata(path).map_err(|e| {
        Box::new(if e.kind() == std::io::ErrorKind::NotFound {
            ContractError::new(
                ErrorCode::PathNotExists,
                format!("Path does not exist: {path}"),
                ErrorSeverity::Blocking,
                false,
            )
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            ContractError::new(
                ErrorCode::PathPermissionDenied,
                format!("Permission denied: {path}"),
                ErrorSeverity::Blocking,
                false,
            )
        } else {
            ContractError::new(
                ErrorCode::PathNotExists,
                format!("Cannot access path: {path}: {e}"),
                ErrorSeverity::Blocking,
                false,
            )
        })
    })?;

    if !metadata.is_dir() {
        return Err(Box::new(ContractError::new(
            ErrorCode::PathNotDirectory,
            format!("Path is not a directory: {path}"),
            ErrorSeverity::Blocking,
            false,
        )));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        if mode & 0o444 == 0 {
            return Err(Box::new(ContractError::new(
                ErrorCode::PathPermissionDenied,
                format!("No read permission on: {path}"),
                ErrorSeverity::Blocking,
                false,
            )));
        }
    }

    Ok(())
}

/// Check whether a path is already registered, and if so, whether it's
/// under a different kind.
async fn check_duplicate(
    pool: &SqlitePool,
    path: &str,
    kind: SourceKind,
) -> Result<(), ContractError> {
    let matches = repo::find_sources_by_path(pool, path).await.map_err(db_to_contract)?;

    if let Some(source) = matches.first() {
        if source.kind == kind {
            // Issue #501: registering the exact same path a second time cannot
            // proceed — this must hard-stop like `path.not_exists` /
            // `path.not_directory`, not be a bypassable `Warning`.
            return Err(ContractError::new(
                ErrorCode::PathAlreadyRegistered,
                format!("Path is already registered as {kind:?}: {path}"),
                ErrorSeverity::Blocking,
                false,
            ));
        }
        return Err(ContractError::new(
            ErrorCode::PathAlreadyRegisteredDifferentKind,
            format!(
                "Path is already registered as {:?} (requested {:?}): {path}",
                source.kind, kind
            ),
            ErrorSeverity::Warning,
            false,
        ));
    }

    Ok(())
}

/// Path-overlap relationship between `candidate` and `other`, or `None` if
/// they don't overlap. Case-folds both sides on Windows (nJ01a review carry-
/// over): NTFS/ReFS/FAT are case-insensitive/case-preserving, so `C:\Foo` and
/// `c:\foo` name the same root and a lexical `starts_with` alone would miss
/// the overlap. Unix filesystems default to case-sensitive, so the exact
/// bytes are compared there — folding unconditionally would falsely reject
/// distinct same-name-different-case Linux/macOS(HFS+ case-sensitive) roots,
/// which is not the failure mode we're guarding against.
fn path_overlap_relationship(
    candidate: &std::path::Path,
    other: &std::path::Path,
) -> Option<&'static str> {
    #[cfg(windows)]
    let (candidate, other): (std::path::PathBuf, std::path::PathBuf) = (
        candidate.to_string_lossy().to_lowercase().into(),
        other.to_string_lossy().to_lowercase().into(),
    );
    #[cfg(windows)]
    let (candidate, other) = (candidate.as_path(), other.as_path());

    if other.starts_with(candidate) {
        Some("parent")
    } else if candidate.starts_with(other) {
        Some("child")
    } else {
        None
    }
}

/// Check whether a candidate root path overlaps (is a parent of, or is nested
/// within) any already-registered root, or any path already accepted earlier
/// in the same batch request (`extra_paths`, still unpersisted). Cross-cutting
/// across categories: an inbox root inside a light-frames root is still an
/// overlap (issue #501, rules 3/4). Exact-path equality is left to
/// [`check_duplicate`], which already covers it with a more specific error.
async fn check_overlap(
    pool: &SqlitePool,
    path: &str,
    extra_paths: &[String],
) -> Result<(), ContractError> {
    let candidate = std::path::Path::new(path);
    let existing = repo::list_sources(pool).await.map_err(db_to_contract)?;

    for other in
        existing.iter().map(|s| s.path.as_str()).chain(extra_paths.iter().map(String::as_str))
    {
        if other == path {
            continue;
        }
        let other_path = std::path::Path::new(other);
        let Some(relationship) = path_overlap_relationship(candidate, other_path) else {
            continue;
        };
        return Err(ContractError::new(
            ErrorCode::PathOverlapsExisting,
            format!("Path overlaps an already-registered root ({relationship}): {other}"),
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(
            serde_json::json!({"conflictingPath": other, "relationship": relationship}),
        ));
    }

    Ok(())
}

fn db_to_contract(e: persistence_db::DbError) -> ContractError {
    let msg = e.to_string();
    if msg.contains("UNIQUE constraint failed") {
        // Same code as `check_duplicate`'s same-kind branch above — keep
        // severity consistent (issue #501).
        ContractError::new(ErrorCode::PathAlreadyRegistered, msg, ErrorSeverity::Blocking, false)
    } else {
        // Delegate the non-UNIQUE fallback to the canonical mapper (T1-c) so
        // `NotFound` is classified `Blocking`/non-retryable instead of the
        // hand-rolled `Fatal`/`retryable=true` this used to apply to every
        // variant, including missing rows.
        crate::errors::db_err(e)
    }
}

/// Render an `ErrorCode` as its dotted wire string (e.g. `"path.not_exists"`),
/// for use as an audit `reason_code`.
fn error_code_str(code: ErrorCode) -> String {
    serde_json::to_string(&code)
        .map_or_else(|_| "internal.error".to_owned(), |s| s.trim_matches('"').to_owned())
}

/// Write a durable audit row for a `source.register` attempt (T125,
/// FR-130/FR-131). `entity_seed` is the created `source_id` on success, or
/// the attempted `path` on refusal (no source id exists yet, so repeated
/// refused attempts against the same path still correlate under one
/// `entity_id`).
async fn write_source_register_audit(
    bus: &EventBus,
    entity_seed: &str,
    path: &str,
    kind: SourceKind,
    outcome: Outcome,
    reason_code: Option<&str>,
) -> Result<(), ContractError> {
    let kind_str: &'static str = kind.into();
    let mut entry = AuditLogEntry::new(
        EntityType::DataSource,
        deterministic_entity_id("source", entity_seed),
        "source.register",
        "user",
        outcome,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(serde_json::json!({"path": path, "kind": kind_str}));
    if let Some(code) = reason_code {
        entry = entry.with_reason_code(code.to_owned());
    }
    bus.write_audit(
        entry,
        "source.registered",
        Source::User,
        serde_json::json!({"path": path, "kind": kind_str, "outcome": outcome.as_str()}),
    )
    .await
    .map_err(bus_err)?;
    Ok(())
}

// ── Use cases ───────────────────────────────────────────────────────────────

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
    write_source_register_audit(bus, &resp.source_id, &req.path, req.kind, Outcome::Applied, None)
        .await?;
    Ok(resp)
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
        items.extend(audit_batch_results(bus, &valid_sources, batch_resp.items).await?);
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

/// Get the current first-run wizard state.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn get_first_run_state(
    pool: &SqlitePool,
) -> Result<FirstRunStateResponse, ContractError> {
    repo::get_first_run_state(pool).await.map_err(db_to_contract)
}

/// Mark the first-run wizard as complete, publishing an audit event.
///
/// Checks that at least one raw and one project source exist before
/// allowing completion.
///
/// # Errors
///
/// Returns `ContractError` if preconditions are not met or on database failure.
pub async fn complete_first_run(
    pool: &SqlitePool,
    bus: &EventBus,
) -> Result<FirstRunCompleteResponse, ContractError> {
    // Let the repository check preconditions and mark complete.
    let resp = repo::complete_first_run(pool).await.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("first_run.incomplete") {
            ContractError::new(
                ErrorCode::FirstrunIncomplete,
                "At least one raw source and one project source must be registered before completing first run.",
                ErrorSeverity::Blocking,
                false,
            )
        } else {
            db_to_contract(e)
        }
    })?;

    // Count sources per kind for the audit event.
    let sources = repo::list_sources(pool).await.map_err(db_to_contract)?;
    let source_count_by_kind = SourceCountByKind {
        light_frames: sources.iter().filter(|s| s.kind == SourceKind::LightFrames).count(),
        calibration: sources.iter().filter(|s| s.kind == SourceKind::Calibration).count(),
        project: sources.iter().filter(|s| s.kind == SourceKind::Project).count(),
        inbox: sources.iter().filter(|s| s.kind == SourceKind::Inbox).count(),
    };

    // Publish audit event (best-effort; do not fail the operation if the bus drops).
    let _ = bus
        .publish(
            TOPIC_FIRST_RUN_COMPLETED,
            Source::User,
            FirstRunCompleted { completed_at: resp.completed_at.clone(), source_count_by_kind },
        )
        .await;

    Ok(resp)
}

/// Restart the first-run wizard, returning existing sources as prefill.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn restart_first_run(
    pool: &SqlitePool,
) -> Result<FirstRunRestartResponse, ContractError> {
    repo::restart_first_run(pool).await.map_err(db_to_contract)
}

// ── Root remap (P6a) ──────────────────────────────────────────────────────────

/// Look up a root's kind + path, mapping a missing row to `source.not_found`.
async fn get_root_or_not_found(
    pool: &SqlitePool,
    root_id: &str,
) -> Result<(SourceKind, String), ContractError> {
    repo::get_source_kind_and_path(pool, root_id).await.map_err(db_to_contract)?.ok_or_else(|| {
        ContractError::new(
            ErrorCode::SourceNotFound,
            format!("root not found: {root_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })
}

/// Preview a root path remap (`roots.remap`, P6a).
///
/// Validates that `new_path` exists, is a directory, and is readable, then
/// checks EVERY relative path previously recorded for `root_id` (via
/// `file_record` and pending `inbox_items` — see
/// [`repo::relative_paths_for_root`]) and reports whether each resolves under
/// `new_path`. Does NOT mutate anything — call [`apply_root_remap`] after
/// review.
///
/// Exhaustive by design (issue #560): a bounded sample let files outside it
/// go unverified, and checking `file_record` alone let a root that was only
/// ever scanned into the Inbox report a vacuous "all verified" from zero
/// samples, unlocking Apply against a path that held none of its real
/// content. Roots with no recorded rows in either table (calibration/project
/// roots, or raw roots registered directly without ever receiving an inbox
/// scan) report zero samples — `all_verified` then reflects only
/// `new_path`'s own validity, which is correct: there is nothing recorded to
/// silently orphan.
///
/// # Errors
///
/// - `source.not_found` — no root with `root_id`.
/// - `path.not_exists` / `path.not_directory` / `path.permission_denied` —
///   `new_path` fails validation.
/// - `internal.database` — query failure.
pub async fn remap_root(
    pool: &SqlitePool,
    root_id: &str,
    new_path: &str,
) -> Result<RemapVerification, ContractError> {
    let (_, original_path) = get_root_or_not_found(pool, root_id).await?;

    validate_path(new_path).map_err(|e| *e)?;

    let (samples, all_verified) = compute_remap_verification(pool, root_id, new_path).await?;

    Ok(RemapVerification {
        root_id: root_id.to_owned(),
        original_path,
        new_path: new_path.to_owned(),
        samples,
        all_verified,
    })
}

/// Compute remap verification samples for `root_id` against `new_path`:
/// every relative path previously recorded for the root (see
/// [`repo::relative_paths_for_root`]), and whether each resolves under
/// `new_path`. Shared by [`remap_root`] (preview) and [`apply_root_remap`]
/// (independent re-verification — nJ01a review carry-over: `apply_root_remap`
/// used to trust the caller-supplied `verified` flag outright, so a stale
/// preview or a directly-called IPC command could apply an unverified remap).
async fn compute_remap_verification(
    pool: &SqlitePool,
    root_id: &str,
    new_path: &str,
) -> Result<(Vec<RemapSample>, bool), ContractError> {
    let relative_paths =
        repo::relative_paths_for_root(pool, root_id).await.map_err(db_to_contract)?;

    let new_root = std::path::Path::new(new_path);
    let samples: Vec<RemapSample> = relative_paths
        .into_iter()
        .map(|relative_path| {
            let found = new_root.join(&relative_path).exists();
            RemapSample { relative_path, found }
        })
        .collect();
    let all_verified = samples.iter().all(|s| s.found);
    Ok((samples, all_verified))
}

/// Gate a remap apply on verification, refusing (and auditing) when either
/// the caller-supplied `verified` flag is `false`, or a freshly recomputed
/// [`compute_remap_verification`] disagrees with a `verified: true` claim.
/// Extracted from [`apply_root_remap`] to keep it under clippy's line budget
/// (nJ01a review carry-over — see that function's doc comment for why the
/// flag alone isn't trusted).
async fn ensure_remap_verified(
    pool: &SqlitePool,
    bus: &EventBus,
    root_id: &str,
    new_path: &str,
    verified: bool,
) -> Result<(), ContractError> {
    // Issue #707: `verified` must actually gate the mutation, not just ride
    // along as audit metadata — the whole point of the two-step Verify →
    // Apply flow (constitution §II) is that Apply is refused without a prior
    // successful Verify. Checked independently of any UI-side disabled state
    // since this is reachable directly over IPC.
    let recomputed_verified = if verified {
        match compute_remap_verification(pool, root_id, new_path).await {
            Ok((_, recomputed)) => recomputed,
            Err(e) => {
                write_root_op_refusal(
                    bus,
                    root_id,
                    "root.remap.apply",
                    Outcome::Failed,
                    &error_code_str(e.code),
                )
                .await?;
                return Err(e);
            }
        }
    } else {
        false
    };

    if !recomputed_verified {
        write_root_op_refusal(
            bus,
            root_id,
            "root.remap.apply",
            Outcome::Refused,
            "remap.not_verified",
        )
        .await?;
        return Err(ContractError::new(
            ErrorCode::RemapNotVerified,
            "remap must be verified before it can be applied",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    Ok(())
}

/// Apply a previously previewed root remap (`roots.remap.apply`, P6a).
///
/// Updates the root's stored path in `registered_sources` (metadata only —
/// no files are moved) and publishes a best-effort `root.remapped` audit
/// event recording the prior path, new path, and the caller-supplied
/// `verified` flag (expected to be the `all_verified` value from a matching
/// [`remap_root`] preview), per constitution Principle II.
///
/// Re-validates `new_path` so an apply cannot silently succeed against a path
/// that no longer exists between preview and apply (e.g. an unmounted drive).
/// Also re-derives verification itself via [`compute_remap_verification`]
/// rather than trusting the caller-supplied `verified` flag: both the flag
/// AND the freshly recomputed state must agree the remap is verified, so a
/// stale preview or a direct IPC call can't bypass the gate.
///
/// # Errors
///
/// - `source.not_found` — no root with `root_id`.
/// - `path.not_exists` / `path.not_directory` / `path.permission_denied` —
///   `new_path` fails validation.
/// - `remap.not_verified` — `verified` is `false`, or the current state no
///   longer backs a `verified: true` claim.
/// - `internal.database` — persistence failure.
pub async fn apply_root_remap(
    pool: &SqlitePool,
    bus: &EventBus,
    root_id: &str,
    new_path: &str,
    verified: bool,
) -> Result<(), ContractError> {
    let (_, original_path) = match get_root_or_not_found(pool, root_id).await {
        Ok(v) => v,
        Err(e) => {
            write_root_op_refusal(
                bus,
                root_id,
                "root.remap.apply",
                Outcome::Failed,
                &error_code_str(e.code),
            )
            .await?;
            return Err(e);
        }
    };

    if let Err(e) = validate_path(new_path) {
        write_root_op_refusal(
            bus,
            root_id,
            "root.remap.apply",
            Outcome::Refused,
            &error_code_str(e.code),
        )
        .await?;
        return Err(*e);
    }

    ensure_remap_verified(pool, bus, root_id, new_path, verified).await?;

    if let Err(e) = repo::set_source_path(pool, root_id, new_path).await {
        // FIX (review round 1 #2): the write was attempted (root exists,
        // new_path validated) and failed — audit as `Failed`.
        let err = db_to_contract(e);
        write_root_op_refusal(
            bus,
            root_id,
            "root.remap.apply",
            Outcome::Failed,
            &error_code_str(err.code),
        )
        .await?;
        return Err(err);
    }
    // Invalidate after commit (F0 contract) so the next read reloads the new path.
    caches::invalidate_library_root(root_id);

    // Write durable audit row + live event (T125, FR-130/FR-131).
    let entry = AuditLogEntry::new(
        EntityType::LibraryRoot,
        deterministic_entity_id("root", root_id),
        "root.remap.apply",
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(
        serde_json::json!({"before": original_path, "after": new_path, "verified": verified}),
    );
    bus.write_audit(
        entry,
        TOPIC_ROOT_REMAPPED,
        Source::User,
        RootRemapped {
            root_id: root_id.to_owned(),
            original_path,
            new_path: new_path.to_owned(),
            verified,
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(())
}

/// Write a durable `Outcome::Failed` audit row for a root operation attempted
/// against a missing/invalid root (T125/T127, FR-130). `action` names the
/// specific operation (`root.remap.apply`, `root.active_changed`,
/// `root.deleted`) so refusals for different root ops stay distinguishable
/// under the same `entity_id`. `outcome` is `Failed` for a not-found/DB-level
/// failure or `Refused` for a business-rule block (e.g. `root.has_dependents`).
async fn write_root_op_refusal(
    bus: &EventBus,
    root_id: &str,
    action: &str,
    outcome: Outcome,
    reason_code: &str,
) -> Result<(), ContractError> {
    let entry = AuditLogEntry::new(
        EntityType::LibraryRoot,
        deterministic_entity_id("root", root_id),
        action,
        "user",
        outcome,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_reason_code(reason_code.to_owned())
    .with_payload(serde_json::json!({"rootId": root_id}));
    bus.write_audit(
        entry,
        "root.op_failed",
        Source::User,
        serde_json::json!({"rootId": root_id, "action": action, "outcome": outcome.as_str(), "reasonCode": reason_code}),
    )
    .await
    .map_err(bus_err)?;
    Ok(())
}

// ── Root active toggle (P6b) ─────────────────────────────────────────────────

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

// ── Root delete (P6b) ─────────────────────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::first_run::OrganizationState;

    #[test]
    fn validate_path_not_exists() {
        let result = validate_path("/nonexistent/path/that/does/not/exist");
        let err = result.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathNotExists);
    }

    #[test]
    fn validate_path_not_directory() {
        // Use a known file path that exists on all platforms.
        let path = if cfg!(unix) { "/etc/hostname" } else { "C:\\Windows\\System32\\cmd.exe" };
        // Only run this test if the path actually exists.
        if std::fs::metadata(path).is_ok() {
            let result = validate_path(path);
            let err = result.unwrap_err();
            assert_eq!(err.code, ErrorCode::PathNotDirectory);
        }
    }

    #[test]
    fn validate_path_success_for_tmp() {
        // /tmp should exist and be a directory on Unix.
        if cfg!(unix) {
            let result = validate_path("/tmp");
            assert!(result.is_ok());
        }
    }

    #[tokio::test]
    async fn check_duplicate_detects_same_kind() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        repo::register_source(&pool, &req).await.unwrap();

        let err = check_duplicate(&pool, "/tmp", SourceKind::LightFrames).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathAlreadyRegistered);
        // Issue #501: an exact duplicate must hard-stop registration, not be
        // a bypassable `Warning`.
        assert_eq!(err.severity, ErrorSeverity::Blocking);
    }

    #[tokio::test]
    async fn check_duplicate_detects_different_kind() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        repo::register_source(&pool, &req).await.unwrap();

        let err = check_duplicate(&pool, "/tmp", SourceKind::Project).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathAlreadyRegisteredDifferentKind);
    }

    // ── Issue #501: overlapping root registration ────────────────────────────

    #[tokio::test]
    async fn register_source_rejects_nested_child_root() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let parent = tempfile::tempdir().expect("tempdir");
        let child = parent.path().join("nested");
        std::fs::create_dir(&child).unwrap();

        let parent_req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: parent.path().to_str().unwrap().to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &bus, &parent_req).await.unwrap();

        // A root nested inside an already-registered root — even under a
        // DIFFERENT category — must be rejected (cross-cutting overlap).
        let child_req = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: child.to_str().unwrap().to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        };
        let err = register_source(&pool, &bus, &child_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathOverlapsExisting);
    }

    #[tokio::test]
    async fn register_source_rejects_parent_of_existing_root() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let parent = tempfile::tempdir().expect("tempdir");
        let child = parent.path().join("nested");
        std::fs::create_dir(&child).unwrap();

        let child_req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: child.to_str().unwrap().to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &bus, &child_req).await.unwrap();

        // The parent of an already-registered root must also be rejected.
        let parent_req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: parent.path().to_str().unwrap().to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let err = register_source(&pool, &bus, &parent_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathOverlapsExisting);
    }

    #[tokio::test]
    async fn register_source_batch_rejects_intra_batch_overlap() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let parent = tempfile::tempdir().expect("tempdir");
        let child = parent.path().join("nested");
        std::fs::create_dir(&child).unwrap();

        // Neither path is registered yet — the overlap must still be caught
        // candidate-vs-candidate within the SAME batch request.
        let req = contracts_core::first_run::RegisterSourceBatchRequest {
            sources: vec![
                RegisterSourceRequest {
                    kind: SourceKind::LightFrames,
                    path: parent.path().to_str().unwrap().to_owned(),
                    kind_subtype: None,
                    scan_depth: contracts_core::first_run::ScanDepth::Recursive,
                    organization_state: OrganizationState::Organized,
                },
                RegisterSourceRequest {
                    kind: SourceKind::Inbox,
                    path: child.to_str().unwrap().to_owned(),
                    kind_subtype: None,
                    scan_depth: contracts_core::first_run::ScanDepth::Recursive,
                    organization_state: OrganizationState::Unorganized,
                },
            ],
        };

        let resp = register_source_batch(&pool, &bus, &req).await.unwrap();
        assert_eq!(resp.status, contracts_core::first_run::BatchStatus::Partial);
        assert_eq!(resp.items[0].status, contracts_core::first_run::ItemStatus::Success);
        assert_eq!(resp.items[1].status, contracts_core::first_run::ItemStatus::Failure);
        assert_eq!(resp.items[1].error.as_deref(), Some("path.overlaps_existing"));
    }

    /// nJ01a review carry-over: Windows filesystems (NTFS/ReFS/FAT) are
    /// case-insensitive/case-preserving, so a case-only variant of an
    /// already-registered root names the SAME real directory and must still
    /// be caught as an overlap.
    #[tokio::test]
    async fn register_source_rejects_windows_case_variant_of_existing_root() {
        if !cfg!(windows) {
            return;
        }
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_str().expect("utf8 path").to_owned();
        // Windows resolves this to the same real directory as `path`.
        let path_upper = path.to_uppercase();

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path,
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &bus, &req).await.unwrap();

        let variant_req = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: path_upper,
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        };
        let err = register_source(&pool, &bus, &variant_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathOverlapsExisting);
    }

    /// T1-c: `db_to_contract`'s fallback arm now delegates to the canonical
    /// `db_err` mapper, so a `NotFound` (missing row) is `Blocking`/
    /// non-retryable rather than the hand-rolled `Fatal`/`retryable=true`
    /// this used to apply to every `DbError` variant.
    #[tokio::test]
    async fn remove_source_not_found_is_blocking_not_fatal() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let err = remove_source(&pool, "does-not-exist").await.unwrap_err();
        assert_eq!(err.severity, ErrorSeverity::Blocking);
        assert!(!err.retryable);
    }

    /// T125/SC-009: a successful `register_source` writes a durable
    /// `Outcome::Applied` `audit_log_entry` row tagged `EntityType::DataSource`.
    #[tokio::test]
    async fn register_source_writes_durable_applied_audit_row() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        // CI FIX: `tempfile::tempdir()` (not a hardcoded "/tmp") — mirrors
        // `crates/app/core/tests/first_run_integration.rs`'s pattern for this
        // same function; a Unix-only literal path fails `validate_path` on
        // windows-latest.
        let dir = tempfile::tempdir().expect("tempdir");
        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: dir.path().to_str().expect("utf8 path").to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &bus, &req).await.unwrap();

        let row: (String, String) = sqlx::query_as(
            "SELECT entity_type, outcome FROM audit_log_entry WHERE trigger = 'source.register'",
        )
        .fetch_one(&pool)
        .await
        .expect("register_source must write a durable audit row");
        assert_eq!(row.0, "data_source");
        assert_eq!(row.1, "applied");
    }

    /// T127: a refused `register_source` (duplicate path) writes a durable
    /// `Outcome::Refused` row with a reason_code, per FR-130.
    #[tokio::test]
    async fn register_source_refused_duplicate_writes_durable_row() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        // CI FIX: see `register_source_writes_durable_applied_audit_row` —
        // same "/tmp" → tempdir() Windows fix.
        let dir = tempfile::tempdir().expect("tempdir");
        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: dir.path().to_str().expect("utf8 path").to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &bus, &req).await.unwrap();
        let err = register_source(&pool, &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathAlreadyRegistered);

        let row: (String, Option<String>) = sqlx::query_as(
            "SELECT outcome, reason_code FROM audit_log_entry WHERE trigger = 'source.register' AND outcome = 'refused'",
        )
        .fetch_one(&pool)
        .await
        .expect("refused register_source must write a durable audit row");
        assert_eq!(row.0, "refused");
        assert_eq!(row.1.as_deref(), Some("path.already_registered"));
    }

    #[tokio::test]
    async fn complete_first_run_rejects_without_sources() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err = complete_first_run(&pool, &bus).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::FirstrunIncomplete);
    }

    // ── P6a: root remap use cases ────────────────────────────────────────────

    #[tokio::test]
    async fn remap_root_missing_root_returns_not_found() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let err = remap_root(&pool, "nonexistent-root", "/tmp").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceNotFound);
    }

    #[tokio::test]
    async fn remap_root_invalid_new_path_returns_path_not_exists() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        let err = remap_root(&pool, &resp.source_id, "/nonexistent/path/that/does/not/exist")
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::PathNotExists);
    }

    #[tokio::test]
    async fn remap_root_with_no_file_records_is_verified_by_path_existence_alone() {
        // Needs a real, existing directory to remap into; "/tmp" is Unix-only.
        if !cfg!(unix) {
            return;
        }
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::Calibration,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        let preview = remap_root(&pool, &resp.source_id, "/tmp").await.unwrap();
        assert_eq!(preview.original_path, "/tmp");
        assert_eq!(preview.new_path, "/tmp");
        assert!(preview.samples.is_empty());
        assert!(preview.all_verified);
    }

    /// T127 "source op failed": an `apply_root_remap` attempted against a
    /// missing root writes a durable `Outcome::Failed` row tagged
    /// `EntityType::LibraryRoot`, with a reason_code (FR-130).
    #[tokio::test]
    async fn apply_root_remap_missing_root_returns_not_found() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err =
            apply_root_remap(&pool, &bus, "nonexistent-root", "/tmp", true).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceNotFound);

        let row: (String, String, Option<String>) = sqlx::query_as(
            "SELECT entity_type, outcome, reason_code FROM audit_log_entry WHERE trigger = 'root.remap.apply'",
        )
        .fetch_one(&pool)
        .await
        .expect("failed apply_root_remap must write a durable audit row");
        assert_eq!(row.0, "library_root");
        assert_eq!(row.1, "failed");
        assert_eq!(row.2.as_deref(), Some("source.not_found"));
    }

    #[tokio::test]
    async fn apply_root_remap_invalid_new_path_returns_path_not_exists() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        let err = apply_root_remap(
            &pool,
            &bus,
            &resp.source_id,
            "/nonexistent/path/that/does/not/exist",
            true,
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::PathNotExists);

        // Apply-without-verify semantics: a failed apply must never mutate the
        // stored path — the root still reports its original location.
        let (_, path) =
            repo::get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(path, "/tmp");
    }

    #[tokio::test]
    async fn apply_root_remap_updates_path_and_publishes_audit_event() {
        // Needs two real, existing directories; "/tmp" and "/var/tmp" are Unix-only.
        if !cfg!(unix) {
            return;
        }
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        apply_root_remap(&pool, &bus, &resp.source_id, "/var/tmp", true).await.unwrap();

        let (_, path) =
            repo::get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(path, "/var/tmp");

        // A durable `root.remapped` audit event was written (constitution §II).
        let row: (String,) =
            sqlx::query_as("SELECT payload FROM events WHERE topic = 'root.remapped'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(row.0.contains(&resp.source_id));
        assert!(row.0.contains("/tmp"));
        assert!(row.0.contains("/var/tmp"));
    }

    /// Issue #707: `verified: false` must refuse the mutation, not merely be
    /// recorded as audit metadata — this is the core of the bug report.
    #[tokio::test]
    async fn apply_root_remap_rejects_when_not_verified() {
        if !cfg!(unix) {
            return;
        }
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::Calibration,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        let err = apply_root_remap(&pool, &bus, &resp.source_id, "/var/tmp", false)
            .await
            .expect_err("apply with verified: false must be refused");
        assert_eq!(err.code, ErrorCode::RemapNotVerified);
        assert_eq!(err.severity, ErrorSeverity::Blocking);

        // The stored path must be untouched.
        let (_, path) =
            repo::get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(path, "/tmp");

        let row: (String, String) = sqlx::query_as(
            "SELECT outcome, reason_code FROM audit_log_entry WHERE trigger = 'root.remap.apply' AND outcome = 'refused'",
        )
        .fetch_one(&pool)
        .await
        .expect("refused apply_root_remap must write a durable audit row");
        assert_eq!(row.0, "refused");
        assert_eq!(row.1, "remap.not_verified");
    }

    /// nJ01a review carry-over: a caller passing `verified: true` must not
    /// bypass server-side re-verification. A recorded relative path that
    /// does NOT resolve under `new_path` means the true state disagrees with
    /// the caller's claim (stale preview, or a direct IPC bypass attempt) —
    /// apply must still be refused.
    #[tokio::test]
    async fn apply_root_remap_rejects_stale_verified_true_claim() {
        if !cfg!(unix) {
            return;
        }
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        // Mirror the registered_sources row into library_root so the
        // file_record FK holds — see persistence_db's
        // `relative_paths_for_root_is_exhaustive_and_ordered`.
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
             VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
        )
        .bind(&resp.source_id)
        .bind(&resp.source_id)
        .bind(&resp.path)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO file_record \
             (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
             VALUES (?, ?, 'nonexistent/light_001.fits', 0, '2026-01-01T00:00:00Z', 'observed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind("fr-stale")
        .bind(&resp.source_id)
        .execute(&pool)
        .await
        .unwrap();

        // "/var/tmp" does not contain "nonexistent/light_001.fits" — the
        // caller's `verified: true` claim is stale/wrong, so the recompute
        // inside `apply_root_remap` must refuse regardless.
        let err = apply_root_remap(&pool, &bus, &resp.source_id, "/var/tmp", true)
            .await
            .expect_err("stale verified:true claim must be refused after server-side recompute");
        assert_eq!(err.code, ErrorCode::RemapNotVerified);

        let (_, path) =
            repo::get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(path, "/tmp");
    }

    /// Issue #560: a root only scanned into the Inbox (no `file_record` rows,
    /// but real `inbox_items` rows) must NOT report `all_verified: true` from
    /// a vacuous empty sample when its actual content isn't found at the new
    /// path.
    #[tokio::test]
    async fn remap_root_checks_inbox_items_not_just_file_record() {
        use persistence_db::repositories::inbox::{insert_inbox_item, InsertInboxItem};

        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        insert_inbox_item(
            &pool,
            &InsertInboxItem {
                id: "item-1",
                root_id: &resp.source_id,
                relative_path: "M31/lights",
                file_count: 7,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        // A brand-new, genuinely empty candidate directory — none of the
        // root's recorded content lives there.
        let new_dir = tempfile::tempdir().expect("tempdir");
        let preview =
            remap_root(&pool, &resp.source_id, new_dir.path().to_str().unwrap()).await.unwrap();

        assert_eq!(preview.samples.len(), 1, "the inbox item must be sampled");
        assert!(!preview.samples[0].found);
        assert!(
            !preview.all_verified,
            "must not vacuously report all_verified against an empty candidate path"
        );
    }

    // ── P6b: root active toggle ────────────────────────────────────────────────

    #[tokio::test]
    async fn set_source_active_missing_root_returns_not_found() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err = set_source_active(&pool, &bus, "nonexistent-id", false).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceNotFound);
    }

    #[tokio::test]
    async fn set_source_active_toggles_and_publishes_audit_event() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        set_source_active(&pool, &bus, &resp.source_id, false).await.unwrap();

        let flags = repo::list_active_flags(&pool).await.unwrap();
        assert_eq!(flags.get(&resp.source_id), Some(&false));

        // A durable `root.active_changed` audit event was written (constitution §II).
        let row: (String,) =
            sqlx::query_as("SELECT payload FROM events WHERE topic = 'root.active_changed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(row.0.contains(&resp.source_id));
        assert!(row.0.contains("false"));

        set_source_active(&pool, &bus, &resp.source_id, true).await.unwrap();
        let flags = repo::list_active_flags(&pool).await.unwrap();
        assert_eq!(flags.get(&resp.source_id), Some(&true));
    }

    // ── P6b: root delete ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn delete_source_missing_root_returns_not_found() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err = delete_source(&pool, &bus, "nonexistent-id").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceNotFound);
    }

    #[tokio::test]
    async fn delete_source_without_dependents_succeeds_and_publishes_audit_event() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        delete_source(&pool, &bus, &resp.source_id).await.unwrap();

        let remaining = repo::list_sources(&pool).await.unwrap();
        assert!(remaining.iter().all(|s| s.source_id != resp.source_id));

        // A durable `root.deleted` audit event was written (constitution §II).
        let row: (String,) =
            sqlx::query_as("SELECT payload FROM events WHERE topic = 'root.deleted'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(row.0.contains(&resp.source_id));
        assert!(row.0.contains("/astro/projects"));
    }

    #[tokio::test]
    async fn delete_source_blocks_when_dependents_exist() {
        use persistence_db::repositories::inbox::{insert_inbox_item, InsertInboxItem};

        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let req = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        };
        let resp = repo::register_source(&pool, &req).await.unwrap();

        insert_inbox_item(
            &pool,
            &InsertInboxItem {
                id: "item-1",
                root_id: &resp.source_id,
                relative_path: "2026-01-01/lights",
                file_count: 3,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let err = delete_source(&pool, &bus, &resp.source_id).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RootHasDependents);
        // The typed counts are surfaced in `details` so the caller can explain
        // the block reason without a second round trip.
        assert_eq!(err.details.0["inboxItems"], serde_json::json!(1));

        // The source registration must NOT have been removed (no cascade,
        // no partial delete — constitution §II).
        let remaining = repo::list_sources(&pool).await.unwrap();
        assert!(remaining.iter().any(|s| s.source_id == resp.source_id));
    }
}
