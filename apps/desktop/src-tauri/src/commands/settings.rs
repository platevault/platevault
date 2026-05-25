//! Spec 029 settings stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::settings::SettingsData;
use contracts_core::JsonAny;

/// `settings.get` — returns settings for a given scope.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "settings.get")]
pub async fn settings_get(scope: String) -> Result<SettingsData, String> {
    tracing::debug!("stub: settings.get scope={scope}");
    Ok(SettingsData {
        scope,
        values: JsonAny::from(serde_json::json!({
            "naming_pattern": "{target}/{date}/{filter}/{target}_{filter}_{sequence}.fits",
            "default_source_view_strategy": "symlink",
            "calibration_age_warning_days": 90
        })),
    })
}

/// `settings.update` — update settings for a given scope.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "settings.update")]
pub async fn settings_update(
    scope: String,
    values: JsonAny,
) -> Result<(), String> {
    tracing::debug!("stub: settings.update scope={scope} values={values:?}");
    Ok(())
}
