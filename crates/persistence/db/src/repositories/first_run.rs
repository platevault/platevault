//! Repository methods for spec 003 first-run source registration.
//!
//! Operates on `registered_sources` and `first_run_state` tables
//! (migration 0006).

use domain_core::first_run::{
    BatchItem, BatchStatus, FirstRunCompleteResponse, FirstRunRestartResponse,
    FirstRunStateResponse, ItemStatus, OrganizationState, RegisterSourceBatchRequest,
    RegisterSourceBatchResponse, RegisterSourceRequest, RegisterSourceResponse, ScanDepth,
    SourceKind,
};
use domain_core::ids::Timestamp;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{DbError, DbResult};

// ── Helpers ─────────────────────────────────────────────────────────────────

fn source_kind_to_str(kind: SourceKind) -> &'static str {
    // `strum::IntoStaticStr` yields the canonical snake_case strings.
    kind.into()
}

fn str_to_source_kind(s: &str) -> SourceKind {
    // `strum::EnumString` parses the canonical strings; "light_frames" and any
    // unknown value default to LightFrames (preserving prior behavior).
    s.parse().unwrap_or(SourceKind::LightFrames)
}

fn scan_depth_to_str(depth: ScanDepth) -> &'static str {
    // `strum::IntoStaticStr` yields the canonical lowercase strings.
    depth.into()
}

fn organization_state_to_str(state: OrganizationState) -> &'static str {
    match state {
        OrganizationState::Organized => "organized",
        OrganizationState::Unorganized => "unorganized",
    }
}

fn str_to_organization_state(s: &str) -> OrganizationState {
    match s {
        "organized" => OrganizationState::Organized,
        _ => OrganizationState::Unorganized,
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

/// Find all registered sources that share the given path (any kind).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn find_sources_by_path(
    pool: &SqlitePool,
    path: &str,
) -> DbResult<Vec<RegisterSourceResponse>> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, kind, path, created_at, organization_state \
         FROM registered_sources WHERE path = ?",
    )
    .bind(path)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, kind, path, created_at, org_state)| RegisterSourceResponse {
            source_id: id,
            kind: str_to_source_kind(&kind),
            path,
            created_at,
            organization_state: str_to_organization_state(&org_state),
        })
        .collect())
}

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
    let created_at = Timestamp::now_iso();
    let created_via = resolve_created_via(pool).await?;

    // Enforce inbox⇒unorganized invariant on write (spec 041, T029). Inbox
    // sources are always relocated on confirm, never catalogued in place.
    let effective_org_state = if matches!(req.kind, SourceKind::Inbox) {
        OrganizationState::Unorganized
    } else {
        req.organization_state
    };
    let org_state_str = organization_state_to_str(effective_org_state);
    sqlx::query(
        "INSERT INTO registered_sources \
         (id, kind, path, kind_subtype, scan_depth, created_at, created_via, organization_state) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(kind_str)
    .bind(&req.path)
    .bind(&req.kind_subtype)
    .bind(scan_depth_str)
    .bind(&created_at)
    .bind(created_via)
    .bind(org_state_str)
    .execute(pool)
    .await?;

    Ok(RegisterSourceResponse {
        source_id: id,
        kind: req.kind,
        path: req.path.clone(),
        created_at,
        organization_state: effective_org_state,
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
    let created_at = Timestamp::now_iso();

    let mut items: Vec<BatchItem> = Vec::with_capacity(req.sources.len());
    let mut success_count = 0usize;
    let mut failure_count = 0usize;

    let mut tx = pool.begin().await?;

    for (index, source) in req.sources.iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        let kind_str = source_kind_to_str(source.kind);
        let scan_depth_str = scan_depth_to_str(source.scan_depth);
        let org_state_str = organization_state_to_str(source.organization_state);

        let result = sqlx::query(
            "INSERT INTO registered_sources \
             (id, kind, path, kind_subtype, scan_depth, created_at, created_via, organization_state) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(kind_str)
        .bind(&source.path)
        .bind(&source.kind_subtype)
        .bind(scan_depth_str)
        .bind(&created_at)
        .bind(created_via)
        .bind(org_state_str)
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
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, kind, path, created_at, organization_state \
         FROM registered_sources ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, kind, path, created_at, org_state)| RegisterSourceResponse {
            source_id: id,
            kind: str_to_source_kind(&kind),
            path,
            created_at,
            organization_state: str_to_organization_state(&org_state),
        })
        .collect())
}

/// Read a source's organization state by its source/root id (spec 041, T029).
///
/// Returns `None` when no source row matches `source_id`. `inbox`-kind sources
/// are always stored as `unorganized` (enforced on write), so the value read
/// back here is authoritative for the per-file move-vs-catalogue decision.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_source_organization_state(
    pool: &SqlitePool,
    source_id: &str,
) -> DbResult<Option<OrganizationState>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT organization_state FROM registered_sources WHERE id = ?")
            .bind(source_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(s,)| str_to_organization_state(&s)))
}

/// Look up the absolute filesystem `path` of a `registered_sources` row by id.
///
/// Inbox plans store `from_root_id`/`to_root_id` as `registered_sources` ids
/// (the gen-3 source model). The plan executor resolves those ids to an
/// absolute root path so its path gate can anchor the plan's relative
/// source/destination paths. The legacy `library_root` table is not populated
/// by first-run registration, so the executor must consult `registered_sources`
/// to resolve a root that was added through the setup wizard.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_source_path(pool: &SqlitePool, source_id: &str) -> DbResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM registered_sources WHERE id = ?")
        .bind(source_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(p,)| p))
}

/// Look up a registered source's kind + current path by id (P6a — `roots.remap`
/// preview and `roots.remap.apply` both need the kind-and-path pair to report
/// `original_path` and to resolve sample relative paths).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_source_kind_and_path(
    pool: &SqlitePool,
    source_id: &str,
) -> DbResult<Option<(SourceKind, String)>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT kind, path FROM registered_sources WHERE id = ?")
            .bind(source_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(kind, path)| (str_to_source_kind(&kind), path)))
}

/// Set a source's organization state by id (spec 041, T030 persistence half).
///
/// Enforces the invariant that `inbox`-kind sources are always `unorganized`:
/// attempting to set an inbox source to `organized` returns
/// [`DbError::CasFailed`] with the `source.invalid_organization_state` marker
/// in the message (the app/core use-case maps this to the contract error code).
///
/// # Errors
///
/// - [`DbError::NotFound`] when no source row matches `source_id`.
/// - [`DbError::CasFailed`] when attempting to set an inbox source to organized.
/// - [`DbError::Database`] on query failure.
pub async fn set_source_organization_state(
    pool: &SqlitePool,
    source_id: &str,
    state: OrganizationState,
) -> DbResult<()> {
    // Load the source kind first so we can enforce inbox⇒unorganized.
    let kind_row: Option<(String,)> =
        sqlx::query_as("SELECT kind FROM registered_sources WHERE id = ?")
            .bind(source_id)
            .fetch_optional(pool)
            .await?;
    let Some((kind,)) = kind_row else {
        return Err(DbError::NotFound(format!("registered_source not found: {source_id}")));
    };

    if kind == "inbox" && matches!(state, OrganizationState::Organized) {
        return Err(DbError::CasFailed(
            "source.invalid_organization_state: inbox sources must be unorganized".to_owned(),
        ));
    }

    let state_str = organization_state_to_str(state);
    sqlx::query("UPDATE registered_sources SET organization_state = ? WHERE id = ?")
        .bind(state_str)
        .bind(source_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update a registered source's stored path by id (P6a — `roots.remap.apply`).
///
/// This is a metadata-only update: no files are moved, copied, or touched on
/// disk (Constitution §I — the filesystem is user-owned; the app only
/// re-points its own record of where the root now lives).
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn set_source_path(pool: &SqlitePool, source_id: &str, new_path: &str) -> DbResult<()> {
    let result = sqlx::query("UPDATE registered_sources SET path = ? WHERE id = ?")
        .bind(new_path)
        .bind(source_id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("registered_source not found: {source_id}")));
    }

    Ok(())
}

/// Read the `active` flag for every registered source, keyed by source id
/// (P6b — `roots.list` merges this into each `LibraryRoot.active`, mirroring
/// how `lastScanned` is merged from `inbox_source_groups`).
///
/// Sources with no matching row simply do not appear in the map; callers
/// should default to `true` (active) for any id absent from it.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_active_flags(
    pool: &SqlitePool,
) -> DbResult<std::collections::HashMap<String, bool>> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT id, active FROM registered_sources").fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(id, active)| (id, active != 0)).collect())
}

/// Set a registered source's `active` flag by id (P6b — `sources.set_active`).
///
/// Disabling a root excludes it from scan/ingest surfaces but does not touch
/// its history: `file_record`, `plan_items`, `inbox_items`, and session rows
/// referencing it are left completely untouched (constitution §I — a
/// visibility flag, not a deletion).
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn set_source_active(pool: &SqlitePool, source_id: &str, active: bool) -> DbResult<()> {
    let result = sqlx::query("UPDATE registered_sources SET active = ? WHERE id = ?")
        .bind(i64::from(active))
        .bind(source_id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("registered_source not found: {source_id}")));
    }

    Ok(())
}

/// Sample up to `limit` relative paths previously recorded for a root, for use
/// as `roots.remap` preview candidates.
///
/// Reads `file_record` (populated as light frames are ingested through inbox
/// plan-apply — see `app_targets::ingest_sessions`), ordered for determinism.
/// Roots with no `file_record` rows (calibration/project roots, or raw roots
/// registered directly without ever receiving an inbox ingest) simply yield an
/// empty sample set; there is no broader per-root file inventory in the
/// current schema to sample from.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn sample_relative_paths(
    pool: &SqlitePool,
    root_id: &str,
    limit: i64,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT relative_path FROM file_record WHERE root_id = ? ORDER BY relative_path ASC LIMIT ?",
    )
    .bind(root_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

/// Count dependent records referencing a root, for the `roots.delete`
/// dependents-guard (P6b, decision D8: block rather than cascade-nullify).
///
/// `registered_sources` has no FK cascade, so every table that stores a root
/// id must be checked explicitly: `inbox_items.root_id`, `plan_items.source_id`,
/// `file_record.root_id`, `acquisition_session.root_id`, and
/// `calibration_session.root_id`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn count_root_dependents(
    pool: &SqlitePool,
    root_id: &str,
) -> DbResult<domain_core::first_run::RootDependencyCounts> {
    fn to_u32(count: i64) -> u32 {
        u32::try_from(count.max(0)).unwrap_or(u32::MAX)
    }

    let inbox_items: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = ?")
        .bind(root_id)
        .fetch_one(pool)
        .await?;
    let plan_items: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM plan_items WHERE source_id = ?")
        .bind(root_id)
        .fetch_one(pool)
        .await?;
    let file_records: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM file_record WHERE root_id = ?")
        .bind(root_id)
        .fetch_one(pool)
        .await?;
    let acquisition_sessions: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM acquisition_session WHERE root_id = ?")
            .bind(root_id)
            .fetch_one(pool)
            .await?;
    let calibration_sessions: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM calibration_session WHERE root_id = ?")
            .bind(root_id)
            .fetch_one(pool)
            .await?;

    Ok(domain_core::first_run::RootDependencyCounts {
        inbox_items: to_u32(inbox_items.0),
        plan_items: to_u32(plan_items.0),
        file_records: to_u32(file_records.0),
        acquisition_sessions: to_u32(acquisition_sessions.0),
        calibration_sessions: to_u32(calibration_sessions.0),
    })
}

/// Remove a registered source by ID.
///
/// Also deletes any `inbox_items` whose `root_id` references this source so
/// that no orphaned rows remain after removal (H1 — no FK cascade in schema).
/// Callers MUST check [`count_root_dependents`] first (P6b, decision D8) —
/// this function does not itself guard against dependents; it is also used by
/// the pre-existing (dependents-free by construction) removal paths.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn remove_source(pool: &SqlitePool, id: &str) -> DbResult<()> {
    // Clean up inbox items that belong to this source before removing it.
    sqlx::query("DELETE FROM inbox_items WHERE root_id = ?").bind(id).execute(pool).await?;

    let result =
        sqlx::query("DELETE FROM registered_sources WHERE id = ?").bind(id).execute(pool).await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("registered source {id} not found")));
    }

    Ok(())
}

/// Get the current first-run wizard state.
///
/// Returns a default state (`last_step = "source_folders"`, `completed_at = None`)
/// if no row exists yet.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_first_run_state(pool: &SqlitePool) -> DbResult<FirstRunStateResponse> {
    let row: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT completed_at, last_step FROM first_run_state WHERE singleton_id = 'first_run'",
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some((completed_at, last_step)) => Ok(FirstRunStateResponse { completed_at, last_step }),
        None => {
            Ok(FirstRunStateResponse { completed_at: None, last_step: "source_folders".to_owned() })
        }
    }
}

/// Mark the first-run wizard as complete.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if preconditions are not met (at least one
/// light_frames source and one project source must be registered).
pub async fn complete_first_run(pool: &SqlitePool) -> DbResult<FirstRunCompleteResponse> {
    // Check preconditions: at least one light_frames + one project source.
    // Inbox is optional (spec 039 removed it from REQUIRED_KINDS).
    let light_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM registered_sources WHERE kind = 'light_frames'")
            .fetch_one(pool)
            .await?;
    let project_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM registered_sources WHERE kind = 'project'")
            .fetch_one(pool)
            .await?;

    if light_count.0 == 0 || project_count.0 == 0 {
        return Err(DbError::NotFound(
            "first_run.incomplete: at least one light_frames and one project source required"
                .to_owned(),
        ));
    }

    let completed_at = Timestamp::now_iso();

    // Upsert the singleton row.
    sqlx::query(
        "INSERT INTO first_run_state (singleton_id, completed_at, last_step, updated_at) \
         VALUES ('first_run', ?, 'complete', ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET completed_at = excluded.completed_at, \
         last_step = 'complete', updated_at = excluded.updated_at",
    )
    .bind(&completed_at)
    .bind(&completed_at)
    .execute(pool)
    .await?;

    // Count total registered sources for the response.
    let total_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM registered_sources").fetch_one(pool).await?;
    let registered_source_count = usize::try_from(total_count.0.max(0)).unwrap_or(0);

    Ok(FirstRunCompleteResponse { completed_at, registered_source_count })
}

/// Restart the first-run wizard (clear completed_at, return existing sources).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn restart_first_run(pool: &SqlitePool) -> DbResult<FirstRunRestartResponse> {
    let now = Timestamp::now_iso();

    // Clear completed_at and reset to welcome step.
    sqlx::query(
        "INSERT INTO first_run_state (singleton_id, completed_at, last_step, updated_at) \
         VALUES ('first_run', NULL, 'source_folders', ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET completed_at = NULL, \
         last_step = 'source_folders', updated_at = excluded.updated_at",
    )
    .bind(&now)
    .execute(pool)
    .await?;

    // Update created_via for existing sources to 'settings_restart'.
    sqlx::query("UPDATE registered_sources SET created_via = 'settings_restart'")
        .execute(pool)
        .await?;

    let sources = list_sources(pool).await?;

    Ok(FirstRunRestartResponse { restarted_at: now.clone(), prefilled_sources: sources })
}

/// Update the last_step in the first_run_state singleton.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_first_run_step(pool: &SqlitePool, step: &str) -> DbResult<()> {
    let now = Timestamp::now_iso();

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
    use domain_core::first_run::{
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
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };

        let resp = register_source(&pool, &req).await.unwrap();
        assert_eq!(resp.kind, SourceKind::LightFrames);
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
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
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
            organization_state: OrganizationState::Organized,
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
        assert_eq!(state.last_step, "source_folders");
        assert!(state.completed_at.is_none());
    }

    #[tokio::test]
    async fn complete_first_run_requires_light_and_project() {
        let pool = setup_db().await;

        // No sources: should fail.
        let result = complete_first_run(&pool).await;
        assert!(result.is_err());

        // Only light_frames: should fail (project missing).
        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &req).await.unwrap();
        let result = complete_first_run(&pool).await;
        assert!(result.is_err());

        // Add project: light + project present — inbox is not required (spec 039).
        let req = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &req).await.unwrap();
        let resp = complete_first_run(&pool).await.unwrap();
        assert!(!resp.completed_at.is_empty());

        // Verify state updated.
        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "complete");
        assert!(state.completed_at.is_some());
    }

    #[tokio::test]
    async fn restart_first_run_clears_completed_at() {
        let pool = setup_db().await;

        let raw = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/lights".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let proj = RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let inbox = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        register_source(&pool, &raw).await.unwrap();
        register_source(&pool, &proj).await.unwrap();
        register_source(&pool, &inbox).await.unwrap();
        complete_first_run(&pool).await.unwrap();

        let resp = restart_first_run(&pool).await.unwrap();
        assert_eq!(resp.prefilled_sources.len(), 3);

        let state = get_first_run_state(&pool).await.unwrap();
        assert!(state.completed_at.is_none());
        assert_eq!(state.last_step, "source_folders");
    }

    #[tokio::test]
    async fn batch_register_partial_success() {
        let pool = setup_db().await;

        let req = RegisterSourceBatchRequest {
            sources: vec![
                RegisterSourceRequest {
                    kind: SourceKind::LightFrames,
                    path: "/astro/raw".to_owned(),
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                    organization_state: OrganizationState::Organized,
                },
                RegisterSourceRequest {
                    kind: SourceKind::LightFrames,
                    path: "/astro/raw".to_owned(), // duplicate — will fail
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                    organization_state: OrganizationState::Organized,
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
        update_first_run_step(&pool, "processing_tools").await.unwrap();
        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "processing_tools");
    }

    /// C2: `complete_first_run` must succeed with only light_frames + project
    /// (no inbox source required — spec 039 removed inbox from REQUIRED_KINDS).
    #[tokio::test]
    async fn complete_first_run_succeeds_without_inbox() {
        let pool = setup_db().await;

        register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/lights".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Project,
                path: "/astro/projects".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        // No inbox registered — must succeed now.
        let resp = complete_first_run(&pool).await.unwrap();
        assert!(!resp.completed_at.is_empty(), "completed_at must be set");
        assert_eq!(resp.registered_source_count, 2);

        let state = get_first_run_state(&pool).await.unwrap();
        assert_eq!(state.last_step, "complete");
    }

    /// C2 boundary: still fails when only light_frames is registered (project missing).
    #[tokio::test]
    async fn complete_first_run_still_requires_light_and_project() {
        let pool = setup_db().await;

        register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/lights".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        let err = complete_first_run(&pool).await;
        assert!(err.is_err(), "should fail without a project source");
    }

    /// H1: `remove_source` must delete orphaned `inbox_items` for the removed
    /// source so no zombie rows remain.
    #[tokio::test]
    async fn remove_source_deletes_inbox_items() {
        use crate::repositories::inbox::{insert_inbox_item, InsertInboxItem};

        let pool = setup_db().await;

        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Unorganized,
            },
        )
        .await
        .unwrap();
        let source_id = resp.source_id;

        // Insert an inbox item for this source.
        insert_inbox_item(
            &pool,
            &InsertInboxItem {
                id: "orphan-item-1",
                root_id: &source_id,
                relative_path: "2025-10-01/lights",
                file_count: 3,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        // Verify it exists.
        let count_before: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = ?")
                .bind(&source_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count_before.0, 1, "inbox item should exist before removal");

        // Remove the source.
        remove_source(&pool, &source_id).await.unwrap();

        // Inbox items for that root must be gone.
        let count_after: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = ?")
                .bind(&source_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count_after.0, 0, "inbox items must be deleted with the source");
    }

    // ── spec 041 US4: organization-state read/write ──────────────────────────

    #[tokio::test]
    async fn inbox_source_always_unorganized_on_write() {
        let pool = setup_db().await;
        // Even if the caller requests `organized`, an inbox source is stored as
        // `unorganized` (T029 invariant).
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();
        assert!(matches!(resp.organization_state, OrganizationState::Unorganized));

        let read = get_source_organization_state(&pool, &resp.source_id).await.unwrap();
        assert_eq!(read, Some(OrganizationState::Unorganized));
    }

    #[tokio::test]
    async fn set_org_state_rejects_inbox_organized() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Unorganized,
            },
        )
        .await
        .unwrap();

        let err =
            set_source_organization_state(&pool, &resp.source_id, OrganizationState::Organized)
                .await
                .unwrap_err();
        match err {
            DbError::CasFailed(msg) => {
                assert!(msg.contains("source.invalid_organization_state"), "got: {msg}");
            }
            other => panic!("expected CasFailed, got {other:?}"),
        }

        // State unchanged.
        let read = get_source_organization_state(&pool, &resp.source_id).await.unwrap();
        assert_eq!(read, Some(OrganizationState::Unorganized));
    }

    #[tokio::test]
    async fn set_org_state_round_trips_for_non_inbox() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/lights".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        // Flip organized → unorganized and back.
        set_source_organization_state(&pool, &resp.source_id, OrganizationState::Unorganized)
            .await
            .unwrap();
        assert_eq!(
            get_source_organization_state(&pool, &resp.source_id).await.unwrap(),
            Some(OrganizationState::Unorganized)
        );

        set_source_organization_state(&pool, &resp.source_id, OrganizationState::Organized)
            .await
            .unwrap();
        assert_eq!(
            get_source_organization_state(&pool, &resp.source_id).await.unwrap(),
            Some(OrganizationState::Organized)
        );
    }

    #[tokio::test]
    async fn set_org_state_not_found() {
        let pool = setup_db().await;
        let err = set_source_organization_state(&pool, "nope", OrganizationState::Organized)
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
    }

    // ── P6a: root remap repository functions ────────────────────────────────

    #[tokio::test]
    async fn get_source_kind_and_path_roundtrips() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        let (kind, path) = get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(kind, SourceKind::LightFrames);
        assert_eq!(path, "/astro/raw");
    }

    #[tokio::test]
    async fn get_source_kind_and_path_missing_returns_none() {
        let pool = setup_db().await;
        let result = get_source_kind_and_path(&pool, "nonexistent-id").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn set_source_path_updates_row() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        set_source_path(&pool, &resp.source_id, "/mnt/new/raw").await.unwrap();

        let (_, path) = get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
        assert_eq!(path, "/mnt/new/raw");
    }

    #[tokio::test]
    async fn set_source_path_missing_returns_not_found() {
        let pool = setup_db().await;
        let result = set_source_path(&pool, "nonexistent-id", "/mnt/new").await;
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[tokio::test]
    async fn sample_relative_paths_empty_when_no_file_records() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Calibration,
                path: "/astro/cals".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        let samples = sample_relative_paths(&pool, &resp.source_id, 5).await.unwrap();
        assert!(samples.is_empty());
    }

    #[tokio::test]
    async fn sample_relative_paths_respects_limit_and_order() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        // `file_record.root_id` FKs the legacy `library_root` table, not
        // `registered_sources` (see `app_targets::ingest_sessions` doc
        // comment). The real ingest pipeline mirrors the `registered_sources`
        // row into `library_root` under the SAME id before inserting
        // `file_record` rows; mirror that here so the FK constraint holds.
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

        for (i, relative_path) in
            ["M31/light_003.fits", "M31/light_001.fits", "M31/light_002.fits"].iter().enumerate()
        {
            sqlx::query(
                "INSERT INTO file_record \
                 (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
                 VALUES (?, ?, ?, 0, '2026-01-01T00:00:00Z', 'observed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            )
            .bind(format!("fr-{i}"))
            .bind(&resp.source_id)
            .bind(relative_path)
            .execute(&pool)
            .await
            .unwrap();
        }

        let samples = sample_relative_paths(&pool, &resp.source_id, 2).await.unwrap();
        assert_eq!(samples, vec!["M31/light_001.fits", "M31/light_002.fits"]);
    }

    // ── P6b: active flag repository functions ────────────────────────────────

    #[tokio::test]
    async fn new_sources_default_active() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        let flags = list_active_flags(&pool).await.unwrap();
        assert_eq!(flags.get(&resp.source_id), Some(&true));
    }

    #[tokio::test]
    async fn set_source_active_round_trips() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        set_source_active(&pool, &resp.source_id, false).await.unwrap();
        let flags = list_active_flags(&pool).await.unwrap();
        assert_eq!(flags.get(&resp.source_id), Some(&false));

        set_source_active(&pool, &resp.source_id, true).await.unwrap();
        let flags = list_active_flags(&pool).await.unwrap();
        assert_eq!(flags.get(&resp.source_id), Some(&true));
    }

    #[tokio::test]
    async fn set_source_active_missing_returns_not_found() {
        let pool = setup_db().await;
        let result = set_source_active(&pool, "nonexistent-id", false).await;
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    // ── P6b: root dependents repository function ─────────────────────────────

    #[tokio::test]
    async fn count_root_dependents_all_zero_for_fresh_source() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Project,
                path: "/astro/projects".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
        assert!(counts.is_empty(), "fresh source should have zero dependents: {counts:?}");
        assert_eq!(counts.total(), 0);
    }

    #[tokio::test]
    async fn count_root_dependents_counts_inbox_items() {
        use crate::repositories::inbox::{insert_inbox_item, InsertInboxItem};

        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Unorganized,
            },
        )
        .await
        .unwrap();

        insert_inbox_item(
            &pool,
            &InsertInboxItem {
                id: "item-1",
                root_id: &resp.source_id,
                relative_path: "2026-01-01/lights",
                file_count: 5,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
        assert_eq!(counts.inbox_items, 1);
        assert_eq!(counts.total(), 1);
        assert!(!counts.is_empty());
    }

    #[tokio::test]
    async fn count_root_dependents_counts_sessions_and_file_records() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        // `file_record.root_id`/`acquisition_session.root_id` FK the legacy
        // `library_root` table (mirrored under the SAME id — see
        // `sample_relative_paths_respects_limit_and_order` above).
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
             VALUES ('fr-1', ?, 'M31/light_001.fits', 0, '2026-01-01T00:00:00Z', 'observed', \
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(&resp.source_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, root_id, created_at) \
             VALUES ('acq-1', 'sess-key-1', ?, '2026-01-01T00:00:00Z')",
        )
        .bind(&resp.source_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calibration_session (id, session_key, kind, root_id, created_at) \
             VALUES ('cal-1', 'cal-key-1', 'dark', ?, '2026-01-01T00:00:00Z')",
        )
        .bind(&resp.source_id)
        .execute(&pool)
        .await
        .unwrap();

        let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
        assert_eq!(counts.file_records, 1);
        assert_eq!(counts.acquisition_sessions, 1);
        assert_eq!(counts.calibration_sessions, 1);
        assert_eq!(counts.plan_items, 0);
        assert_eq!(counts.total(), 3);
    }

    #[tokio::test]
    async fn count_root_dependents_counts_plan_items() {
        let pool = setup_db().await;
        let resp = register_source(
            &pool,
            &RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Unorganized,
            },
        )
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO plans (id, number, title, origin, state, plan_type, created_at) \
             VALUES ('plan-1', 1, 'Test plan', 'inbox', 'draft', 'restructure', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO plan_items \
             (id, plan_id, item_index, name, action, created_at, source_id) \
             VALUES ('pi-1', 'plan-1', 0, 'item', 'move', '2026-01-01T00:00:00Z', ?)",
        )
        .bind(&resp.source_id)
        .execute(&pool)
        .await
        .unwrap();

        let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
        assert_eq!(counts.plan_items, 1);
        assert_eq!(counts.total(), 1);
    }
}

// ── DB byte-identity guard (spec 042 T254) ───────────────────────────────
//
// `register_source` persists `SourceKind` / `ScanDepth` via their
// `strum::IntoStaticStr` impls and reads them back via `EnumString`. T254
// moved these enums from `contracts_core` to `domain_core`; the persisted
// strings (`light_frames`, `calibration`, `project`, `inbox`, `recursive`,
// `single`) MUST stay byte-identical (Local-First custody). This freezes the
// stored-string contract end-to-end through the real `registered_sources`
// table.
#[cfg(test)]
mod byte_identity_guard {
    use domain_core::first_run::{RegisterSourceRequest, ScanDepth, SourceKind};

    use super::*;
    use crate::Database;

    #[test]
    fn source_kind_helper_strings_unchanged() {
        assert_eq!(source_kind_to_str(SourceKind::LightFrames), "light_frames");
        assert_eq!(source_kind_to_str(SourceKind::Calibration), "calibration");
        assert_eq!(source_kind_to_str(SourceKind::Project), "project");
        assert_eq!(source_kind_to_str(SourceKind::Inbox), "inbox");
    }

    #[test]
    fn scan_depth_helper_strings_unchanged() {
        assert_eq!(scan_depth_to_str(ScanDepth::Recursive), "recursive");
        assert_eq!(scan_depth_to_str(ScanDepth::Single), "single");
    }

    /// Register a source and assert the raw persisted `kind` / `scan_depth`
    /// column strings are the exact canonical values.
    #[tokio::test]
    async fn registered_source_columns_persist_canonical_strings() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool();

        let resp = register_source(
            pool,
            &RegisterSourceRequest {
                kind: SourceKind::Calibration,
                path: "/astro/cals".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Single,
                organization_state: OrganizationState::Unorganized,
            },
        )
        .await
        .unwrap();

        let row: (String, String) =
            sqlx::query_as("SELECT kind, scan_depth FROM registered_sources WHERE id = ?")
                .bind(&resp.source_id)
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(row.0, "calibration", "stored kind string changed");
        assert_eq!(row.1, "single", "stored scan_depth string changed");
    }
}
