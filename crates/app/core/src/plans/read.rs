// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `list_plans` / `get_plan` (US1).

use contracts_core::plans::{PlanDetail, PlanListRequest, PlanListResponse};
use contracts_core::ContractError;
use persistence_db::repositories::plans as repo;
use sqlx::SqlitePool;
use time::OffsetDateTime;

use super::{
    db_err, item_row_to_detail, parse_destructive_destination, parse_plan_origin, parse_plan_state,
    parse_plan_type, row_to_summary, DEFAULT_AGE_CUTOFF_DAYS,
};

// ── list_plans ────────────────────────────────────────────────────────────────

/// List plans (US1, T012).
///
/// Ordering: failed/partially_applied first, then descending creation time (R-Ret-1).
/// Default age cutoff: 90 days unless overridden by `req.created_after`.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_plans(
    pool: &SqlitePool,
    req: &PlanListRequest,
) -> Result<PlanListResponse, ContractError> {
    let state_filter = req.state_filter.clone().unwrap_or_default();
    let origin_filter = req.origin_filter.clone().unwrap_or_default();

    // Apply the age cutoff from the request or derive the default (R-Ret-1).
    let cutoff_owned;
    let created_after: Option<&str> = if let Some(ref ca) = req.created_after {
        Some(ca.as_str())
    } else {
        // Derive 90-day default cutoff.
        let cutoff = OffsetDateTime::now_utc() - time::Duration::days(DEFAULT_AGE_CUTOFF_DAYS);
        cutoff_owned = cutoff
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
        Some(cutoff_owned.as_str())
    };

    let limit = req.limit.unwrap_or(100).clamp(1, 500);

    let rows = repo::list_plans(pool, &state_filter, &origin_filter, created_after, limit)
        .await
        .map_err(db_err)?;

    let plans = rows.into_iter().map(row_to_summary).collect::<Result<Vec<_>, _>>()?;
    Ok(PlanListResponse { plans })
}

// ── get_plan ──────────────────────────────────────────────────────────────────

/// Fetch a single plan with all its items (US1, T013).
///
/// Returns `plan.not_found` if the plan does not exist or is discarded.
///
/// # Errors
///
/// Returns `ContractError` on not-found or database failure.
pub async fn get_plan(pool: &SqlitePool, plan_id: &str) -> Result<PlanDetail, ContractError> {
    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;
    let item_rows = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;

    Ok(PlanDetail {
        id: row.id,
        number: row.number,
        title: row.title,
        origin: parse_plan_origin(&row.origin),
        origin_path: row.origin_path,
        state: parse_plan_state(&row.state)?,
        plan_type: parse_plan_type(&row.plan_type),
        destructive_destination: parse_destructive_destination(&row.destructive_destination),
        parent_plan_id: row.parent_plan_id,
        items_total: row.items_total,
        items_applied: row.items_applied,
        items_failed: row.items_failed,
        items_skipped: row.items_skipped,
        items_cancelled: row.items_cancelled,
        items_pending: row.items_pending,
        total_bytes_required: row.total_bytes_required,
        approved_at: row.approved_at,
        discarded_at: row.discarded_at,
        created_at: row.created_at,
        items: item_rows.into_iter().map(item_row_to_detail).collect(),
    })
}
