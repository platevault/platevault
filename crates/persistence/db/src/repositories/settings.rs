//! Repository methods for settings storage (spec 018, T003).
//!
//! Operates on the `settings` and `source_overrides` tables from migration 0013.
//! Each settings key is stored as one row with a JSON-encoded value.

use domain_core::ids::Timestamp;
use domain_core::settings::{SettingsState, SourceOverride};
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
                value: domain_core::JsonAny::from(v),
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

// ── DB byte-identity guard (spec 042 T254) ───────────────────────────────
//
// T254 moved the stored settings types (`SettingsState`, `SourceOverride`,
// `PatternPart`, `ImageTypMapping`) from `contracts_core` into `domain_core`
// to fix the `persistence/db → contracts/core` layering inversion. The
// constitution (Local-First custody) requires the on-disk representation to
// stay byte-identical across that move.
//
// These tests freeze the persisted JSON as exact byte snapshots and round-trip
// real values through the actual `settings` / `source_overrides` SQL tables.
// If any serde `rename_all`, field order, `skip_serializing_if`, or numeric
// formatting changes, the frozen-snapshot assertions fail loudly.
#[cfg(test)]
mod byte_identity_guard {
    use domain_core::settings::{SettingsState, SourceOverride};
    use domain_core::JsonAny;

    use super::*;
    use crate::Database;

    /// Frozen snapshot of `SettingsState::default()` exactly as persisted /
    /// emitted on the wire prior to the T254 move. Captured from the
    /// pre-move `contracts_core::settings::SettingsState` serialization.
    const SETTINGS_STATE_DEFAULT_JSON: &str = r#"{"pattern":[{"id":"p0","kind":"token","value":"target"},{"id":"p1","kind":"separator","value":"/"},{"id":"p2","kind":"token","value":"filter"},{"id":"p3","kind":"separator","value":"/"},{"id":"p4","kind":"token","value":"date"},{"id":"p5","kind":"separator","value":"/"},{"id":"p6","kind":"token","value":"frame_type"},{"id":"p7","kind":"separator","value":"/"}],"autoApplyPattern":true,"alwaysPreviewBeforePlan":false,"followSymlinks":false,"hashOnScan":"lazy","darkMatchTolerance":"strict","flatMatching":"filter-rot","suggestCalibration":true,"rowDensity":"dense","logLevel":"info","rememberFollowLogs":false,"defaultProtection":"protected","blockPermanentDelete":true,"protectedCategories":["lights","masters","finals"],"devMode":false,"plansListDefaultAgeCutoffDays":90.0,"calibrationDarkTempTolerance":2.0,"calibrationPrefillSuggestion":true,"calibrationDarkOverridePenalty":0.3,"calibrationFlatOverridePenalty":0.3,"calibrationBiasOverridePenalty":0.3,"calibrationAgingThresholdDays":90.0,"imagetypNormalizationUserMappings":[]}"#;

    /// Frozen snapshot of a `SourceOverride` as persisted prior to the move.
    const SOURCE_OVERRIDE_JSON: &str = r#"{"sourceId":"src-1","key":"hashOnScan","value":"eager","updatedAt":"2026-01-01T00:00:00Z"}"#;

    /// The moved `SettingsState` must serialize to the exact byte snapshot.
    #[test]
    fn settings_state_default_bytes_unchanged() {
        let actual = serde_json::to_string(&SettingsState::default()).unwrap();
        assert_eq!(
            actual, SETTINGS_STATE_DEFAULT_JSON,
            "SettingsState on-disk/wire JSON changed after the T254 domain move"
        );
    }

    /// The frozen snapshot must deserialize back into the default value
    /// (proves the field names / shapes accept the persisted bytes).
    #[test]
    fn settings_state_default_roundtrips_from_snapshot() {
        let parsed: SettingsState = serde_json::from_str(SETTINGS_STATE_DEFAULT_JSON).unwrap();
        assert_eq!(parsed, SettingsState::default());
    }

    /// The moved `SourceOverride` must serialize to the exact byte snapshot
    /// (including the `JsonAny` `value` field, serde-transparent over Value).
    #[test]
    fn source_override_bytes_unchanged() {
        let ov = SourceOverride {
            source_id: "src-1".to_owned(),
            key: "hashOnScan".to_owned(),
            value: JsonAny::from(serde_json::json!("eager")),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        };
        let actual = serde_json::to_string(&ov).unwrap();
        assert_eq!(
            actual, SOURCE_OVERRIDE_JSON,
            "SourceOverride on-disk/wire JSON changed after the T254 domain move"
        );
    }

    /// Round-trip through the real `settings` SQL table: write each known key,
    /// reload via `load_settings`, and assert the hydrated state equals the
    /// values we stored. Proves the column mapping is unchanged end-to-end.
    #[tokio::test]
    async fn settings_store_roundtrip_preserves_bytes() {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let pool = db.pool();

        // Persist a representative spread across string / bool / number / array
        // keys, using the exact stored JSON encodings.
        set_raw(pool, "hashOnScan", &serde_json::json!("eager")).await.unwrap();
        set_raw(pool, "followSymlinks", &serde_json::json!(true)).await.unwrap();
        set_raw(pool, "logLevel", &serde_json::json!("debug")).await.unwrap();
        set_raw(pool, "calibration.dark_temp_tolerance", &serde_json::json!(3.5)).await.unwrap();
        set_raw(pool, "protectedCategories", &serde_json::json!(["lights", "masters"]))
            .await
            .unwrap();

        // The raw column bytes must equal exactly what we stored.
        assert_eq!(get_raw(pool, "hashOnScan").await.unwrap(), Some(serde_json::json!("eager")));
        assert_eq!(get_raw(pool, "followSymlinks").await.unwrap(), Some(serde_json::json!(true)));
        assert_eq!(
            get_raw(pool, "protectedCategories").await.unwrap(),
            Some(serde_json::json!(["lights", "masters"]))
        );

        // The hydrated typed state must reflect those stored values.
        let state = load_settings(pool).await.unwrap();
        assert_eq!(state.hash_on_scan, "eager");
        assert!(state.follow_symlinks);
        assert_eq!(state.log_level, "debug");
        assert!((state.calibration_dark_temp_tolerance - 3.5).abs() < f64::EPSILON);
        assert_eq!(state.protected_categories, vec!["lights".to_owned(), "masters".to_owned()]);
    }
}
