//! First-run source registration and wizard use cases (spec 003).
//!
//! Thin orchestration layer adding path validation, error mapping to
//! contract error codes, and audit event emission on top of the
//! persistence repository.

use audit::bus::EventBus;
use audit::event_bus::{FirstRunCompleted, Source, SourceCountByKind, TOPIC_FIRST_RUN_COMPLETED};
use contracts_core::first_run::{
    FirstRunCompleteResponse, FirstRunRestartResponse, FirstRunStateResponse,
    RegisterSourceBatchRequest, RegisterSourceBatchResponse, RegisterSourceRequest,
    RegisterSourceResponse, SourceKind,
};
use contracts_core::{ContractError, ErrorSeverity, JsonAny};
use persistence_db::repositories::first_run as repo;
use sqlx::SqlitePool;

// ── Path validation ─────────────────────────────────────────────────────────

/// Validate that the given path exists, is a directory, and is readable.
///
/// Returns a `ContractError` with a dotted error code on failure.
fn validate_path(path: &str) -> Result<(), Box<ContractError>> {
    let metadata = std::fs::metadata(path).map_err(|e| {
        Box::new(if e.kind() == std::io::ErrorKind::NotFound {
            ContractError::new(
                "path.not_exists",
                format!("Path does not exist: {path}"),
                ErrorSeverity::Blocking,
                false,
            )
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            ContractError::new(
                "path.permission_denied",
                format!("Permission denied: {path}"),
                ErrorSeverity::Blocking,
                false,
            )
        } else {
            ContractError::new(
                "path.not_exists",
                format!("Cannot access path: {path}: {e}"),
                ErrorSeverity::Blocking,
                false,
            )
        })
    })?;

    if !metadata.is_dir() {
        return Err(Box::new(ContractError::new(
            "path.not_directory",
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
                "path.permission_denied",
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
    let existing = repo::list_sources(pool).await.map_err(db_to_contract)?;

    for source in &existing {
        if source.path == path {
            if source.kind == kind {
                return Err(ContractError::new(
                    "path.already_registered",
                    format!("Path is already registered as {kind:?}: {path}"),
                    ErrorSeverity::Warning,
                    false,
                ));
            }
            return Err(ContractError::new(
                "path.already_registered.different_kind",
                format!(
                    "Path is already registered as {:?} (requested {:?}): {path}",
                    source.kind, kind
                ),
                ErrorSeverity::Warning,
                false,
            ));
        }
    }

    Ok(())
}

fn db_to_contract(e: persistence_db::DbError) -> ContractError {
    let msg = e.to_string();
    drop(e);
    if msg.contains("UNIQUE constraint failed") {
        ContractError::new("path.already_registered", msg, ErrorSeverity::Warning, false)
    } else {
        ContractError::new("internal.database", msg, ErrorSeverity::Fatal, true)
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
    repo::register_source(pool, req).await.map_err(db_to_contract)
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
            items.push(BatchItem {
                index,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some(e.code.clone()),
                error_detail: Some(JsonAny::new(serde_json::json!({ "message": e.message }))),
            });
        } else if let Err(e) = check_duplicate(pool, &source.path, source.kind).await {
            items.push(BatchItem {
                index,
                status: ItemStatus::Failure,
                source_id: None,
                error: Some(e.code.clone()),
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
                "firstrun.incomplete",
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
        raw: sources.iter().filter(|s| s.kind == SourceKind::Raw).count(),
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

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_not_exists() {
        let result = validate_path("/nonexistent/path/that/does/not/exist");
        let err = result.unwrap_err();
        assert_eq!(err.code, "path.not_exists");
    }

    #[test]
    fn validate_path_not_directory() {
        // Use a known file path that exists on all platforms.
        let path = if cfg!(unix) { "/etc/hostname" } else { "C:\\Windows\\System32\\cmd.exe" };
        // Only run this test if the path actually exists.
        if std::fs::metadata(path).is_ok() {
            let result = validate_path(path);
            let err = result.unwrap_err();
            assert_eq!(err.code, "path.not_directory");
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
            kind: SourceKind::Raw,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
        };
        repo::register_source(&pool, &req).await.unwrap();

        let err = check_duplicate(&pool, "/tmp", SourceKind::Raw).await.unwrap_err();
        assert_eq!(err.code, "path.already_registered");
    }

    #[tokio::test]
    async fn check_duplicate_detects_different_kind() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();

        let req = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: contracts_core::first_run::ScanDepth::Recursive,
        };
        repo::register_source(&pool, &req).await.unwrap();

        let err = check_duplicate(&pool, "/tmp", SourceKind::Project).await.unwrap_err();
        assert_eq!(err.code, "path.already_registered.different_kind");
    }

    #[tokio::test]
    async fn complete_first_run_rejects_without_sources() {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let err = complete_first_run(&pool, &bus).await.unwrap_err();
        assert_eq!(err.code, "firstrun.incomplete");
    }
}
