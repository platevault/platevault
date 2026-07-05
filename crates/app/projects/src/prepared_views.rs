//! Spec 026 use cases: remove and regenerate a generated project source view.
//!
//! Entry points:
//! - `list_views`          — list all prepared source views for a project.
//! - `remove_prepared_view`  — create a `ViewRemovalPlan` (plan_kind =
//!   `SourceViewRemove`, origin = `prepared_view_removal`). Routes through
//!   the full spec 017/025 plan pipeline.
//! - `regenerate_prepared_view` — create a `ViewRegenerationPlan` (origin =
//!   `prepared_view_regeneration`). Resolves current inventory paths for
//!   preserved membership.
//!
//! # Spec compliance
//! - R-026-Lifecycle: both ops refuse `archived` projects with
//!   `lifecycle.read_only`.
//! - R-026-Dest-Archive: destructive destination is always `archive`; no
//!   `destructiveDestination` field is accepted.
//! - R-026-Strategies: only `symlink`, `junction`, `copy` are supported in v1.
//!   `hardlink` is refused with `view.unsupported_kind`.
//! - FR-008 / A2: `view.mixed_kind` is returned when `PreparedSourceView.kind`
//!   disagrees with any item's `materialization`.
//! - A4: removed views are never hard-deleted; regeneration always available.
//! - R-026-Pipeline: the plan enters the standard spec 017/025 review pipeline.
//! - T004 invariant: plan actions are restricted to recorded view paths only.

use contracts_core::prepared_views::{
    PreparedViewItemDetail, PreparedViewListResponse, PreparedViewRegenerateResponse,
    PreparedViewRemoveResponse, PreparedViewSummary,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::new_id;
use domain_core::lifecycle::prepared_source::ALLOWED_PROJECT_STATES_FOR_VIEW_OPS;
use persistence_db::repositories::{
    plans as plans_repo, prepared_source_views as views_repo, projects as projects_repo,
};
use sqlx::SqlitePool;

use app_core_errors::db_internal_ctx;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ViewNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => app_core_errors::db_err(other),
    }
}

pub(crate) fn project_db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ProjectNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => ContractError::new(
            ErrorCode::InternalDatabase,
            format!("{other}"),
            ErrorSeverity::Fatal,
            true,
        ),
    }
}

/// Check that the owning project's lifecycle is in the allowed set for view
/// operations (R-026-Lifecycle). Returns `lifecycle.read_only` for `archived`.
///
/// `pub(crate)`: reused by `source_view_generate` (spec 049) — generation
/// shares the same lifecycle gate as removal/regeneration.
pub(crate) async fn check_project_lifecycle(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<(), ContractError> {
    let project = projects_repo::get_project(pool, project_id).await.map_err(project_db_err)?;

    if ALLOWED_PROJECT_STATES_FOR_VIEW_OPS.contains(&project.lifecycle.as_str()) {
        Ok(())
    } else {
        Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            format!(
                "Project lifecycle '{}' does not permit view operations. \
                 Use the unarchive path (spec 009) to make the project ready first.",
                project.lifecycle
            ),
            ErrorSeverity::Blocking,
            false,
        ))
    }
}

// ── list_views ────────────────────────────────────────────────────────────────

/// List all prepared source views for a project.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_views(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<PreparedViewListResponse, ContractError> {
    let rows = views_repo::list_views_for_project(pool, project_id).await.map_err(db_err)?;

    let mut views = Vec::with_capacity(rows.len());
    for row in rows {
        let raw_items = views_repo::list_view_items(pool, &row.id).await.map_err(db_err)?;
        let item_count = i64::try_from(raw_items.len()).unwrap_or(i64::MAX);
        let items: Vec<PreparedViewItemDetail> = raw_items
            .into_iter()
            .map(|it| PreparedViewItemDetail {
                id: it.id,
                inventory_item_id: it.inventory_item_id,
                view_relative_path: it.view_relative_path,
                materialization: it.materialization,
                last_observed_state: it.last_observed_state,
            })
            .collect();
        views.push(PreparedViewSummary {
            id: row.id,
            project_id: row.project_id,
            kind: row.kind,
            state: row.state,
            created_at: row.created_at,
            removed_at: row.removed_at,
            item_count,
            items,
        });
    }

    Ok(PreparedViewListResponse { views })
}

// ── remove_prepared_view ──────────────────────────────────────────────────────

/// Create a `ViewRemovalPlan` for the given prepared source view.
///
/// Validates:
/// 1. Project lifecycle is in the allowed set (not `archived`).
/// 2. View exists and is not in `kind_diverged` state.
/// 3. All items use a v1-supported kind (not `hardlink`).
/// 4. `view.kind` matches every item's `materialization` (A2 / FR-008).
///
/// The produced plan has:
/// - `origin = "prepared_view_removal"`
/// - `plan_type = "source_view_removal"`
/// - `destructive_destination = "archive"` (hard-coded, R-026-Dest-Archive)
/// - One `archive` action per view item, restricted to recorded view paths
///   (T004 invariant: no inventory paths are targeted).
///
/// # Errors
///
/// Returns `view.not_found`, `view.mixed_kind`, `view.unsupported_kind`,
/// `lifecycle.read_only`, or an `internal.*` error on failure.
pub async fn remove_prepared_view(
    pool: &SqlitePool,
    view_id: &str,
) -> Result<PreparedViewRemoveResponse, ContractError> {
    // 1. Fetch the view.
    let view_row = views_repo::get_view(pool, view_id).await.map_err(db_err)?;

    // 2. Check project lifecycle.
    check_project_lifecycle(pool, &view_row.project_id).await?;

    // 3. Block kind_diverged — user must resolve via UI first (D-026-H2).
    if view_row.state == "kind_diverged" {
        return Err(ContractError::new(
            ErrorCode::ViewMixedKind,
            "The view has a kind_diverged state. Resolve the kind mismatch via the \
             UI before attempting removal.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Fetch items.
    let items = views_repo::list_view_items(pool, view_id).await.map_err(db_err)?;

    // 5. Refuse hardlink (R-026-Strategies).
    if view_row.kind == "hardlink" || items.iter().any(|i| i.materialization == "hardlink") {
        return Err(ContractError::new(
            ErrorCode::ViewUnsupportedKind,
            "The 'hardlink' view strategy is not supported in v1. \
             Hardlink removal is deferred to v1.x.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 6. Refuse mixed-kind views (A2 / FR-008).
    let kind_mismatch = items.iter().any(|i| i.materialization != view_row.kind);
    if kind_mismatch {
        return Err(ContractError::new(
            ErrorCode::ViewMixedKind,
            "The view contains items whose materialization kind does not match the \
             view's recorded kind. Resolve the mismatch before removing.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 7. Build the removal plan.
    let plan_id = new_id();
    let title = format!("Remove source view {view_id}");

    plans_repo::insert_plan(
        pool,
        &plans_repo::InsertPlan {
            id: &plan_id,
            title: &title,
            origin: "prepared_view_removal",
            origin_path: Some(view_id),
            plan_type: "source_view_removal",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .map_err(|e| db_internal_ctx(e, "insert prepared view plan"))?;

    // 8. One archive action per item, targeting only the view's recorded paths
    //    (T004: actions restricted to view membership — no inventory paths).
    for (idx, item) in items.iter().enumerate() {
        let item_plan_id = new_id();
        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &item_plan_id,
                plan_id: &plan_id,
                item_index: i64::try_from(idx).unwrap_or(i64::MAX),
                name: &item.view_relative_path,
                action: "archive",
                from_root_id: None,
                from_relative_path: &item.view_relative_path,
                to_root_id: None,
                to_relative_path: "",
                reason: "view_removal",
                protection: "normal",
                linked_entity: Some(view_id),
                provenance_json: None,
                archive_path: None,
                // View removal items target app-generated view paths, not user data
                // sources, so source protection does not apply here.
                source_id: None,
                category: None,
            },
        )
        .await
        .map_err(|e| db_internal_ctx(e, "insert prepared view plan item"))?;
    }

    // 9. Advance plan to ready_for_review so it appears in the review UI.
    plans_repo::update_plan_state(pool, &plan_id, "ready_for_review")
        .await
        .map_err(|e| db_internal_ctx(e, "advance prepared view plan to ready_for_review"))?;

    Ok(PreparedViewRemoveResponse { plan_id })
}

// ── regenerate_prepared_view ──────────────────────────────────────────────────

/// Create a `ViewRegenerationPlan` for a previously prepared (possibly removed)
/// source view.
///
/// Resolves each item's `inventory_item_id` against the current inventory.
/// Unresolved references are counted and surfaced as `unresolved_item_count`
/// in the response; the plan still proceeds with the resolvable items so the
/// user can review warnings before applying.
///
/// Validates:
/// 1. Project lifecycle is allowed (not `archived`).
/// 2. View exists (records are never deleted — A4).
/// 3. View is not `kind_diverged`.
/// 4. No `hardlink` items (v1 restriction).
///
/// # Errors
///
/// Returns `view.not_found`, `view.mixed_kind`, `view.unsupported_kind`,
/// `lifecycle.read_only`, or `internal.*` on failure.
pub async fn regenerate_prepared_view(
    pool: &SqlitePool,
    view_id: &str,
) -> Result<PreparedViewRegenerateResponse, ContractError> {
    // 1. Fetch the view.
    let view_row = views_repo::get_view(pool, view_id).await.map_err(db_err)?;

    // 2. Check project lifecycle.
    check_project_lifecycle(pool, &view_row.project_id).await?;

    // 3. Block kind_diverged.
    if view_row.state == "kind_diverged" {
        return Err(ContractError::new(
            ErrorCode::ViewMixedKind,
            "The view has a kind_diverged state. Resolve the kind mismatch before \
             regenerating.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Fetch items (membership preserved regardless of state — A4).
    let items = views_repo::list_view_items(pool, view_id).await.map_err(db_err)?;

    // 5. Refuse hardlink.
    if view_row.kind == "hardlink" || items.iter().any(|i| i.materialization == "hardlink") {
        return Err(ContractError::new(
            ErrorCode::ViewUnsupportedKind,
            "The 'hardlink' view strategy is not supported in v1.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 6. Resolve each inventory item against the current inventory.
    //    Items whose inventory_item_id cannot be found are counted as unresolved.
    let mut unresolved_count: u32 = 0;
    let mut resolved_items: Vec<&views_repo::PreparedSourceViewItemRow> = Vec::new();

    for item in &items {
        // Check inventory resolution against the file_record table.
        let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM file_record WHERE id = ?")
            .bind(&item.inventory_item_id)
            .fetch_one(pool)
            .await
            .unwrap_or(false);

        if exists {
            resolved_items.push(item);
        } else {
            unresolved_count += 1;
        }
    }

    // 7. Build the regeneration plan.
    let plan_id = new_id();
    let title = format!("Regenerate source view {view_id}");

    plans_repo::insert_plan(
        pool,
        &plans_repo::InsertPlan {
            id: &plan_id,
            title: &title,
            origin: "prepared_view_regeneration",
            origin_path: Some(view_id),
            plan_type: "source_view_regeneration",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .map_err(|e| db_internal_ctx(e, "insert prepared view plan"))?;

    // 8. One link action per resolved item.
    for (idx, item) in resolved_items.iter().enumerate() {
        let item_plan_id = new_id();
        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &item_plan_id,
                plan_id: &plan_id,
                item_index: i64::try_from(idx).unwrap_or(i64::MAX),
                name: &item.view_relative_path,
                action: "link",
                from_root_id: None,
                from_relative_path: &item.inventory_item_id,
                to_root_id: None,
                to_relative_path: &item.view_relative_path,
                reason: "view_regeneration",
                protection: "normal",
                linked_entity: Some(view_id),
                provenance_json: None,
                archive_path: None,
                // View regeneration items target app-generated view paths.
                source_id: None,
                category: None,
            },
        )
        .await
        .map_err(|e| db_internal_ctx(e, "insert prepared view plan item"))?;
    }

    // 9. Advance to ready_for_review.
    plans_repo::update_plan_state(pool, &plan_id, "ready_for_review")
        .await
        .map_err(|e| db_internal_ctx(e, "advance prepared view plan to ready_for_review"))?;

    Ok(PreparedViewRegenerateResponse { plan_id, unresolved_item_count: unresolved_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::prepared_source_views as views_repo;
    use persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    /// Insert a minimal project row suitable for testing.
    async fn insert_project(db: &Database, id: &str, lifecycle: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at)
             VALUES (?, ?, 'PixInsight', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(lifecycle)
        .bind(format!("projects/{id}"))
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_view_with_items(db: &Database, view_id: &str, project_id: &str, kind: &str) {
        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView { id: view_id, project_id, kind },
        )
        .await
        .unwrap();

        views_repo::insert_view_item(
            db.pool(),
            &views_repo::InsertPreparedSourceViewItem {
                id: &format!("{view_id}-item-1"),
                view_id,
                inventory_item_id: "inv-1",
                view_relative_path: "Sources/M31_001.fit",
                materialization: kind,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn remove_creates_plan_for_ready_project() {
        let db = setup().await;
        insert_project(&db, "p-ready", "ready").await;
        insert_view_with_items(&db, "view-r", "p-ready", "symlink").await;

        let resp = remove_prepared_view(db.pool(), "view-r").await.unwrap();
        assert!(!resp.plan_id.is_empty());

        // Plan should exist in ready_for_review state.
        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.state, "ready_for_review");
        assert_eq!(plan.origin, "prepared_view_removal");
        assert_eq!(plan.plan_type, "source_view_removal");
        assert_eq!(plan.destructive_destination, "archive");
    }

    #[tokio::test]
    async fn remove_refuses_archived_project() {
        let db = setup().await;
        insert_project(&db, "p-arch", "archived").await;
        insert_view_with_items(&db, "view-a", "p-arch", "symlink").await;

        let err = remove_prepared_view(db.pool(), "view-a").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn remove_refuses_hardlink() {
        let db = setup().await;
        insert_project(&db, "p-hl", "ready").await;
        insert_view_with_items(&db, "view-hl", "p-hl", "hardlink").await;

        let err = remove_prepared_view(db.pool(), "view-hl").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ViewUnsupportedKind);
    }

    #[tokio::test]
    async fn remove_refuses_kind_diverged() {
        let db = setup().await;
        insert_project(&db, "p-kd", "ready").await;
        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView {
                id: "view-kd",
                project_id: "p-kd",
                kind: "symlink",
            },
        )
        .await
        .unwrap();
        views_repo::update_view_state(db.pool(), "view-kd", "kind_diverged").await.unwrap();

        let err = remove_prepared_view(db.pool(), "view-kd").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ViewMixedKind);
    }

    #[tokio::test]
    async fn remove_view_not_found() {
        let db = setup().await;
        let err = remove_prepared_view(db.pool(), "nonexistent").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ViewNotFound);
    }

    #[tokio::test]
    async fn remove_plan_items_restricted_to_view_paths() {
        let db = setup().await;
        insert_project(&db, "p-inv", "ready").await;
        insert_view_with_items(&db, "view-inv", "p-inv", "copy").await;

        let resp = remove_prepared_view(db.pool(), "view-inv").await.unwrap();

        // Plan items should only reference view_relative_path, not inventory paths.
        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].from_relative_path, "Sources/M31_001.fit");
        assert_eq!(items[0].action, "archive");
        // linked_entity must point to the view, not to inventory.
        assert_eq!(items[0].linked_entity.as_deref(), Some("view-inv"));
    }

    #[tokio::test]
    async fn regenerate_creates_plan_for_ready_project() {
        let db = setup().await;
        insert_project(&db, "p-regen", "ready").await;
        insert_view_with_items(&db, "view-rg", "p-regen", "symlink").await;

        let resp = regenerate_prepared_view(db.pool(), "view-rg").await.unwrap();
        assert!(!resp.plan_id.is_empty());

        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.origin, "prepared_view_regeneration");
        assert_eq!(plan.plan_type, "source_view_regeneration");
    }

    #[tokio::test]
    async fn regenerate_surfaces_unresolved_count() {
        let db = setup().await;
        insert_project(&db, "p-unres", "ready").await;
        // Item references an inventory item that does not exist.
        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView {
                id: "view-unres",
                project_id: "p-unres",
                kind: "symlink",
            },
        )
        .await
        .unwrap();
        views_repo::insert_view_item(
            db.pool(),
            &views_repo::InsertPreparedSourceViewItem {
                id: "item-gone",
                view_id: "view-unres",
                inventory_item_id: "inv-missing",
                view_relative_path: "Sources/gone.fit",
                materialization: "symlink",
            },
        )
        .await
        .unwrap();

        let resp = regenerate_prepared_view(db.pool(), "view-unres").await.unwrap();
        assert_eq!(resp.unresolved_item_count, 1);
    }

    #[tokio::test]
    async fn regenerate_refuses_archived_project() {
        let db = setup().await;
        insert_project(&db, "p-arch2", "archived").await;
        insert_view_with_items(&db, "view-arch2", "p-arch2", "symlink").await;

        let err = regenerate_prepared_view(db.pool(), "view-arch2").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn list_views_returns_all_for_project() {
        let db = setup().await;
        insert_project(&db, "p-list", "ready").await;
        insert_view_with_items(&db, "v1", "p-list", "symlink").await;
        insert_view_with_items(&db, "v2", "p-list", "copy").await;

        let resp = list_views(db.pool(), "p-list").await.unwrap();
        assert_eq!(resp.views.len(), 2);
        assert!(resp.views.iter().all(|v| v.item_count == 1));
    }
}
