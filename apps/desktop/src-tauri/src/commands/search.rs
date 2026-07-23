// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Global search command (spec 033, T039, FR-015).
//!
//! `search.global` is backed by a real cross-entity `SQLite` query over
//! targets/aliases/sessions/projects that reflects the query string.
//! Replaces the fixture stub from spec 029.

use app_core::search::search_global as search_global_uc;
use contracts_core::search::SearchResult;
use tauri::State;

use crate::AppState;
use contracts_core::ContractError;

/// `search.global` — performs a global search across all entity types.
///
/// Returns results ranked by relevance to `query`. The result set always
/// reflects the query string — an empty query returns recent suggestions.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn search_global(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchResult>, ContractError> {
    tracing::debug!("search.global query={query}");
    search_global_uc(state.repo.pool(), &query).await.map_err(ContractError::internal)
}
