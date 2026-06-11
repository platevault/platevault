//! Processing tool Tauri commands (spec 011 T006/T007/T014/T015).
//!
//! ## Commands
//!
//! - `tools.launch`         — resolve project + tool → spawn detached process.
//! - `tools.list`           — list tool profiles joined with settings.
//! - `tools.update`         — save `executable_path` / enabled flag.
//! - `tools.validate_path`  — check an executable path.
//! - `tools.discover`       — auto-detect installed tool paths.
//!
//! Existing `tools.list`, `tools.update`, and `tools.validate_path` invocation
//! shapes are preserved for forwards-compatibility with the frontend.

use app_core::tool_launch;
use contracts_core::tools::{
    ToolDiscoverRequest, ToolDiscoverResponse, ToolLaunchRequest, ToolLaunchResponse,
    ToolPathValidation, ToolProfileListResponse, UpdateProcessingTool,
};
use tauri::State;
use workflow_profiles::launch::RealSpawner;

use crate::commands::lifecycle::AppState;

// ── tools.launch ──────────────────────────────────────────────────────────────

/// `tools.launch` — launch the configured processing tool for a project.
///
/// # Errors
/// Returns `Err(String)` on infrastructure failure.
#[tauri::command]
#[specta::specta(rename = "tools.launch")]
pub async fn tools_launch(
    state: State<'_, AppState>,
    request: ToolLaunchRequest,
) -> Result<ToolLaunchResponse, String> {
    tracing::debug!("tools.launch project={} tool={}", request.project_id, request.tool_id);
    let spawner = RealSpawner;
    tool_launch::launch(state.repo.pool(), &state.bus, &spawner, request).await
}

// ── tools.list ────────────────────────────────────────────────────────────────

/// `tools.list` — list all tool profiles joined with settings state.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
#[tauri::command]
#[specta::specta(rename = "tools.list")]
pub async fn tools_list(state: State<'_, AppState>) -> Result<ToolProfileListResponse, String> {
    tracing::debug!("tools.list");
    tool_launch::list_profiles(state.repo.pool()).await
}

// ── tools.update ──────────────────────────────────────────────────────────────

/// `tools.update` — save `executable_path` / enabled for a tool.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
#[tauri::command]
#[specta::specta(rename = "tools.update")]
pub async fn tools_update(
    state: State<'_, AppState>,
    request: UpdateProcessingTool,
) -> Result<contracts_core::tools::ToolProfileSummary, String> {
    tracing::debug!("tools.update id={} path={:?}", request.id, request.path);
    tool_launch::update_tool(state.repo.pool(), request).await
}

// ── tools.validate_path ───────────────────────────────────────────────────────

/// `tools.validate_path` — validate an executable path without spawning.
///
/// # Errors
/// Returns `Err(String)` on failure; this command never fails in practice.
#[tauri::command]
#[specta::specta(rename = "tools.validate_path")]
pub async fn tools_validate_path(path: String) -> Result<ToolPathValidation, String> {
    tracing::debug!("tools.validate_path path={path}");
    Ok(tool_launch::validate_path(&path))
}

// ── tools.discover ────────────────────────────────────────────────────────────

/// `tools.discover` — auto-detect installed tool executables for the current OS.
///
/// Returns detected paths; the user must explicitly save to activate them.
///
/// # Errors
/// Returns `Err(String)` on unexpected failure.
#[tauri::command]
#[specta::specta(rename = "tools.discover")]
pub async fn tools_discover(request: ToolDiscoverRequest) -> Result<ToolDiscoverResponse, String> {
    tracing::debug!("tools.discover tool_id={:?}", request.tool_id);
    tool_launch::discover(request.tool_id.as_deref())
}
