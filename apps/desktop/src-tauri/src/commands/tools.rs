//! Spec 030 processing tools commands (T028).
//!
//! Stubs for listing, updating, and validating processing tool paths.
//! Real tool detection and persistence will be wired in later tasks.

use contracts_core::tools::{ProcessingTool, ToolPathValidation, UpdateProcessingTool};

/// `tools.list` — list configured processing tools.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "tools.list")]
pub async fn tools_list() -> Result<Vec<ProcessingTool>, String> {
    tracing::debug!("stub: tools.list");
    Ok(vec![ProcessingTool {
        id: "pixinsight".to_owned(),
        name: "PixInsight".to_owned(),
        path: None,
        version: None,
        detected: false,
        enabled: true,
    }])
}

/// `tools.update` — update a processing tool configuration.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "tools.update")]
pub async fn tools_update(request: UpdateProcessingTool) -> Result<ProcessingTool, String> {
    tracing::debug!("stub: tools.update id={} path={:?}", request.id, request.path);
    Ok(ProcessingTool {
        id: request.id,
        name: "PixInsight".to_owned(),
        path: request.path,
        version: None,
        detected: false,
        enabled: request.enabled,
    })
}

/// `tools.validate_path` — validate a processing tool executable path.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "tools.validate_path")]
pub async fn tools_validate_path(path: String) -> Result<ToolPathValidation, String> {
    tracing::debug!("stub: tools.validate_path path={path}");
    let exists = std::path::Path::new(&path).exists();
    Ok(ToolPathValidation {
        path,
        valid: exists,
        reason: if exists { None } else { Some("Path does not exist".to_owned()) },
    })
}
