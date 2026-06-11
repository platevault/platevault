//! Project manifest and notes Tauri commands (spec 024).
//!
//! ## Commands
//!
//! - `project.manifest.list`         — list manifest summaries (paginated, newest first).
//! - `project.manifest.get`          — fetch one manifest with full body.
//! - `project.note.get`              — fetch the current notes body for a project.
//! - `project.note.update`           — replace the project's free-text notes.
//! - `project.manifest.reveal_in_os` — open the manifest file in the OS file manager.

use app_core::{project_manifests, project_notes};
use contracts_core::manifests::{
    ManifestGetResponse, ManifestListRequest, ManifestListResponse, ManifestOpError,
    ManifestRevealRequest, ProjectNoteGetRequest, ProjectNoteGetResult, ProjectNoteUpdateRequest,
    ProjectNoteUpdateResult,
};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::commands::lifecycle::AppState;

// ── project.manifest.list ─────────────────────────────────────────────────────

/// `project.manifest.list` — list manifest snapshots for a project.
///
/// Returns summaries ordered newest first, with cursor-based pagination.
/// Default limit 50, max 200 (A6).
///
/// # Errors
/// Returns `Err(ManifestOpError)` on database failure.
#[tauri::command]
#[specta::specta(rename = "project.manifest.list")]
pub async fn manifest_list(
    state: State<'_, AppState>,
    request: ManifestListRequest,
) -> Result<ManifestListResponse, ManifestOpError> {
    tracing::debug!("project.manifest.list project={}", request.project_id);
    project_manifests::list(state.repo.pool(), request).await
}

// ── project.manifest.get ──────────────────────────────────────────────────────

/// `project.manifest.get` — fetch one manifest with its full structured body.
///
/// # Errors
/// Returns `Err(ManifestOpError)` with code `"manifest.not_found"` when the
/// manifest does not exist.
#[tauri::command]
#[specta::specta(rename = "project.manifest.get")]
pub async fn manifest_get(
    state: State<'_, AppState>,
    request: ManifestGetRequest,
) -> Result<ManifestGetResponse, ManifestOpError> {
    tracing::debug!("project.manifest.get id={}", request.manifest_id);
    project_manifests::get(state.repo.pool(), &request.manifest_id).await
}

/// Thin request wrapper for `project.manifest.get`.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestGetRequest {
    pub manifest_id: String,
}

// ── project.note.get ─────────────────────────────────────────────────────────

/// `project.note.get` — fetch the current notes body for a project.
///
/// Returns `content: null` when no note has been saved yet (project never had
/// notes written via `project.note.update`).
///
/// # Errors
/// Returns `Err(ManifestOpError)` with code `"internal"` on database failure.
#[tauri::command]
#[specta::specta(rename = "project.note.get")]
pub async fn note_get(
    state: State<'_, AppState>,
    req: ProjectNoteGetRequest,
) -> Result<ProjectNoteGetResult, ManifestOpError> {
    tracing::debug!("project.note.get project={}", req.project_id);
    let content = project_notes::get_note_content(state.repo.pool(), &req.project_id)
        .await
        .map_err(|e| ManifestOpError {
            code: "internal".to_owned(),
            message: format!("DB error: {e}"),
            details: None,
        })?;
    Ok(ProjectNoteGetResult { project_id: req.project_id, content })
}

// ── project.note.update ───────────────────────────────────────────────────────

/// `project.note.update` — replace the project's notes body.
///
/// - Max 16 384 UTF-8 bytes (A5).
/// - `project.read_only` when lifecycle is `"archived"` (R-NotesEdit).
///
/// # Errors
/// Returns `Err(ManifestOpError)` with codes: `"project.not_found"`,
/// `"project.read_only"`, `"note.content_too_large"`.
#[tauri::command]
#[specta::specta(rename = "project.note.update")]
pub async fn note_update(
    state: State<'_, AppState>,
    req: ProjectNoteUpdateRequest,
) -> Result<ProjectNoteUpdateResult, ManifestOpError> {
    tracing::debug!("project.note.update project={}", req.project_id);
    project_notes::update_note(state.repo.pool(), &state.bus, req, None).await
}

// ── project.manifest.reveal_in_os ────────────────────────────────────────────

/// `project.manifest.reveal_in_os` — open the manifest file's folder in the
/// OS file manager.
///
/// Delegates to `tauri-plugin-opener::reveal_item_in_dir`. On Linux, if the
/// opener plugin fails, falls back to `xdg-open` on the parent directory
/// (matching the pattern from `native.reveal`).
///
/// # Errors
/// Returns `Err(String)` when the path does not exist or the OS open fails.
#[tauri::command]
#[specta::specta(rename = "project.manifest.reveal_in_os")]
pub async fn manifest_reveal_in_os(
    _state: State<'_, AppState>,
    app: AppHandle,
    request: ManifestRevealRequest,
) -> Result<(), String> {
    tracing::debug!("project.manifest.reveal_in_os path={}", request.path);

    let path = std::path::Path::new(&request.path);
    if !path.exists() {
        return Err(format!("manifest file not found: {}", request.path));
    }

    match app.opener().reveal_item_in_dir(&request.path) {
        Ok(()) => Ok(()),
        Err(opener_err) => {
            // Linux fallback: xdg-open on the parent directory.
            #[cfg(target_os = "linux")]
            if let Some(parent) = path.parent() {
                let parent_str = parent.to_string_lossy();
                match std::process::Command::new("xdg-open").arg(parent_str.as_ref()).spawn() {
                    Ok(_) => return Ok(()),
                    Err(e) => {
                        tracing::warn!("manifest.reveal_in_os: xdg-open fallback failed: {e}");
                    }
                }
            }
            Err(format!("failed to reveal {} in file manager: {opener_err}", request.path))
        }
    }
}
