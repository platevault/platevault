//! Repository methods for spec 003 first-run source registration.
//!
//! Operates on `registered_sources` and `first_run_state` tables
//! (migration 0006).

use contracts_core::first_run::{
    BatchItem, BatchStatus, FirstRunCompleteResponse, FirstRunRestartResponse,
    FirstRunStateResponse, ItemStatus, RegisterSourceBatchRequest, RegisterSourceBatchResponse,
    RegisterSourceRequest, RegisterSourceResponse, ScanDepth, SourceKind,
};
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{DbError, DbResult};

// ── Helpers ─────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn source_kind_to_str(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Raw => "raw",
        SourceKind::Calibration => "calibration",
        SourceKind::Project => "project",
        SourceKind::Inbox => "inbox",
    }
}

fn str_to_source_kind(s: &str) -> SourceKind {
    match s {
        "calibration" => SourceKind::Calibration,
        "project" => SourceKind::Project,
        "inbox" => SourceKind::Inbox,
        _ => SourceKind::Raw,
    }
}

fn scan_depth_to_str(depth: ScanDepth) -> &'static str {
    match depth {
        ScanDepth::Recursive => "recursive",
        ScanDepth::Single => "single",
    }
}

/// Determine `created_via` based on first_run_state.completed_at.
async fn resolve_created_via(pool: &SqlitePool) -> DbResult<&'static str> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT completed_at FROM first_run_state WHERE singleton_id = 'first_run'")
            .fetch_optional(pool)
            .await?;
    match row {
        Some((Some(_completed),)) => Ok("settings_add"),
        _ => Ok("first_run"),
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Register a single source directory.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation (e.g. duplicate
/// kind+path).
pub async fn register_source(
    pool: &SqlitePool,
    req: &RegisterSourceRequest,
) -> DbResult<RegisterSourceResponse> {
    let id = Uuid::new_v4().to_string();
    let kind_str = source_kind_to_str(req.kind);
    let scan_depth_str = scan_depth_to_str(req.scan_depth);
    let created_at = now_iso();
    let created_via = resolve_created_via(pool).await?;

    sqlx::query(
        "INSERT INTO registered_sources (id, kind, path, kind_subtype, scan_depth, created_at, created_via) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(kind_str)
    .bind(&req.path)
    .bind(&req.kind_subtype)
    .bind(scan_depth_str)
    .bind(&created_at)
    .bind(created_via)
    .execute(pool)
    .await?;

    Ok(RegisterSourceResponse {
        source_id: id,
        kind: req.kind,
        path: req.path.clone(),
        created_at,
    })
}

/// Register multiple sources in a single transaction with partial-success
/// semantics.
///
/// Each item is attempted independently; failures do not roll back
/// successful inserts within the batch.
///
/// # Errors
///
/// Returns [`DbError::Database`] only for catastrophic connection failures.
/// Per-item errors are captured in the response.
pub async fn register_source_batch(
    pool: &SqlitePool,
    req: &RegisterSourceBatchRequest,
) -> DbResult<RegisterSourceBatchResponse> {
    let created_via = resolve_created_via(pool).await?;
    let created_at = now_iso();

    let mut items: Vec<BatchItem> = Vec::with_capacity(req.sources.len());
    let mut success_count = 0usize;
    let mut failure_count = 0usize;

    let mut tx = pool.begin().await?;

    for (index, source) in req.sources.iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        let kind_str = source_kind_to_str(source.kind);
        let scan_depth_str = scan_depth_to_str(source.scan_depth);

        let result = sqlx::query(
            "INSERT INTO registered_sources (id, kind, path, kind_subtype, scan_depth, created_at, created_via) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(kind_str)
        .bind(&source.path)
        .bind(&source.kind_subtype)
        .bind(scan_depth_str)
        .bind(&created_at)
        .bind(created_via)
        .execute(&mut *tx)
        .await;

        match result {
            Ok(_) => {
                success_count += 1;
                items.push(BatchItem {
                    index,
                    status: ItemStatus::Success,
                    source_id: Some(id),
                    error: None,
                    error_detail: None,
                });
            }
            Err(e) => {
                failure_count += 1;
                items.push(BatchItem {
                    index,
                    status: ItemStatus::Failure,
                    source_id: None,
                    error: Some(e.to_string()),
                    error_detail: None,
                });
            }
        }
    }

    tx.commit().await?;

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
/// Returns [`DbError::Database`] on query failure.
pub async fn list_sources(pool: &SqlitePool) -> DbResult<Vec<RegisterSourceResponse>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, kind, path, created_at FROM registered_sources ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, kind, path, created_at)| RegisterSourceResponse {
            source_id: id,
            kind: str_to_source_kind(&kind),
            path,
            created_at,
        })
        .collect())
}

/// Remove a registered source by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn remove_source(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result = sqlx::query("DELETE FROM registered_sources WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("registered source {id} not found")));
    }

    Ok(())
}

/// Get the current first-run wizard state.
///
/// Returns a default state (`last_step = "welcome"`, `completed_at = None`)
/// if no row exists yet.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_first_run_state(pool: &SqlitePool) -> DbResult<FirstRunStateResponse> {
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT completed_at, last_step FROM first_run_state WHERE singleton_id = 'first_run'")
            .fetch_optional(pool)
            .await?;

    match row {
        Some((completed_at, last_step)) => {
            Ok(FirstRunStateResponse { completed_at, last_step })
        }
        None => Ok(FirstRunStateResponse {
            completed_at: None,
            last_step: "welcome".to_owned(),
        }),
    }
}

/// Mark the first-run wizard as complete.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if preconditions are not met (at least one
/// raw source and one project source must be registered).
pub async fn complete_first_run(pool: &SqlitePool) -> DbResult<FirstRunCompleteResponse> {
    // Check preconditions: at least one raw + one project source.
    let raw_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM registered_sources WHERE kind = 'raw'")
            .fetch_one(pool)
            .await?;
    let project_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM registered_sources WHERE kind = 'project'")
            .fetch_one(pool)
            .await?;

    if raw_count.0 == 0 || project_count.0 == 0 {
        return Err(DbError::NotFound(
            "first_run.incomplete: at least one raw and one project source required".to_owned(),
        ));
    }

    let completed_at = now_iso();

    // Upsert the singleton row.
    sqlx::query(
        "INSERT INTO first_run_state (singleton_id, completed_at, last_step, updated_at) \
         VALUES ('first_run', ?, 'finish', ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET completed_at = excluded.completed_at, \
         last_step = 'finish', updated_at = excluded.updated_at",
    )
    .bind(&completed_at)
    .bind(&completed_at)
    .execute(pool)
    .await?;

    Ok(FirstRunCompleteResponse { completed_at })
}

/// Restart the first-run wizard (clear completed_at, return existing sources).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn restart_first_run(pool: &SqlitePool) -> DbResult<FirstRunRestartResponse> {
    let now = now_iso();

    // Clear completed_at and reset to welcome step.
    sqlx::query(
        "INSERT INTO first_run_state (singleton_id, completed_at, last_step, updated_at) \
         VALUES ('first_run', NULL, 'welcome', ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET completed_at = NULL, \
         last_step = 'welcome', updated_at = excluded.updated_at",
    )
    .bind(&now)
    .execute(pool)
    .await?;

    // Update created_via for existing sources to 'settings_restart'.
    sqlx::query("UPDATE registered_sources SET created_via = 'settings_restart'")
        .execute(pool)
        .await?;

    let sources = list_sources(pool).await?;

    Ok(FirstRunRestartResponse { prefilled_sources: sources })
}

/// Update the last_step in the first_run_state singleton.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_first_run_step(pool: &SqlitePool, step: &str) -> DbResult<()> {
    let now = now_iso();

    sqlx::query(
        "INSERT INTO first_run_state (singleton_id, last_step, updated_at) \
         VALUES ('first_run', ?, ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET last_step = excluded.last_step, \
         updated_at = excluded.updated_at",
    )
    .bind(step)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::first_run::{
        RegisterSourceBatchRequest, RegisterSourceRequest, ScanDepth, SourceKind,
    };

    use super::*;
    use crate::Database;

    async fn setup_db() -> SqlitePool {
        let db = Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    #[tokio::test]
    async fn register_and_list_source() {
        let pool = setup_db().await;
        let req = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };

        let resp = register_source(&pool, &req).await.unwrap();
        assert_eq!(resp.kind, SourceKind::Raw);
        assert_eq!(resp.path, "/astro/raw");
        assert!(!resp.source_id.is_empty());

        let all = list_sources(&pool).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].source_id, resp.source_id);
    }

    #[tokio::test]
    async fn duplicate_kind_path_fails() {
        let pool = setup_db().await;
        let req = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };

        register_source(&pool, &req).await.unwrap();
        let result = register_source(&pool, &req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn remove_source_succeeds() {
        let pool = setup_db().await;
        let req = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };

        let resp = register_source(&pool, &req).await.unwrap();
        remove_source(&pool, &resp.source_id).await.unwrap();

        let all = list_sources(&pool).await.unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn remove_nonexistent_returns_not_found() {
        let pool = setup_db().await;
        let result = remove_source(&pool, "nonexistent-id").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn first_run_state_default_when_no_row() {
        let pool = setup_db().await;
        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "welcome");
        assert!(state.completed_at.is_none());
    }

    #[tokio::test]
    async fn complete_first_run_requires_raw_and_project() {
        let pool = setup_db().await;

        // No sources: should fail.
        let result = complete_first_run(&pool).await;
        assert!(result.is_err());

        // Only raw: should fail.
        let req = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };
        register_source(&pool, &req).await.unwrap();
        let result = complete_first_run(&pool).await;
        assert!(result.is_err());

        // Add project: should succeed.
        let req = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };
        register_source(&pool, &req).await.unwrap();
        let resp = complete_first_run(&pool).await.unwrap();
        assert!(!resp.completed_at.is_empty());

        // Verify state updated.
        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "finish");
        assert!(state.completed_at.is_some());
    }

    #[tokio::test]
    async fn restart_first_run_clears_completed_at() {
        let pool = setup_db().await;

        // Register sources and complete.
        let raw = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };
        let proj = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };
        register_source(&pool, &raw).await.unwrap();
        register_source(&pool, &proj).await.unwrap();
        complete_first_run(&pool).await.unwrap();

        // Restart.
        let resp = restart_first_run(&pool).await.unwrap();
        assert_eq!(resp.prefilled_sources.len(), 2);

        let state = get_first_run_state(&pool).await.unwrap();
        assert!(state.completed_at.is_none());
        assert_eq!(state.last_step, "welcome");
    }

    #[tokio::test]
    async fn batch_register_partial_success() {
        let pool = setup_db().await;

        let req = RegisterSourceBatchRequest {
            sources: vec![
                RegisterSourceRequest {
                    kind: SourceKind::Raw,
                    path: "/astro/raw".to_owned(),
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                },
                RegisterSourceRequest {
                    kind: SourceKind::Raw,
                    path: "/astro/raw".to_owned(), // duplicate — will fail
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                },
            ],
        };

        let resp = register_source_batch(&pool, &req).await.unwrap();
        assert_eq!(resp.status, BatchStatus::Partial);
        assert_eq!(resp.items[0].status, ItemStatus::Success);
        assert!(resp.items[0].source_id.is_some());
        assert_eq!(resp.items[1].status, ItemStatus::Failure);
        assert!(resp.items[1].error.is_some());
    }

    #[tokio::test]
    async fn update_step_persists() {
        let pool = setup_db().await;
        update_first_run_step(&pool, "raw").await.unwrap();
        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "raw");
    }
}
