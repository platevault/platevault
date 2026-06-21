//! Repository methods for settings storage (spec 018, T003).
//!
//! Operates on the `settings` and `source_overrides` tables from migration 0013.
//! Each settings key is stored as one row with a JSON-encoded value.

use contracts_core::settings::{SettingsState, SourceOverride};
use domain_core::ids::Timestamp;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::{DbError, DbResult};

// ── Helpers ──────────────────────────────────────────────────────────────

// ── Low-level key/value operations ────────────────────────────────────────

/// Read the raw JSON value for a single key. Returns `None` when no row exists.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_raw(pool: &SqlitePool, key: &str) -> DbResult<Option<Value>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    match row {
        None => Ok(None),
        Some((json,)) => {
            let v = serde_json::from_str(&json)?;
            Ok(Some(v))
        }
    }
}

/// Write (upsert) a raw JSON value for a single key.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
/// Returns [`DbError::Serialise`] if the value cannot be serialised.
pub async fn set_raw(pool: &SqlitePool, key: &str, value: &Value) -> DbResult<()> {
    let json = serde_json::to_string(value)?;
    let now = Timestamp::now_iso();

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(&json)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete a stored row for a key (used by repair to reset to default).
///
/// Idempotent — no error if the key does not exist.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_key(pool: &SqlitePool, key: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM settings WHERE key = ?").bind(key).execute(pool).await?;
    Ok(())
}

/// Read all stored settings as a list of (key, JSON value) pairs.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_all_raw(pool: &SqlitePool) -> DbResult<Vec<(String, Value)>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM settings ORDER BY key ASC").fetch_all(pool).await?;

    rows.into_iter()
        .map(|(key, json)| {
            let v = serde_json::from_str(&json)?;
            Ok((key, v))
        })
        .collect()
}

// ── High-level settings bag ───────────────────────────────────────────────

/// Load the full settings state, merging stored rows with in-code defaults.
///
/// Any key not present in the database is returned at its default value.
/// Caller is responsible for validation and repair (T019).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn load_settings(pool: &SqlitePool) -> DbResult<SettingsState> {
    let stored = get_all_raw(pool).await?;
    merge_with_defaults(stored)
}

fn merge_with_defaults(stored: Vec<(String, Value)>) -> DbResult<SettingsState> {
    let mut state = SettingsState::default();
    for (key, value) in stored {
        apply_key_to_state(&key, value, &mut state)?;
    }
    Ok(state)
}

/// Apply a single stored key/value pair to a `SettingsState`.
///
/// Returns `Err(DbError::Serialise)` if the stored JSON cannot be
/// deserialised into the expected Rust type for that key.
#[allow(clippy::too_many_lines)]
fn apply_key_to_state(key: &str, value: Value, state: &mut SettingsState) -> DbResult<()> {
    match key {
        "pattern" => {
            state.pattern = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "autoApplyPattern" => {
            state.auto_apply_pattern = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "alwaysPreviewBeforePlan" => {
            state.always_preview_before_plan =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "followSymlinks" => {
            state.follow_symlinks = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "hashOnScan" => {
            state.hash_on_scan = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "darkMatchTolerance" => {
            state.dark_match_tolerance =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "flatMatching" => {
            state.flat_matching = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "suggestCalibration" => {
            state.suggest_calibration =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "rowDensity" => {
            state.row_density = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "logLevel" => {
            state.log_level = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "rememberFollowLogs" => {
            state.remember_follow_logs =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "defaultProtection" => {
            state.default_protection = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "blockPermanentDelete" => {
            state.block_permanent_delete =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "protectedCategories" => {
            state.protected_categories =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "current_library_id" => {
            state.current_library_id = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "devMode" => {
            state.dev_mode = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "plans.list.default_age_cutoff_days" => {
            state.plans_list_default_age_cutoff_days =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "calibration.dark_temp_tolerance" => {
            state.calibration_dark_temp_tolerance =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "calibration.prefill_suggestion" => {
            state.calibration_prefill_suggestion =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "calibration.dark.override_penalty" => {
            state.calibration_dark_override_penalty =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "calibration.flat.override_penalty" => {
            state.calibration_flat_override_penalty =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "calibration.bias.override_penalty" => {
            state.calibration_bias_override_penalty =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        "imagetyp_normalization.user_mappings" => {
            state.imagetyp_normalization_user_mappings =
                serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        _ => {
            // Structured-path keys (tools.*, workflow_profile.*) are not in the
            // static SettingsState bag; they are readable via resolve_setting.
        }
    }
    Ok(())
}

// ── Per-source overrides ──────────────────────────────────────────────────

/// Upsert a per-source override.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn set_source_override(
    pool: &SqlitePool,
    source_id: &str,
    key: &str,
    value: &Value,
) -> DbResult<()> {
    let json = serde_json::to_string(value)?;
    let now = Timestamp::now_iso();

    sqlx::query(
        "INSERT INTO source_overrides (source_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(source_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(source_id)
    .bind(key)
    .bind(&json)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get the raw JSON override value for a specific source + key, if any.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_source_override_raw(
    pool: &SqlitePool,
    source_id: &str,
    key: &str,
) -> DbResult<Option<Value>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM source_overrides WHERE source_id = ? AND key = ?")
            .bind(source_id)
            .bind(key)
            .fetch_optional(pool)
            .await?;

    match row {
        None => Ok(None),
        Some((json,)) => {
            let v = serde_json::from_str(&json)?;
            Ok(Some(v))
        }
    }
}

/// List all source overrides for a given source.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_source_overrides(
    pool: &SqlitePool,
    source_id: &str,
) -> DbResult<Vec<SourceOverride>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT key, value, updated_at FROM source_overrides WHERE source_id = ? ORDER BY key ASC",
    )
    .bind(source_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(key, json, updated_at)| {
            let v: Value = serde_json::from_str(&json)?;
            Ok(SourceOverride {
                source_id: source_id.to_owned(),
                key,
                value: contracts_core::JsonAny::from(v),
                updated_at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    #[tokio::test]
    async fn get_raw_returns_none_for_missing_key() {
        let db = setup().await;
        let result = get_raw(db.pool(), "nonexistent_key").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn set_and_get_raw_roundtrip() {
        let db = setup().await;
        let value = serde_json::json!("info");
        set_raw(db.pool(), "logLevel", &value).await.unwrap();
        let loaded = get_raw(db.pool(), "logLevel").await.unwrap();
        assert_eq!(loaded, Some(value));
    }

    #[tokio::test]
    async fn set_raw_upserts_on_conflict() {
        let db = setup().await;
        set_raw(db.pool(), "logLevel", &serde_json::json!("info")).await.unwrap();
        set_raw(db.pool(), "logLevel", &serde_json::json!("debug")).await.unwrap();
        let loaded = get_raw(db.pool(), "logLevel").await.unwrap();
        assert_eq!(loaded, Some(serde_json::json!("debug")));
    }

    #[tokio::test]
    async fn delete_key_removes_stored_row() {
        let db = setup().await;
        set_raw(db.pool(), "logLevel", &serde_json::json!("debug")).await.unwrap();
        delete_key(db.pool(), "logLevel").await.unwrap();
        let loaded = get_raw(db.pool(), "logLevel").await.unwrap();
        assert!(loaded.is_none());
    }

    #[tokio::test]
    async fn load_settings_returns_defaults_when_empty() {
        let db = setup().await;
        let state = load_settings(db.pool()).await.unwrap();
        let defaults = SettingsState::default();
        assert_eq!(state.log_level, defaults.log_level);
        assert_eq!(state.follow_symlinks, defaults.follow_symlinks);
        assert_eq!(state.hash_on_scan, defaults.hash_on_scan);
    }

    #[tokio::test]
    async fn load_settings_applies_stored_values() {
        let db = setup().await;
        set_raw(db.pool(), "logLevel", &serde_json::json!("debug")).await.unwrap();
        set_raw(db.pool(), "followSymlinks", &serde_json::json!(true)).await.unwrap();
        let state = load_settings(db.pool()).await.unwrap();
        assert_eq!(state.log_level, "debug");
        assert!(state.follow_symlinks);
    }

    #[tokio::test]
    async fn source_override_roundtrip() {
        let db = setup().await;
        let value = serde_json::json!("eager");
        set_source_override(db.pool(), "source-abc", "hashOnScan", &value).await.unwrap();
        let loaded = get_source_override_raw(db.pool(), "source-abc", "hashOnScan").await.unwrap();
        assert_eq!(loaded, Some(value));
    }

    #[tokio::test]
    async fn source_override_upsert_updates_value() {
        let db = setup().await;
        set_source_override(db.pool(), "src-1", "followSymlinks", &serde_json::json!(false))
            .await
            .unwrap();
        set_source_override(db.pool(), "src-1", "followSymlinks", &serde_json::json!(true))
            .await
            .unwrap();
        let loaded = get_source_override_raw(db.pool(), "src-1", "followSymlinks").await.unwrap();
        assert_eq!(loaded, Some(serde_json::json!(true)));
    }
}
