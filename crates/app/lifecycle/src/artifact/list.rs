// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `list` — artifacts for a project, converted to `ArtifactSummary` DTOs.

use sqlx::SqlitePool;

use persistence_db::repositories::artifacts::{self as repo};

use contracts_core::tools::ArtifactSummary;

use super::row_to_summary;

/// List artifacts for a project, converted to `ArtifactSummary` DTOs.
///
/// `include_states`: if empty, defaults to `["present", "missing"]`.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn list(
    pool: &SqlitePool,
    project_id: &str,
    include_states: &[&str],
) -> Result<Vec<ArtifactSummary>, String> {
    let states: Vec<&str> = if include_states.is_empty() {
        vec!["present", "missing"]
    } else {
        include_states.to_vec()
    };

    let rows = repo::list_artifacts_for_project(pool, project_id, &states)
        .await
        .map_err(|e| format!("DB list failed: {e}"))?;

    Ok(rows.into_iter().map(row_to_summary).collect())
}
