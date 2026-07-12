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
use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartResponse, FirstRunStateResponse, OrganizationState,
    RegisterSourceBatchRequest, RegisterSourceBatchResponse, RegisterSourceRequest,
    RegisterSourceResponse, SetSourceOrganizationStateRequest, SetSourceOrganizationStateResponse,
    SourceKind, ERR_SOURCE_INVALID_ORGANIZATION_STATE,
};
use contracts_core::roots::{RemapSample, RemapVerification};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity, JsonAny};
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

use crate::caches;

/// Maximum number of previously-recorded relative paths sampled by
/// `remap_root` to preview whether they resolve under a candidate new path.
const REMAP_SAMPLE_LIMIT: i64 = 5;

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
            return Err(ContractError::new(
                ErrorCode::PathAlreadyRegistered,
                format!("Path is already registered as {kind:?}: {path}"),
                ErrorSeverity::Warning,
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

fn db_to_contract(e: persistence_db::DbError) -> ContractError {
    let msg = e.to_string();
    if msg.contains("UNIQUE constraint failed") {
        ContractError::new(ErrorCode::PathAlreadyRegistered, msg, ErrorSeverity::Warning, false)
    } else {
        // Delegate the non-UNIQUE fallback to the canonical mapper (T1-c) so
        // `NotFound` is classified `Blocking`/non-retryable instead of the
        // hand-rolled `Fatal`/`retryable=true` this used to apply to every
        // variant, including missing rows.
        crate::errors::db_err(e)
    }
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
    req: &RegisterSourceRequest,
) -> Result<RegisterSourceResponse, ContractError> {
    validate_path(&req.path).map_err(|e| *e)?;
    check_duplicate(pool, &req.path, req.kind).await?;
    let resp = repo::register_source(pool, req).await.map_err(db_to_contract)?;
    // Invalidate after commit (F0 contract): a freshly registered id can't
    // already be cached, but this keeps the write site authoritative if a
    // removed root's id is ever reused.
    caches::invalidate_library_root(&resp.source_id);
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
    req: &RegisterSourceBatchRequest,
) -> Result<RegisterSourceBatchResponse, ContractError> {
    // Pre-validate all paths and build a filtered request for the repository.
    // Items that fail validation are recorded as failures immediately.
    use contracts_core::first_run::{BatchItem, BatchStatus, ItemStatus};

    let mut items: Vec<BatchItem> = Vec::with_capacity(req.sources.len());
    let mut valid_sources: Vec<(usize, &RegisterSourceRequest)> = Vec::new();

    for (index, source) in req.sources.iter().enumerate() {
        if let Err(e) = validate_path(&source.path) {
            let code_str = serde_json::to_string(&e.code)
                .map_or_else(|_| "internal.error".to_owned(), |s| s.trim_matches('"').to_owned());
            items.push(BatchItem {
                index,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some(code_str),
                error_detail: Some(JsonAny::new(serde_json::json!({ "message": e.message }))),
            });
        } else if let Err(e) = check_duplicate(pool, &source.path, source.kind).await {
            let code_str = serde_json::to_string(&e.code)
                .map_or_else(|_| "internal.error".to_owned(), |s| s.trim_matches('"').to_owned());
            items.push(BatchItem {
                index,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some(code_str),
                error_detail: Some(JsonAny::new(serde_json::json!({ "message": e.message }))),
            });
        } else {
            valid_sources.push((index, source));
        }
    }

    // Register validated sources via the repository batch.
    if !valid_sources.is_empty() {
        let batch_req = RegisterSourceBatchRequest {
            sources: valid_sources.iter().map(|(_, s)| (*s).clone()).collect(),
        };
        let batch_resp =
            repo::register_source_batch(pool, &batch_req).await.map_err(db_to_contract)?;

        // Map repository batch items back to original indices.
        for (batch_idx, repo_item) in batch_resp.items.into_iter().enumerate() {
            let original_index = valid_sources[batch_idx].0;
            items.push(BatchItem {
                index: original_index,
                status: repo_item.status,
                source_id: repo_item.source_id,
                error: repo_item.error,
                error_detail: repo_item.error_detail,
            });
        }
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
/// samples up to [`REMAP_SAMPLE_LIMIT`] relative paths previously recorded for
/// `root_id` (via `file_record`) and reports whether each resolves under
/// `new_path`. Does NOT mutate anything — call [`apply_root_remap`] after
/// review.
///
/// Roots with no `file_record` rows (calibration/project roots, or raw roots
/// registered directly without an inbox ingest) report zero samples;
/// `all_verified` then reflects only `new_path`'s own validity. There is no
/// generic per-root file inventory in the current schema to sample from more
/// broadly.
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

    let relative_paths = repo::sample_relative_paths(pool, root_id, REMAP_SAMPLE_LIMIT)
        .await
        .map_err(db_to_contract)?;

    let new_root = std::path::Path::new(new_path);
    let samples: Vec<RemapSample> = relative_paths
        .into_iter()
        .map(|relative_path| {
            let found = new_root.join(&relative_path).exists();
            RemapSample { relative_path, found }
        })
        .collect();
    let all_verified = samples.iter().all(|s| s.found);

    Ok(RemapVerification {
        root_id: root_id.to_owned(),
        original_path,
        new_path: new_path.to_owned(),
        samples,
        all_verified,
    })
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
///
/// # Errors
///
/// - `source.not_found` — no root with `root_id`.
/// - `path.not_exists` / `path.not_directory` / `path.permission_denied` —
///   `new_path` fails validation.
/// - `internal.database` — persistence failure.
pub async fn apply_root_remap(
    pool: &SqlitePool,
    bus: &EventBus,
    root_id: &str,
    new_path: &str,
    verified: bool,
) -> Result<(), ContractError> {
    let (_, original_path) = get_root_or_not_found(pool, root_id).await?;

    validate_path(new_path).map_err(|e| *e)?;

    repo::set_source_path(pool, root_id, new_path).await.map_err(db_to_contract)?;
    // Invalidate after commit (F0 contract) so the next read reloads the new path.
    caches::invalidate_library_root(root_id);

    // Publish audit event (best-effort; do not fail the operation if the bus drops).
    let _ = bus
        .publish(
            TOPIC_ROOT_REMAPPED,
            Source::User,
            RootRemapped {
                root_id: root_id.to_owned(),
                original_path,
                new_path: new_path.to_owned(),
                verified,
            },
        )
        .await;

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
    let (_, path) = get_root_or_not_found(pool, root_id).await?;

    repo::set_source_active(pool, root_id, active).await.map_err(db_to_contract)?;

    let _ = bus
        .publish(
            TOPIC_ROOT_ACTIVE_CHANGED,
            Source::User,
            RootActiveChanged { root_id: root_id.to_owned(), path, active },
        )
        .await;

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
    let (kind, path) = get_root_or_not_found(pool, root_id).await?;

    let counts = repo::count_root_dependents(pool, root_id).await.map_err(db_to_contract)?;
    if !counts.is_empty() {
        let details = serde_json::to_value(counts).unwrap_or_default();
        return Err(ContractError::new(
            ErrorCode::RootHasDependents,
            format!("root {root_id} has dependent records and cannot be deleted"),
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(details));
    }

    repo::remove_source(pool, root_id).await.map_err(db_to_contract)?;
    // Invalidate after commit: the root row (and its path) no longer exists,
    // so a still-cached path would otherwise resurface for a deleted root.
    caches::invalidate_library_root(root_id);

    let kind_str: &'static str = kind.into();
    let _ = bus
        .publish(
            TOPIC_ROOT_DELETED,
            Source::User,
            RootDeleted { root_id: root_id.to_owned(), path, kind: kind_str.to_owned() },
        )
        .await;

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

    #[tokio::test]
    async fn apply_root_remap_missing_root_returns_not_found() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err =
            apply_root_remap(&pool, &bus, "nonexistent-root", "/tmp", true).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceNotFound);
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
