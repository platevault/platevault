//! Settings use cases (spec 018, T006/T013/T018/T019/T023/T024/T027).
//!
//! Entry points:
//! - `get_settings` — load all settings, hydrating defaults for missing rows,
//!   repairing invalid stored values (T018, T019).
//! - `update_setting` — write a single key with no-op guard and audit emit (T013).
//! - `restore_defaults` — restore one, several, or all keys to their in-code
//!   defaults (T027).
//! - `set_source_override` — set a per-source override for an overridable key (T023).
//! - `resolve_setting` — resolution order: per-source → global → default (T024).

use audit::bus::EventBus;
use audit::event_bus::{
    SettingsChanged, SettingsRepair, SettingsSnapshot, Source, TOPIC_SETTINGS_CHANGED,
    TOPIC_SETTINGS_REPAIR, TOPIC_SETTINGS_SNAPSHOT,
};
use contracts_core::settings::{
    RestoreDefaultsRequest, RestoreDefaultsResponse, RestoreDefaultsStatus,
    SetSourceOverrideRequest, SetSourceOverrideResponse, SettingsGetResponse, SettingsState,
    SettingsUpdateRequest, SettingsUpdateResponse, SettingsUpdateStatus,
};
use contracts_core::{ContractError, ErrorSeverity};
use persistence_db::repositories::settings as repo;
use serde_json::Value;
use sqlx::SqlitePool;
use time::OffsetDateTime;

// ── Constants ────────────────────────────────────────────────────────────

/// Keys whose changes are persisted but audited as a snapshot rather than
/// per-change (data-model.md §Noisy Keys).
pub const NOISY_KEYS: &[&str] =
    &["pattern", "protectedCategories", "plans.list.default_age_cutoff_days", "rememberFollowLogs"];

/// Keys that can be overridden per data source root (data-model.md §Overridable Keys).
pub const OVERRIDABLE_KEYS: &[&str] = &["followSymlinks", "hashOnScan", "defaultProtection"];

/// All stable (non-structured-path) v1 key names.
pub const ALL_V1_KEYS: &[&str] = &[
    "pattern",
    "autoApplyPattern",
    "alwaysPreviewBeforePlan",
    "followSymlinks",
    "hashOnScan",
    "darkMatchTolerance",
    "flatMatching",
    "suggestCalibration",
    "rowDensity",
    "logLevel",
    "rememberFollowLogs",
    "defaultProtection",
    "blockPermanentDelete",
    "protectedCategories",
    "current_library_id",
    "devMode",
    "plans.list.default_age_cutoff_days",
    "calibration.dark_temp_tolerance",
    "calibration.prefill_suggestion",
    "calibration.dark.override_penalty",
    "calibration.flat.override_penalty",
    "calibration.bias.override_penalty",
    "imagetyp_normalization.user_mappings",
];

// ── Error mapping ──────────────────────────────────────────────────────────

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: persistence_db::DbError) -> ContractError {
    ContractError::new("internal.database", format!("{e}"), ErrorSeverity::Fatal, true)
}

#[allow(clippy::needless_pass_by_value)]
fn bus_err(e: audit::bus::BusError) -> ContractError {
    ContractError::new("internal.audit", format!("{e}"), ErrorSeverity::Fatal, true)
}

// ── Key validation ──────────────────────────────────────────────────────────

/// Return `true` if `key` is a valid v1 settings key (stable or structured-path).
#[must_use]
pub fn is_valid_key(key: &str) -> bool {
    if ALL_V1_KEYS.contains(&key) {
        return true;
    }
    // Structured-path keys.
    is_calibration_override_penalty_key(key)
        || is_tools_bundle_id_key(key)
        || is_tools_executable_path_key(key)
        || is_tools_enabled_key(key)
        || is_tools_auto_detected_key(key)
        || is_workflow_profile_watch_extensions_key(key)
        || is_workflow_profile_attribution_window_key(key)
}

fn is_calibration_override_penalty_key(key: &str) -> bool {
    matches!(
        key,
        "calibration.dark.override_penalty"
            | "calibration.flat.override_penalty"
            | "calibration.bias.override_penalty"
    ) || {
        // The regex pattern: ^calibration\.(dark|flat|bias)\.override_penalty$
        // already covered by the match above; this branch handles the general pattern
        // for any future frame types validated via regex.
        false
    }
}

fn is_tools_bundle_id_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.bundle_id$
    if let Some(rest) = key.strip_prefix("tools.") {
        if let Some(tool_id) = rest.strip_suffix(".bundle_id") {
            return !tool_id.is_empty()
                && tool_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_tools_key_with_suffix(key: &str, suffix: &str) -> bool {
    if let Some(rest) = key.strip_prefix("tools.") {
        if let Some(tool_id) = rest.strip_suffix(suffix) {
            return !tool_id.is_empty()
                && tool_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_tools_executable_path_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.executable_path$
    is_tools_key_with_suffix(key, ".executable_path")
}

fn is_tools_enabled_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.enabled$
    is_tools_key_with_suffix(key, ".enabled")
}

fn is_tools_auto_detected_key(key: &str) -> bool {
    // ^tools\.[a-z0-9_]+\.auto_detected$
    is_tools_key_with_suffix(key, ".auto_detected")
}

fn is_workflow_profile_watch_extensions_key(key: &str) -> bool {
    // ^workflow_profile\.[a-z0-9_]+\.watch_extensions$
    if let Some(rest) = key.strip_prefix("workflow_profile.") {
        if let Some(profile_id) = rest.strip_suffix(".watch_extensions") {
            return !profile_id.is_empty()
                && profile_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

fn is_workflow_profile_attribution_window_key(key: &str) -> bool {
    // ^workflow_profile\.[a-z0-9_]+\.launch_attribution_window_hours$
    if let Some(rest) = key.strip_prefix("workflow_profile.") {
        if let Some(profile_id) = rest.strip_suffix(".launch_attribution_window_hours") {
            return !profile_id.is_empty()
                && profile_id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        }
    }
    false
}

// ── Value validation ──────────────────────────────────────────────────────

/// Validate a proposed value for the given key.
///
/// Returns `Err(ContractError)` with code `"value.invalid"` when validation fails.
///
/// # Errors
///
/// Returns `ContractError` when the value is not valid for the key.
#[allow(clippy::result_large_err, clippy::collapsible_match, clippy::too_many_lines)]
pub fn validate_value(key: &str, value: &Value) -> Result<(), ContractError> {
    let invalid = |msg: &str| {
        ContractError::new(
            "value.invalid",
            format!("key {key}: {msg}"),
            ErrorSeverity::Warning,
            false,
        )
    };

    match key {
        "hashOnScan" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["lazy", "eager", "off"].contains(&s) {
                return Err(invalid("must be \"lazy\", \"eager\", or \"off\""));
            }
        }
        "darkMatchTolerance" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["strict", "loose", "any"].contains(&s) {
                return Err(invalid("must be \"strict\", \"loose\", or \"any\""));
            }
        }
        "flatMatching" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["filter-rot", "filter", "manual"].contains(&s) {
                return Err(invalid("must be \"filter-rot\", \"filter\", or \"manual\""));
            }
        }
        "logLevel" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["error", "warn", "info", "debug"].contains(&s) {
                return Err(invalid("must be \"error\", \"warn\", \"info\", or \"debug\""));
            }
        }
        "rowDensity" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["dense", "comfortable"].contains(&s) {
                return Err(invalid("must be \"dense\" or \"comfortable\""));
            }
        }
        "defaultProtection" => {
            let s = value.as_str().ok_or_else(|| invalid("must be a string"))?;
            if !["protected", "normal", "unprotected"].contains(&s) {
                return Err(invalid("must be \"protected\", \"normal\", or \"unprotected\""));
            }
        }
        "calibration.dark_temp_tolerance" => {
            let n = value.as_f64().ok_or_else(|| invalid("must be a number"))?;
            if n < 0.0 {
                return Err(invalid("must be >= 0"));
            }
        }
        k if k == "calibration.dark.override_penalty"
            || k == "calibration.flat.override_penalty"
            || k == "calibration.bias.override_penalty" =>
        {
            let n = value.as_f64().ok_or_else(|| invalid("must be a number [0,1]"))?;
            if !(0.0..=1.0).contains(&n) {
                return Err(invalid("must be in [0, 1]"));
            }
        }
        "devMode" => {
            // In release builds (without dev-tools feature), devMode is always false.
            #[cfg(not(feature = "dev-tools"))]
            return Err(ContractError::new(
                "value.invalid",
                "devMode cannot be set in release builds".to_owned(),
                ErrorSeverity::Warning,
                false,
            ));
        }
        // Boolean keys — just ensure type.
        "autoApplyPattern"
        | "alwaysPreviewBeforePlan"
        | "followSymlinks"
        | "suggestCalibration"
        | "rememberFollowLogs"
        | "blockPermanentDelete"
        | "calibration.prefill_suggestion" => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        // String? keys.
        "current_library_id" => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
        }
        // Number keys.
        "plans.list.default_age_cutoff_days" => {
            if value.as_f64().is_none() {
                return Err(invalid("must be a number"));
            }
        }
        // Array keys — basic type check only.
        "pattern" | "protectedCategories" | "imagetyp_normalization.user_mappings" => {
            if !value.is_array() {
                return Err(invalid("must be an array"));
            }
        }
        // Structured-path keys — relax validation to basic presence.
        _ if is_tools_bundle_id_key(key) => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
        }
        _ if is_tools_executable_path_key(key) => {
            if !value.is_null() && !value.is_string() {
                return Err(invalid("must be a string or null"));
            }
        }
        _ if is_tools_enabled_key(key) => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        _ if is_tools_auto_detected_key(key) => {
            if !value.is_boolean() {
                return Err(invalid("must be a boolean"));
            }
        }
        _ if is_workflow_profile_watch_extensions_key(key) => {
            if !value.is_array() {
                return Err(invalid("must be an array"));
            }
        }
        _ if is_workflow_profile_attribution_window_key(key) => {
            if value.as_f64().is_none() {
                return Err(invalid("must be a number"));
            }
        }
        _ => {
            // No additional validation for other keys.
        }
    }
    Ok(())
}

// ── Deep structural equality ───────────────────────────────────────────────

/// Deep structural equality for settings values (A4, R4.1).
///
/// For arrays and objects, compares element-wise and field-wise.
/// For primitives, uses strict equality.
#[must_use]
pub fn settings_value_eq(a: &Value, b: &Value) -> bool {
    a == b
}

// ── ISO timestamp helper ──────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── get_settings ──────────────────────────────────────────────────────────

/// Load all settings with defaults hydrated for missing rows (T018).
///
/// Invalid stored values are deleted and reset to default, with a
/// `settings.repair` audit event emitted (T019).
///
/// # Errors
///
/// Returns `ContractError` on database or audit failure.
pub async fn get_settings(
    pool: &SqlitePool,
    bus: &EventBus,
) -> Result<SettingsGetResponse, ContractError> {
    let all_raw = repo::get_all_raw(pool).await.map_err(db_err)?;
    let mut settings = SettingsState::default();

    for (key, value) in all_raw {
        // Validate stored value.
        if let Err(_validation_err) = validate_value(&key, &value) {
            // Repair: delete the bad row and emit a warn audit event.
            repo::delete_key(pool, &key).await.map_err(db_err)?;

            let default_value = default_value_for_key(&key);
            let at = now_iso();
            bus.publish(
                TOPIC_SETTINGS_REPAIR,
                Source::System,
                SettingsRepair {
                    key: key.clone(),
                    invalid_value: value.clone(),
                    default_value: default_value.clone(),
                    at,
                },
            )
            .await
            .map_err(bus_err)?;

            // Use the default — do not apply the invalid stored value.
            continue;
        }

        // Apply the validated value.
        apply_value_to_state(&key, value, &mut settings);
    }

    Ok(SettingsGetResponse { settings })
}

/// Apply a raw JSON value to the correct field of `SettingsState`.
///
/// Unknown keys (structured-path keys like tools.*) are stored in the DB but
/// not mapped to static SettingsState fields.
#[allow(clippy::too_many_lines, clippy::assigning_clones)]
fn apply_value_to_state(key: &str, value: Value, state: &mut SettingsState) {
    match key {
        "pattern" => {
            if let Ok(v) = serde_json::from_value(value) {
                state.pattern = v;
            }
        }
        "autoApplyPattern" => {
            if let Some(v) = value.as_bool() {
                state.auto_apply_pattern = v;
            }
        }
        "alwaysPreviewBeforePlan" => {
            if let Some(v) = value.as_bool() {
                state.always_preview_before_plan = v;
            }
        }
        "followSymlinks" => {
            if let Some(v) = value.as_bool() {
                state.follow_symlinks = v;
            }
        }
        "hashOnScan" => {
            if let Some(v) = value.as_str() {
                state.hash_on_scan = v.to_owned();
            }
        }
        "darkMatchTolerance" => {
            if let Some(v) = value.as_str() {
                state.dark_match_tolerance = v.to_owned();
            }
        }
        "flatMatching" => {
            if let Some(v) = value.as_str() {
                state.flat_matching = v.to_owned();
            }
        }
        "suggestCalibration" => {
            if let Some(v) = value.as_bool() {
                state.suggest_calibration = v;
            }
        }
        "rowDensity" => {
            if let Some(v) = value.as_str() {
                state.row_density = v.to_owned();
            }
        }
        "logLevel" => {
            if let Some(v) = value.as_str() {
                state.log_level = v.to_owned();
            }
        }
        "rememberFollowLogs" => {
            if let Some(v) = value.as_bool() {
                state.remember_follow_logs = v;
            }
        }
        "defaultProtection" => {
            if let Some(v) = value.as_str() {
                state.default_protection = v.to_owned();
            }
        }
        "blockPermanentDelete" => {
            if let Some(v) = value.as_bool() {
                state.block_permanent_delete = v;
            }
        }
        "protectedCategories" => {
            if let Ok(v) = serde_json::from_value(value) {
                state.protected_categories = v;
            }
        }
        "current_library_id" => {
            state.current_library_id = value.as_str().map(str::to_owned);
        }
        "devMode" => {
            if let Some(v) = value.as_bool() {
                state.dev_mode = v;
            }
        }
        "plans.list.default_age_cutoff_days" => {
            if let Some(v) = value.as_f64() {
                state.plans_list_default_age_cutoff_days = v;
            }
        }
        "calibration.dark_temp_tolerance" => {
            if let Some(v) = value.as_f64() {
                state.calibration_dark_temp_tolerance = v;
            }
        }
        "calibration.prefill_suggestion" => {
            if let Some(v) = value.as_bool() {
                state.calibration_prefill_suggestion = v;
            }
        }
        "calibration.dark.override_penalty" => {
            if let Some(v) = value.as_f64() {
                state.calibration_dark_override_penalty = v;
            }
        }
        "calibration.flat.override_penalty" => {
            if let Some(v) = value.as_f64() {
                state.calibration_flat_override_penalty = v;
            }
        }
        "calibration.bias.override_penalty" => {
            if let Some(v) = value.as_f64() {
                state.calibration_bias_override_penalty = v;
            }
        }
        "imagetyp_normalization.user_mappings" => {
            if let Ok(v) = serde_json::from_value(value) {
                state.imagetyp_normalization_user_mappings = v;
            }
        }
        _ => {
            // Structured-path keys are not mapped to static SettingsState fields.
            // Use resolve_setting(key, source_id) to read them individually.
        }
    }
}

/// Return the in-code default value for a given key as `serde_json::Value`.
fn default_value_for_key(key: &str) -> Value {
    let defaults = SettingsState::default();
    match key {
        "pattern" => serde_json::to_value(&defaults.pattern).unwrap_or(Value::Null),
        "autoApplyPattern" => Value::Bool(defaults.auto_apply_pattern),
        "alwaysPreviewBeforePlan" => Value::Bool(defaults.always_preview_before_plan),
        "followSymlinks" => Value::Bool(defaults.follow_symlinks),
        "hashOnScan" => Value::String(defaults.hash_on_scan),
        "darkMatchTolerance" => Value::String(defaults.dark_match_tolerance),
        "flatMatching" => Value::String(defaults.flat_matching),
        "suggestCalibration" => Value::Bool(defaults.suggest_calibration),
        "rowDensity" => Value::String(defaults.row_density),
        "logLevel" => Value::String(defaults.log_level),
        "rememberFollowLogs" => Value::Bool(defaults.remember_follow_logs),
        "defaultProtection" => Value::String(defaults.default_protection),
        "blockPermanentDelete" => Value::Bool(defaults.block_permanent_delete),
        "protectedCategories" => {
            serde_json::to_value(&defaults.protected_categories).unwrap_or(Value::Null)
        }
        "devMode" => Value::Bool(defaults.dev_mode),
        "plans.list.default_age_cutoff_days" => {
            serde_json::json!(defaults.plans_list_default_age_cutoff_days)
        }
        "calibration.dark_temp_tolerance" => {
            serde_json::json!(defaults.calibration_dark_temp_tolerance)
        }
        "calibration.prefill_suggestion" => Value::Bool(defaults.calibration_prefill_suggestion),
        "calibration.dark.override_penalty" => {
            serde_json::json!(defaults.calibration_dark_override_penalty)
        }
        "calibration.flat.override_penalty" => {
            serde_json::json!(defaults.calibration_flat_override_penalty)
        }
        "calibration.bias.override_penalty" => {
            serde_json::json!(defaults.calibration_bias_override_penalty)
        }
        "imagetyp_normalization.user_mappings" => {
            serde_json::to_value(&defaults.imagetyp_normalization_user_mappings)
                .unwrap_or(Value::Null)
        }
        _ => Value::Null,
    }
}

// ── update_setting ────────────────────────────────────────────────────────

/// Write a single settings key (T013).
///
/// Behaviour:
/// - Returns `"key.unknown"` for keys that are not valid v1 keys.
/// - Returns `"value.invalid"` when schema validation fails.
/// - Returns `status = "noop"` when the incoming value is deep-equal to the
///   currently stored (or default) value (A4, R4.1).
/// - For non-noisy keys: upserts the row and emits a `settings.changed` audit
///   event.
/// - For noisy keys: upserts the row without emitting a per-change audit event
///   (snapshot is emitted separately by T020).
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` or `"value.invalid"`, or
/// an internal error on database/audit failure.
pub async fn update_setting(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &SettingsUpdateRequest,
) -> Result<SettingsUpdateResponse, ContractError> {
    let key = &req.key;

    // 1. Validate key.
    if !is_valid_key(key) {
        return Err(ContractError::new(
            "key.unknown",
            format!("unknown settings key: {key}"),
            ErrorSeverity::Warning,
            false,
        ));
    }

    // 2. Validate value.
    let new_value = &req.value.0;
    validate_value(key, new_value)?;

    // 3. Load current stored value (or default).
    let prior_raw = repo::get_raw(pool, key).await.map_err(db_err)?;
    let prior_value = prior_raw.clone().unwrap_or_else(|| default_value_for_key(key));

    // 4. No-op guard.
    if settings_value_eq(&prior_value, new_value) {
        return Ok(SettingsUpdateResponse {
            status: SettingsUpdateStatus::Noop,
            key: key.clone(),
            prior_value: contracts_core::JsonAny::from(prior_value),
            new_value: contracts_core::JsonAny::from(new_value.clone()),
            audit_id: None,
        });
    }

    // 5. Persist.
    repo::set_raw(pool, key, new_value).await.map_err(db_err)?;

    // 6. Emit audit event for non-noisy keys.
    let is_noisy = NOISY_KEYS.contains(&key.as_str());
    let audit_id = if is_noisy {
        None
    } else {
        let at = now_iso();
        let evt_id = uuid::Uuid::new_v4().to_string();
        bus.publish(
            TOPIC_SETTINGS_CHANGED,
            Source::User,
            SettingsChanged {
                key: key.clone(),
                prior_value: prior_value.clone(),
                new_value: new_value.clone(),
                at,
            },
        )
        .await
        .map_err(bus_err)?;
        Some(evt_id)
    };

    Ok(SettingsUpdateResponse {
        status: SettingsUpdateStatus::Success,
        key: key.clone(),
        prior_value: contracts_core::JsonAny::from(prior_value),
        new_value: contracts_core::JsonAny::from(new_value.clone()),
        audit_id,
    })
}

// ── restore_defaults ──────────────────────────────────────────────────────

/// Restore one or more settings keys to their in-code defaults (T027).
///
/// - Empty `keys` slice restores all v1 keys.
/// - Keys already at default are collected in `already_at_default` and skipped
///   (no write, no audit — R-3.1).
/// - When all keys are already at default, returns `status = "noop"`.
/// - For each key actually restored, one audit event is emitted.
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unknown"` if any key is not a valid
/// v1 key (structured-path keys accepted). Returns internal errors on DB/audit
/// failure.
pub async fn restore_defaults(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &RestoreDefaultsRequest,
) -> Result<RestoreDefaultsResponse, ContractError> {
    let keys_to_restore: Vec<String> = if req.keys.is_empty() {
        ALL_V1_KEYS.iter().map(|k| (*k).to_owned()).collect()
    } else {
        // Validate all requested keys first.
        for key in &req.keys {
            if !is_valid_key(key) {
                return Err(ContractError::new(
                    "key.unknown",
                    format!("unknown settings key: {key}"),
                    ErrorSeverity::Warning,
                    false,
                ));
            }
        }
        req.keys.clone()
    };

    let mut restored = Vec::new();
    let mut already_at_default = Vec::new();

    for key in &keys_to_restore {
        let default_val = default_value_for_key(key);
        let current_raw = repo::get_raw(pool, key).await.map_err(db_err)?;
        let current_val = current_raw.unwrap_or_else(|| default_val.clone());

        if settings_value_eq(&current_val, &default_val) {
            already_at_default.push(key.clone());
            continue;
        }

        // Write the default value.
        repo::set_raw(pool, key, &default_val).await.map_err(db_err)?;

        // Emit audit event (even for noisy keys — restore is an explicit action).
        let at = now_iso();
        bus.publish(
            TOPIC_SETTINGS_CHANGED,
            Source::User,
            SettingsChanged {
                key: key.clone(),
                prior_value: current_val,
                new_value: default_val,
                at,
            },
        )
        .await
        .map_err(bus_err)?;

        restored.push(key.clone());
    }

    let status = if restored.is_empty() {
        RestoreDefaultsStatus::Noop
    } else {
        RestoreDefaultsStatus::Success
    };

    Ok(RestoreDefaultsResponse { status, restored, already_at_default })
}

// ── set_source_override ───────────────────────────────────────────────────

/// Set a per-source override for an overridable settings key (T023).
///
/// Validates that `key` is one of `followSymlinks`, `hashOnScan`,
/// `defaultProtection`. Validates the value type. The `source_id` existence
/// check is best-effort: since the sources repository is in a different crate
/// slice, callers may perform that check before calling this function.
///
/// # Errors
///
/// Returns `ContractError` with code `"key.unoverridable"` for non-overridable
/// keys. Returns `"value.invalid"` for type-invalid values.
pub async fn set_source_override(
    pool: &SqlitePool,
    req: &SetSourceOverrideRequest,
) -> Result<SetSourceOverrideResponse, ContractError> {
    let key = &req.key;

    if !OVERRIDABLE_KEYS.contains(&key.as_str()) {
        return Err(ContractError::new(
            "key.unoverridable",
            format!("key {key} cannot be overridden per source"),
            ErrorSeverity::Warning,
            false,
        ));
    }

    let value = &req.value.0;
    validate_value(key, value)?;

    repo::set_source_override(pool, &req.source_id, key, value).await.map_err(db_err)?;

    Ok(SetSourceOverrideResponse { source_id: req.source_id.clone(), key: key.clone() })
}

// ── resolve_setting ───────────────────────────────────────────────────────

/// Resolve the effective value for a settings key, honouring per-source
/// override → global setting → in-code default (T024, data-model.md §Resolution).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn resolve_setting(
    pool: &SqlitePool,
    key: &str,
    source_id: Option<&str>,
) -> Result<Value, ContractError> {
    // 1. Per-source override (only for overridable keys).
    if let Some(sid) = source_id {
        if OVERRIDABLE_KEYS.contains(&key) {
            if let Some(v) =
                persistence_db::repositories::settings::get_source_override_raw(pool, sid, key)
                    .await
                    .map_err(db_err)?
            {
                return Ok(v);
            }
        }
    }

    // 2. Global setting.
    if let Some(v) = repo::get_raw(pool, key).await.map_err(db_err)? {
        return Ok(v);
    }

    // 3. In-code default.
    Ok(default_value_for_key(key))
}

// ── emit_snapshot ──────────────────────────────────────────────────────────

/// Emit a `settings.snapshot` audit event (T020).
///
/// Called at session start and after the 5-minute inactivity debounce
/// (the debounce timer is owned by the caller/command layer).
///
/// # Errors
///
/// Returns `ContractError` on database or audit failure.
pub async fn emit_snapshot(
    pool: &SqlitePool,
    bus: &EventBus,
    trigger: &str,
) -> Result<(), ContractError> {
    // Collect current values of noisy keys.
    let mut noisy_values = serde_json::Map::new();
    for key in NOISY_KEYS {
        let val = repo::get_raw(pool, key)
            .await
            .map_err(db_err)?
            .unwrap_or_else(|| default_value_for_key(key));
        noisy_values.insert((*key).to_owned(), val);
    }

    let at = now_iso();
    bus.publish(
        TOPIC_SETTINGS_SNAPSHOT,
        Source::System,
        SettingsSnapshot {
            trigger: trigger.to_owned(),
            noisy_keys: Value::Object(noisy_values),
            at,
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    // ── T007: settings.get contract test ───────────────────────────────

    #[tokio::test]
    async fn get_settings_returns_defaults_when_empty() {
        let (db, bus) = setup().await;
        let resp = get_settings(db.pool(), &bus).await.unwrap();
        let defaults = SettingsState::default();
        assert_eq!(resp.settings.log_level, defaults.log_level);
        assert_eq!(resp.settings.follow_symlinks, defaults.follow_symlinks);
        assert_eq!(resp.settings.hash_on_scan, defaults.hash_on_scan);
        assert_eq!(resp.settings.protected_categories, defaults.protected_categories);
        assert!(!resp.settings.dev_mode);
    }

    // ── T008: settings.update contract tests ───────────────────────────

    #[tokio::test]
    async fn update_setting_happy_path_non_noisy() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
        assert_eq!(resp.key, "logLevel");
        // Non-noisy key should have an audit_id.
        assert!(resp.audit_id.is_some());
    }

    #[tokio::test]
    async fn update_setting_noop_when_value_unchanged() {
        let (db, bus) = setup().await;
        // logLevel default is "info".
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("info")),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
        assert!(resp.audit_id.is_none());
    }

    #[tokio::test]
    async fn update_setting_rejects_unknown_key() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "notARealKey".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("whatever")),
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, "key.unknown");
    }

    #[tokio::test]
    async fn update_setting_rejects_invalid_value() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("trace")), // not a valid level
        };
        let err = update_setting(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, "value.invalid");
    }

    #[tokio::test]
    async fn update_setting_noisy_key_no_audit_id() {
        let (db, bus) = setup().await;
        // "rememberFollowLogs" default is false; change to true.
        let req = SettingsUpdateRequest {
            key: "rememberFollowLogs".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!(true)),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
        // Noisy key: no per-change audit id.
        assert!(resp.audit_id.is_none());
    }

    #[tokio::test]
    async fn update_setting_pattern_noop_structural_equality() {
        let (db, bus) = setup().await;
        // Get the default pattern and send it back — must be noop (A4, R4.1).
        let defaults = SettingsState::default();
        let pattern_value = serde_json::to_value(&defaults.pattern).unwrap();
        let req = SettingsUpdateRequest {
            key: "pattern".to_owned(),
            value: contracts_core::JsonAny::from(pattern_value),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
    }

    #[tokio::test]
    async fn update_setting_protected_categories_noop_structural_equality() {
        let (db, bus) = setup().await;
        // Default is ["lights", "masters", "finals"] — same value must be noop (R-Set-1).
        let defaults = SettingsState::default();
        let value = serde_json::to_value(&defaults.protected_categories).unwrap();
        let req = SettingsUpdateRequest {
            key: "protectedCategories".to_owned(),
            value: contracts_core::JsonAny::from(value),
        };
        let resp = update_setting(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(resp.status, SettingsUpdateStatus::Noop);
    }

    // ── T016: invalid stored value resets to default ───────────────────

    #[tokio::test]
    async fn get_settings_repairs_invalid_stored_value() {
        let (db, bus) = setup().await;
        // Inject an invalid value directly.
        repo::set_raw(db.pool(), "logLevel", &serde_json::json!("trace")).await.unwrap();
        let resp = get_settings(db.pool(), &bus).await.unwrap();
        // Should have been repaired to the default.
        assert_eq!(resp.settings.log_level, "info");
        // The bad row should have been deleted.
        let raw = repo::get_raw(db.pool(), "logLevel").await.unwrap();
        assert!(raw.is_none());
    }

    // ── T021/T022: source override tests ──────────────────────────────

    #[tokio::test]
    async fn set_source_override_happy_path() {
        let (db, _bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: "hashOnScan".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("eager")),
        };
        let resp = set_source_override(db.pool(), &req).await.unwrap();
        assert_eq!(resp.source_id, "src-abc");
        assert_eq!(resp.key, "hashOnScan");
    }

    #[tokio::test]
    async fn set_source_override_rejects_unoverridable_key() {
        let (db, _bus) = setup().await;
        let req = SetSourceOverrideRequest {
            source_id: "src-abc".to_owned(),
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        let err = set_source_override(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "key.unoverridable");
    }

    // ── T022: resolution order ─────────────────────────────────────────

    #[tokio::test]
    async fn resolve_setting_prefers_source_override() {
        let (db, bus) = setup().await;

        // Set global to "eager".
        let req = SettingsUpdateRequest {
            key: "hashOnScan".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("eager")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // Set source override to "off".
        let ov_req = SetSourceOverrideRequest {
            source_id: "src-1".to_owned(),
            key: "hashOnScan".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("off")),
        };
        set_source_override(db.pool(), &ov_req).await.unwrap();

        let resolved = resolve_setting(db.pool(), "hashOnScan", Some("src-1")).await.unwrap();
        assert_eq!(resolved, serde_json::json!("off"));
    }

    #[tokio::test]
    async fn resolve_setting_falls_back_to_global() {
        let (db, bus) = setup().await;
        let req = SettingsUpdateRequest {
            key: "hashOnScan".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("eager")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // No override for "src-2".
        let resolved = resolve_setting(db.pool(), "hashOnScan", Some("src-2")).await.unwrap();
        assert_eq!(resolved, serde_json::json!("eager"));
    }

    #[tokio::test]
    async fn resolve_setting_falls_back_to_default() {
        let (db, _bus) = setup().await;
        let resolved = resolve_setting(db.pool(), "hashOnScan", None).await.unwrap();
        assert_eq!(resolved, serde_json::json!("lazy")); // default
    }

    // ── T026: restore_defaults contract tests ──────────────────────────

    #[tokio::test]
    async fn restore_defaults_restores_changed_keys() {
        let (db, bus) = setup().await;

        // Change logLevel.
        let req = SettingsUpdateRequest {
            key: "logLevel".to_owned(),
            value: contracts_core::JsonAny::from(serde_json::json!("debug")),
        };
        update_setting(db.pool(), &bus, &req).await.unwrap();

        // Restore logLevel.
        let restore_req = RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
        let resp = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap();
        assert_eq!(resp.status, RestoreDefaultsStatus::Success);
        assert!(resp.restored.contains(&"logLevel".to_owned()));
        assert!(resp.already_at_default.is_empty());

        // Verify it's back to default.
        let restored_val = repo::get_raw(db.pool(), "logLevel").await.unwrap();
        assert_eq!(restored_val, Some(serde_json::json!("info")));
    }

    #[tokio::test]
    async fn restore_defaults_noop_when_already_at_default() {
        let (db, bus) = setup().await;
        let restore_req = RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
        let resp = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap();
        assert_eq!(resp.status, RestoreDefaultsStatus::Noop);
        assert!(resp.restored.is_empty());
        assert!(resp.already_at_default.contains(&"logLevel".to_owned()));
    }

    #[tokio::test]
    async fn restore_defaults_rejects_unknown_key() {
        let (db, bus) = setup().await;
        let restore_req = RestoreDefaultsRequest { keys: vec!["notAKey".to_owned()] };
        let err = restore_defaults(db.pool(), &bus, &restore_req).await.unwrap_err();
        assert_eq!(err.code, "key.unknown");
    }

    // ── Key validation unit tests ──────────────────────────────────────

    #[test]
    fn valid_keys_are_recognised() {
        assert!(is_valid_key("logLevel"));
        assert!(is_valid_key("pattern"));
        assert!(is_valid_key("calibration.dark.override_penalty"));
        assert!(is_valid_key("tools.pixinsight.bundle_id"));
        assert!(is_valid_key("tools.pixinsight.executable_path"));
        assert!(is_valid_key("tools.siril.enabled"));
        assert!(is_valid_key("tools.startools.auto_detected"));
        assert!(is_valid_key("workflow_profile.my_profile.watch_extensions"));
        assert!(is_valid_key("workflow_profile.my_profile.launch_attribution_window_hours"));
    }

    #[test]
    fn invalid_keys_are_rejected() {
        assert!(!is_valid_key("notARealKey"));
        assert!(!is_valid_key("tools.UPPERCASE.bundle_id"));
        assert!(!is_valid_key("tools..bundle_id"));
        assert!(!is_valid_key("calibration.video.override_penalty")); // video not valid frame type
    }

    #[test]
    fn settings_value_eq_structural() {
        assert!(settings_value_eq(&serde_json::json!("info"), &serde_json::json!("info")));
        assert!(!settings_value_eq(&serde_json::json!("info"), &serde_json::json!("debug")));
        assert!(settings_value_eq(
            &serde_json::json!(["lights", "masters"]),
            &serde_json::json!(["lights", "masters"])
        ));
        assert!(!settings_value_eq(
            &serde_json::json!(["lights", "masters"]),
            &serde_json::json!(["masters", "lights"]) // order matters
        ));
    }
}
