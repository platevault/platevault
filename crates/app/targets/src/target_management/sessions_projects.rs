// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `target.sessions.list` / `target.projects.list` (spec 023 US2/US3).

use sqlx::SqlitePool;
use uuid::Uuid;

use contracts_core::targets::{
    TargetProjectItem, TargetProjectsListRequest, TargetSessionItem, TargetSessionsListRequest,
};
use contracts_core::ContractError;

use super::{db_err, invalid_id, not_found};

/// `target.sessions.list` — list acquisition sessions linked to a target (spec 023 US2).
///
/// Returns sessions ordered newest first.  Returns an empty list when the
/// target exists but has no linked sessions; returns `target.not_found` when
/// `target_id` does not exist in `canonical_target`.
///
/// # Errors
///
/// Returns [`ContractError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn sessions_list(
    pool: &SqlitePool,
    req: &TargetSessionsListRequest,
) -> Result<Vec<TargetSessionItem>, ContractError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    // Verify the target exists.
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(db_err)?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let rows =
        persistence_db::repositories::targets::list_sessions_for_target(pool, &req.target_id)
            .await
            .map_err(db_err)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let filter = filter_from_session_key(&r.session_key);
            TargetSessionItem {
                id: r.id,
                session_key: r.session_key,
                created_at: r.created_at,
                frame_count: r.frame_count,
                filter,
            }
        })
        .collect())
}

/// Extract the filter segment (2nd field) from a `session_key` of shape
/// `target|filter|binning|gain|night` (`sessions::session_key`, #739
/// FR-003/US2-AC1). Returns `""` for a malformed/legacy key rather than
/// panicking — display-only derivation, never authoritative.
fn filter_from_session_key(session_key: &str) -> String {
    session_key.split('|').nth(1).unwrap_or("").to_owned()
}

/// `target.projects.list` — list projects linked to a target (spec 023 US3).
///
/// Returns projects ordered alphabetically by name.  Returns an empty list
/// when the target exists but has no linked projects; returns `target.not_found`
/// when `target_id` does not exist.
///
/// # Errors
///
/// Returns [`ContractError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn projects_list(
    pool: &SqlitePool,
    req: &TargetProjectsListRequest,
) -> Result<Vec<TargetProjectItem>, ContractError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(db_err)?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let rows =
        persistence_db::repositories::targets::list_projects_for_target(pool, &req.target_id)
            .await
            .map_err(db_err)?;
    Ok(rows
        .into_iter()
        .map(|r| TargetProjectItem { id: r.id, name: r.name, lifecycle: r.lifecycle })
        .collect())
}
