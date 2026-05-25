//! Spec 029 tour stubs exposed to the Tauri webview.
//!
//! Stub implementations for guided-tour step completion tracking.

/// `tour.complete_step` — mark a tour step as completed.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "tour.complete_step")]
pub async fn tour_complete_step(step: String) -> Result<(), String> {
    tracing::debug!("stub: tour.complete_step step={step}");
    Ok(())
}
