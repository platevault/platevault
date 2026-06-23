//! Settings Tauri commands (spec 018, T014/T015).
//!
//! ## Stable transport (T015)
//!
//! The frontend calls two stable commands that use a `scope/values` shape:
//!
//! - `settings.get { scope } -> SettingsData { scope, values }` — reads all
//!   keys that belong to `scope`, returns them as a flat JSON object.
//! - `settings.update { scope, values }` — persists every key in `values`
//!   using the key names as settings keys (validated per-key by the use case).
//!
//! The scope groups keys by workflow area:
//! - `"advanced"` → `logLevel`, `rememberFollowLogs`, `devMode`
//! - `"general"`  → (empty; rowDensity removed T032)
//! - `"cleanup"`  → `blockPermanentDelete`, `defaultProtection`, `protectedCategories`
//! - `"naming"`   → `pattern`, `autoApplyPattern`, `patternsByType`
//! - `"sources"`  → `followSymlinks`, `hashOnScan`
//! - `"calibration"` → `darkMatchTolerance`, `flatMatching`, `suggestCalibration`,
//!   `calibrationDarkTempTolerance`, `calibrationPrefillSuggestion`
//! - `""` (empty) → reads the full settings bag (all known keys).
//!
//! Unknown `values` keys from the frontend that are not valid settings keys are
//! silently skipped (best-effort write) so fixture-driven panes can call
//! `save(scope, {...})` without causing errors.
//!
//! ## Additional commands
//!
//! Richer per-key surface exposed as additional commands (do not disturb the
//! stable transport above):
//! - `settings.restore-defaults`
//! - `settings.source-override.set`

use std::collections::HashMap;

use contracts_core::settings::{
    RestoreDefaultsRequest, RestoreDefaultsResponse, SetSourceOverrideRequest,
    SetSourceOverrideResponse, SettingsData, SettingsUpdateRequest,
};
use serde_json::Value;
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

// ── Scope → key mapping ───────────────────────────────────────────────────────

/// Keys owned by each scope (for `settings.get`).
///
/// The `""` / catch-all case returns all known stable keys.
fn scope_keys(scope: &str) -> &'static [&'static str] {
    match scope {
        "advanced" => &["logLevel", "rememberFollowLogs", "devMode"],
        "general" => &[],
        "cleanup" => &["blockPermanentDelete", "defaultProtection", "protectedCategories"],
        "naming" => &["pattern", "autoApplyPattern", "patternsByType"],
        "sources" => &["followSymlinks", "hashOnScan", "alwaysPreviewBeforePlan"],
        "calibration" => &[
            "darkMatchTolerance",
            "flatMatching",
            "suggestCalibration",
            "calibrationDarkTempTolerance",
            "calibrationPrefillSuggestion",
            "calibrationDarkOverridePenalty",
            "calibrationFlatOverridePenalty",
            "calibrationBiasOverridePenalty",
            "calibrationAgingThresholdDays",
        ],
        "plans" => &["plansListDefaultAgeCutoffDays"],
        // Empty scope or "global" returns every stable key.
        _ => &[
            "logLevel",
            "rememberFollowLogs",
            "devMode",
            "blockPermanentDelete",
            "defaultProtection",
            "protectedCategories",
            "pattern",
            "autoApplyPattern",
            "patternsByType",
            "followSymlinks",
            "hashOnScan",
            "alwaysPreviewBeforePlan",
            "darkMatchTolerance",
            "flatMatching",
            "suggestCalibration",
            "calibrationDarkTempTolerance",
            "calibrationPrefillSuggestion",
            "calibrationDarkOverridePenalty",
            "calibrationFlatOverridePenalty",
            "calibrationBiasOverridePenalty",
            "calibrationAgingThresholdDays",
            "plansListDefaultAgeCutoffDays",
            "currentLibraryId",
        ],
    }
}

// ── Stable transport commands ────────────────────────────────────────────────

/// `settings.get` — returns settings for a given scope.
///
/// Accepts `{ scope: string }` and returns `SettingsData { scope, values }`.
/// Each key that belongs to the scope is resolved via the persistence layer
/// (hydrating the in-code default when no stored row exists).
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn settings_get(
    state: State<'_, AppState>,
    scope: String,
) -> Result<SettingsData, ContractError> {
    tracing::debug!("settings.get scope={scope}");
    let pool = state.repo.pool();
    let keys = scope_keys(&scope);

    let mut values: HashMap<String, Value> = HashMap::with_capacity(keys.len());
    for key in keys {
        let val = app_core::settings::resolve_setting(pool, key, None).await?;
        values.insert((*key).to_owned(), val);
    }

    Ok(SettingsData {
        scope,
        values: contracts_core::JsonAny::from(serde_json::to_value(values).unwrap_or_default()),
    })
}

/// `settings.update` — persists settings values for a given scope.
///
/// Accepts `{ scope: string, values: Record<string, unknown> }`. Each entry in
/// `values` is persisted as an individual settings key if it is a known valid
/// key. Unknown keys (from fixture-driven panes) are silently skipped so the
/// frontend does not need to filter its payload.
///
/// # Errors
/// Returns `Err(String)` on database or audit failure.
#[tauri::command]
#[specta::specta]
pub async fn settings_update(
    state: State<'_, AppState>,
    scope: String,
    values: contracts_core::JsonAny,
) -> Result<(), ContractError> {
    tracing::debug!("settings.update scope={scope}");
    let pool = state.repo.pool();
    let bus = &state.bus;

    let obj = match values.0.as_object() {
        Some(o) => o.clone(),
        None => return Ok(()), // Nothing to persist.
    };

    for (key, value) in obj {
        // Only persist keys that are known to the settings use case.
        if !app_core::settings::is_valid_key(&key) {
            tracing::debug!("settings.update: skipping unknown key {key}");
            continue;
        }
        let req =
            SettingsUpdateRequest { key: key.clone(), value: contracts_core::JsonAny::from(value) };
        // Swallow noop and value.invalid for forward-compat; log errors.
        match app_core::settings::update_setting(pool, bus, &req).await {
            Ok(_) => {}
            Err(e) if e.code == contracts_core::error_code::ErrorCode::ValueInvalid => {
                tracing::warn!("settings.update: value.invalid for key {key}: {}", e.message);
            }
            Err(e) => return Err(e),
        }
    }

    Ok(())
}

// ── Additional commands (richer per-key surface) ──────────────────────────────

/// `settings.restore-defaults` — restore one, several, or all keys to defaults.
///
/// # Errors
/// Returns `Err(String)` with code `"key.unknown"` for unknown keys.
#[tauri::command]
#[specta::specta]
pub async fn settings_restore_defaults(
    state: State<'_, AppState>,
    request: RestoreDefaultsRequest,
) -> Result<RestoreDefaultsResponse, ContractError> {
    tracing::debug!("settings.restore-defaults keys={:?}", request.keys);
    app_core::settings::restore_defaults(state.repo.pool(), &state.bus, &request).await
}

/// `settings.source-override.set` — set a per-source override for an overridable key.
///
/// # Errors
/// Returns `Err(String)` with code `"key.unoverridable"` or `"value.invalid"`.
#[tauri::command]
#[specta::specta]
pub async fn settings_source_override_set(
    state: State<'_, AppState>,
    request: SetSourceOverrideRequest,
) -> Result<SetSourceOverrideResponse, ContractError> {
    tracing::debug!(
        "settings.source-override.set source_id={} key={}",
        request.source_id,
        request.key
    );
    app_core::settings::set_source_override(state.repo.pool(), &request).await
}

/// `settings.overridable-keys` — return the list of stable settings keys that
/// can be overridden per source root (spec 018 T025).
///
/// The frontend uses this to populate the key selector in the source override
/// panel without hardcoding key names.
///
/// # Errors
/// Never errors in practice; returns `Ok` always.
#[tauri::command]
#[specta::specta]
pub async fn settings_overridable_keys(
    _state: State<'_, AppState>,
) -> Result<Vec<String>, ContractError> {
    Ok(app_core::settings::overridable_keys())
}
