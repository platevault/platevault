// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T041: per-project source-view destination override (FR-021b).
//!
//! Persisted as a generic settings KV row (`crates/persistence/db`'s
//! `settings` table, migration 0013) rather than a new table — this is a
//! single string per project, not a structured/typed settings field. Key
//! shape: `source_view.<project_id>.destination`.

use contracts_core::ContractError;
use sqlx::SqlitePool;

use app_core_errors::db_internal_ctx;

fn destination_override_key(project_id: &str) -> String {
    format!("source_view.{project_id}.destination")
}

/// Read the persisted per-project destination override, if any (FR-021b).
///
/// # Errors
///
/// Returns an `internal.*` error on database failure.
pub async fn get_destination_override(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Option<String>, ContractError> {
    let raw = persistence_db::repositories::settings::get_raw(
        pool,
        &destination_override_key(project_id),
    )
    .await
    .map_err(|e| db_internal_ctx(e, "read source view destination override"))?;
    Ok(raw.and_then(|v| v.as_str().map(str::to_owned)))
}

/// Persist (or clear, when `destination` is `None`) the per-project
/// destination override (FR-021b).
///
/// # Errors
///
/// Returns an `internal.*` error on database failure.
pub async fn set_destination_override(
    pool: &SqlitePool,
    project_id: &str,
    destination: Option<&str>,
) -> Result<(), ContractError> {
    let key = destination_override_key(project_id);
    match destination {
        Some(dest) => {
            persistence_db::repositories::settings::set_raw(
                pool,
                &key,
                &serde_json::Value::String(dest.to_owned()),
            )
            .await
            .map_err(|e| db_internal_ctx(e, "write source view destination override"))?;
        }
        None => {
            persistence_db::repositories::settings::delete_key(pool, &key)
                .await
                .map_err(|e| db_internal_ctx(e, "clear source view destination override"))?;
        }
    }
    Ok(())
}
