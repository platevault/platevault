//! Pattern Tauri commands (spec 015, T3.8).
//!
//! Three typed commands:
//! - `pattern.validate`  — structural validation without metadata.
//! - `pattern.resolve`   — full resolution against a metadata bundle.
//! - `pattern.preview`   — preview for the Settings UI live preview.
//!
//! None of these commands touch the database; they are pure-function wrappers
//! around `app_core::patterns`.

use contracts_core::patterns::{
    PatternPreviewRequest, PatternPreviewResponse, PatternResolveRequest, PatternResolveResponse,
    PatternValidateRequest, PatternValidateResponse,
};

/// `pattern.validate` — structural validation without resolving against metadata.
///
/// Returns `PatternValidateResponse { valid, warnings, error_code?, ... }`.
/// Never returns `Err`; all error states are encoded in the response body so the
/// frontend can call this unconditionally.
///
/// # Errors
///
/// Returns `Err(String)` on internal failure (none expected in v1).
#[tauri::command]
#[specta::specta(rename = "pattern.validate")]
#[allow(clippy::needless_pass_by_value)] // Tauri deserializes the request by value
pub fn pattern_validate(
    request: PatternValidateRequest,
) -> Result<PatternValidateResponse, String> {
    tracing::debug!("pattern.validate parts={}", request.pattern.len());
    app_core::patterns::validate_pattern(&request).map_err(|e| e.message)
}

/// `pattern.resolve` — resolve a pattern against a metadata bundle.
///
/// Returns `PatternResolveResponse { relative_path, missing_tokens, warnings }`.
///
/// # Errors
///
/// Returns `Err(String)` with the error code on invalid patterns or paths.
#[tauri::command]
#[specta::specta(rename = "pattern.resolve")]
#[allow(clippy::needless_pass_by_value)] // Tauri deserializes the request by value
pub fn pattern_resolve(request: PatternResolveRequest) -> Result<PatternResolveResponse, String> {
    tracing::debug!("pattern.resolve parts={}", request.pattern.len());
    app_core::patterns::resolve_pattern(&request).map_err(|e| e.message)
}

/// `pattern.preview` — resolve a pattern against sample metadata for the UI.
///
/// Returns `PatternPreviewResponse { resolved_path, missing_tokens, warnings }`.
///
/// # Errors
///
/// Returns `Err(String)` with the error code on invalid patterns or paths.
#[tauri::command]
#[specta::specta(rename = "pattern.preview")]
#[allow(clippy::needless_pass_by_value)] // Tauri deserializes the request by value
pub fn pattern_preview(request: PatternPreviewRequest) -> Result<PatternPreviewResponse, String> {
    tracing::debug!("pattern.preview parts={}", request.pattern.len());
    app_core::patterns::preview_pattern(&request).map_err(|e| e.message)
}
