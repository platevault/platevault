//! Repository methods for settings storage (spec 018, T003).
//!
//! Operates on the `settings` and `source_overrides` tables from migration 0013.
//! Each settings key is stored as one row with a JSON-encoded value.

use std::collections::BTreeMap;

use contracts_core::settings::{SettingsState, SourceOverride};
use patterns::{default_pattern, validate_pattern_str, FrameTypeClass};
use serde_json::Value;
use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

/// Settings key holding the per-frame-type destination pattern overrides
/// (spec 041 FR-026b). Stored as a JSON object mapping a [`FrameTypeClass`]
/// name to a pattern string. Only explicit overrides are persisted; missing
/// entries fall back to [`default_pattern`] on read.
pub const PATTERNS_BY_TYPE_KEY: &str = "patterns_by_type";

// ── Helpers ──────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

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
    let now = now_iso();

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
        PATTERNS_BY_TYPE_KEY => {
            state.patterns_by_type = serde_json::from_value(value).map_err(DbError::Serialise)?;
        }
        _ => {
            // Structured-path keys (tools.*, workflow_profile.*) are not in the
            // static SettingsState bag; they are readable via resolve_setting.
        }
    }
    Ok(())
}

// ── Per-frame-type destination patterns (spec 041 FR-026b) ────────────────
//
// Storage choice: set/reset operations **validate via the patterns crate before
// storing** (no garbage is ever persisted). The getter *also* falls back to the
// built-in default on read for empty/invalid entries, so a hand-edited or
// migrated DB with a bad value still resolves to a usable pattern.

/// Read the stored per-type pattern override map (only explicit overrides;
/// missing classes are absent). Returns an empty map when unset.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure or [`DbError::Serialise`] if
/// the stored value is not a string→string object.
pub async fn get_patterns_by_type(pool: &SqlitePool) -> DbResult<BTreeMap<String, String>> {
    match get_raw(pool, PATTERNS_BY_TYPE_KEY).await? {
        None => Ok(BTreeMap::new()),
        Some(v) => serde_json::from_value(v).map_err(DbError::Serialise),
    }
}

/// Return the effective destination pattern for a `(frame_type, is_master)`
/// pair: the stored override when present, non-empty, and valid; otherwise the
/// built-in [`default_pattern`].
///
/// Returns `None` only when `frame_type` does not map to a known
/// [`FrameTypeClass`] (e.g. an unclassified frame). Callers (spec 041 confirm,
/// T052) treat `None` as "no destination pattern" and surface it via the
/// needs-review flow.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure or [`DbError::Serialise`] if
/// the stored override map is malformed.
pub async fn effective_pattern_for(
    pool: &SqlitePool,
    frame_type: &str,
    is_master: bool,
) -> DbResult<Option<String>> {
    let Some(class) = patterns::classify_frame(frame_type, is_master) else {
        return Ok(None);
    };
    let overrides = get_patterns_by_type(pool).await?;
    let effective = overrides
        .get(class.as_str())
        .map(String::as_str)
        .filter(|p| validate_pattern_str(p).is_ok())
        .map_or_else(|| default_pattern(class).to_owned(), ToOwned::to_owned);
    Ok(Some(effective))
}

/// Set the destination pattern override for a single frame-type class.
///
/// The pattern is validated via [`validate_pattern_str`] before storage; an
/// invalid (or empty) pattern is rejected with [`DbError::Serialise`] rather
/// than persisted. To revert a class to its default, use [`reset_pattern_for`].
///
/// # Errors
///
/// Returns [`DbError::Serialise`] when `pattern` fails validation, or
/// [`DbError::Database`] on query failure.
pub async fn set_pattern_for(
    pool: &SqlitePool,
    class: FrameTypeClass,
    pattern: &str,
) -> DbResult<()> {
    validate_pattern_str(pattern).map_err(|e| {
        let err: serde_json::Error =
            serde::de::Error::custom(format!("invalid pattern for {}: {e}", class.as_str()));
        DbError::Serialise(err)
    })?;
    let mut overrides = get_patterns_by_type(pool).await?;
    overrides.insert(class.as_str().to_owned(), pattern.to_owned());
    let value = serde_json::to_value(&overrides).map_err(DbError::Serialise)?;
    set_raw(pool, PATTERNS_BY_TYPE_KEY, &value).await
}

/// Reset a single frame-type class to its built-in default by removing its
/// override entry. Idempotent — no error if no override exists.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure or [`DbError::Serialise`] if
/// the stored override map is malformed.
pub async fn reset_pattern_for(pool: &SqlitePool, class: FrameTypeClass) -> DbResult<()> {
    let mut overrides = get_patterns_by_type(pool).await?;
    if overrides.remove(class.as_str()).is_none() {
        return Ok(());
    }
    let value = serde_json::to_value(&overrides).map_err(DbError::Serialise)?;
    set_raw(pool, PATTERNS_BY_TYPE_KEY, &value).await
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
    let now = now_iso();

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

    // ── Per-frame-type patterns ───────────────────────────────────────────

    #[tokio::test]
    async fn patterns_by_type_defaults_when_unset() {
        let db = setup().await;
        // No overrides stored → every class resolves to its built-in default,
        // reached via the raw (frame_type, is_master) inputs confirm.rs passes.
        for (raw_type, is_master, class) in raw_inputs_per_class() {
            let got = effective_pattern_for(db.pool(), raw_type, is_master).await.unwrap();
            assert_eq!(got.as_deref(), Some(default_pattern(class)));
        }
        assert!(get_patterns_by_type(db.pool()).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn patterns_by_type_override_read_back() {
        let db = setup().await;
        set_pattern_for(db.pool(), FrameTypeClass::Dark, "custom/{gain}/").await.unwrap();
        let got = effective_pattern_for(db.pool(), "dark", false).await.unwrap();
        assert_eq!(got.as_deref(), Some("custom/{gain}/"));
        // Other classes are untouched.
        let flat = effective_pattern_for(db.pool(), "flat", false).await.unwrap();
        assert_eq!(flat.as_deref(), Some(default_pattern(FrameTypeClass::Flat)));
    }

    #[tokio::test]
    async fn patterns_by_type_master_routing() {
        let db = setup().await;
        set_pattern_for(db.pool(), FrameTypeClass::MasterDark, "m/{exposure}/").await.unwrap();
        // is_master = true selects the master class.
        let master = effective_pattern_for(db.pool(), "dark", true).await.unwrap();
        assert_eq!(master.as_deref(), Some("m/{exposure}/"));
        // raw dark still defaults.
        let raw = effective_pattern_for(db.pool(), "dark", false).await.unwrap();
        assert_eq!(raw.as_deref(), Some(default_pattern(FrameTypeClass::Dark)));
    }

    #[tokio::test]
    async fn set_pattern_rejects_invalid() {
        let db = setup().await;
        assert!(set_pattern_for(db.pool(), FrameTypeClass::Bias, "{telescope}/").await.is_err());
        assert!(set_pattern_for(db.pool(), FrameTypeClass::Bias, "").await.is_err());
        // Nothing persisted on rejection → still the default.
        let got = effective_pattern_for(db.pool(), "bias", false).await.unwrap();
        assert_eq!(got.as_deref(), Some(default_pattern(FrameTypeClass::Bias)));
    }

    #[tokio::test]
    async fn stored_invalid_override_falls_back_on_read() {
        // Defensive read-side fallback: a malformed value written out-of-band
        // (e.g. hand-edited DB) must not surface a broken pattern.
        let db = setup().await;
        let mut map = BTreeMap::new();
        map.insert("bias".to_owned(), "{telescope}/".to_owned());
        set_raw(db.pool(), PATTERNS_BY_TYPE_KEY, &serde_json::to_value(&map).unwrap())
            .await
            .unwrap();
        let got = effective_pattern_for(db.pool(), "bias", false).await.unwrap();
        assert_eq!(got.as_deref(), Some(default_pattern(FrameTypeClass::Bias)));
    }

    #[tokio::test]
    async fn reset_pattern_restores_default() {
        let db = setup().await;
        set_pattern_for(db.pool(), FrameTypeClass::Light, "{target}/x/").await.unwrap();
        reset_pattern_for(db.pool(), FrameTypeClass::Light).await.unwrap();
        let got = effective_pattern_for(db.pool(), "light", false).await.unwrap();
        assert_eq!(got.as_deref(), Some(default_pattern(FrameTypeClass::Light)));
        // reset is idempotent.
        reset_pattern_for(db.pool(), FrameTypeClass::Light).await.unwrap();
    }

    #[tokio::test]
    async fn effective_pattern_for_unknown_type_is_none() {
        let db = setup().await;
        assert!(effective_pattern_for(db.pool(), "unclassified", false).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn load_settings_applies_patterns_by_type() {
        let db = setup().await;
        set_pattern_for(db.pool(), FrameTypeClass::Flat, "f/{filter}/").await.unwrap();
        let state = load_settings(db.pool()).await.unwrap();
        assert_eq!(state.patterns_by_type.get("flat").map(String::as_str), Some("f/{filter}/"));
    }

    /// Raw `(frame_type, is_master)` inputs that map to each class, as
    /// `classify_frame` expects them (it takes raw header types, not class names).
    fn raw_inputs_per_class() -> [(&'static str, bool, FrameTypeClass); 7] {
        [
            ("light", false, FrameTypeClass::Light),
            ("flat", false, FrameTypeClass::Flat),
            ("dark", false, FrameTypeClass::Dark),
            ("bias", false, FrameTypeClass::Bias),
            ("flat", true, FrameTypeClass::MasterFlat),
            ("dark", true, FrameTypeClass::MasterDark),
            ("bias", true, FrameTypeClass::MasterBias),
        ]
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
