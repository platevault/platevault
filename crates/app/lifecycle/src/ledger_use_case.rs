// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `list_assets_ledger` use case (spec 002, T020 surface).
//!
//! Thin wrapper over [`LifecycleRepository::list_assets_ledger`] so callers
//! (Tauri commands, future RPC) share one entry point. Today this is a
//! pass-through; richer filtering logic (e.g. confidence-aware sorting) will
//! land here when US1 acceptance tests demand it.

use persistence_db::repositories::lifecycle::{LedgerFilter, LedgerRow, LifecycleRepository};

use crate::lifecycle_use_case::LifecycleError;

/// List ledger rows matching the supplied filter.
///
/// # Errors
/// Propagates [`LifecycleError::Persistence`] for repository failures.
pub async fn list_assets_ledger<R: LifecycleRepository + Sync>(
    repo: &R,
    filter: LedgerFilter,
) -> Result<Vec<LedgerRow>, LifecycleError> {
    Ok(repo.list_assets_ledger(filter).await?)
}
