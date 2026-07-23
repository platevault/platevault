// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `target.list` — all canonical targets (gen-3), ordered by
//! `primary_designation`.

use sqlx::SqlitePool;

use contracts_core::targets::TargetListItem;
use contracts_core::ContractError;
use targeting_resolver::cache;

use super::{db_err, list_row_to_item};

/// `target.list` — list all canonical targets (gen-3), ordered by
/// `primary_designation`.
///
/// Read-through against the whole-catalog snapshot ([`crate::caches::catalog`],
/// in-memory caching layer F0): a cache hit skips the DB round-trip entirely; a
/// miss loads from SQLite and populates the snapshot for subsequent readers
/// (including `target_search::search`, which shares this same cache).
///
/// # Errors
///
/// Returns [`ContractError`] with code `internal.database`.
pub async fn list(pool: &SqlitePool) -> Result<Vec<TargetListItem>, ContractError> {
    if let Some(cached) = crate::caches::catalog().load() {
        return Ok((*cached).clone());
    }
    let rows = cache::list_all(pool).await.map_err(db_err)?;
    // #877: attach real session counts (planner Sessions column) — a target
    // with no linked session simply keeps the DTO default of 0.
    let session_counts = session_counts_by_target(pool).await?;
    let items: Vec<TargetListItem> = rows
        .into_iter()
        .map(|row| {
            let mut item = list_row_to_item(row);
            item.session_count = session_counts.get(&item.id).copied().unwrap_or_default();
            item
        })
        .collect();
    crate::caches::store_catalog(std::sync::Arc::new(items.clone()));
    Ok(items)
}

/// `target_id -> session_count` map (#877), built from real
/// `acquisition_session` rows via `q_targets_mgmt::session_counts_by_target`.
async fn session_counts_by_target(
    pool: &SqlitePool,
) -> Result<std::collections::HashMap<String, u32>, ContractError> {
    let rows = persistence_db::repositories::q_targets_mgmt::session_counts_by_target(pool)
        .await
        .map_err(db_err)?;
    Ok(rows
        .into_iter()
        .map(|(tid, count)| (tid, u32::try_from(count.max(0)).unwrap_or(0)))
        .collect())
}
