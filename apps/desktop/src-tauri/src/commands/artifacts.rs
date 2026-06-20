//! Processing artifact Tauri commands (spec 012 TX01).
//!
//! ## Commands
//!
//! - `artifact.list`           — list observed artifacts for a project, grouped by tool launch.
//! - `artifact.classify`       — apply / clear a manual classification override.
//! - `artifact.mark_resolved`  — mark a missing artifact as user-resolved.

use app_core::artifact;
use contracts_core::tools::{
    ArtifactClassifyRequest, ArtifactClassifyResponse, ArtifactListRequest, ArtifactListResponse,
    ArtifactMarkResolvedRequest,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

// ── artifact.list ─────────────────────────────────────────────────────────────

/// `artifact.list` — list processing artifacts for a project.
///
/// Returns artifacts grouped for the Tool Launches drawer accordion.
/// Defaults to `["present","missing"]` states when `include_states` is empty.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
#[tauri::command]
#[specta::specta]
pub async fn artifact_list(
    state: State<'_, AppState>,
    request: ArtifactListRequest,
) -> Result<ArtifactListResponse, ContractError> {
    tracing::debug!("artifact.list project={}", request.project_id);
    let states: Vec<&str> = request.include_states.iter().map(String::as_str).collect();
    let artifacts = artifact::list(state.repo.pool(), &request.project_id, &states)
        .await
        .map_err(ContractError::internal)?;
    Ok(ArtifactListResponse { artifacts })
}

// ── artifact.classify ─────────────────────────────────────────────────────────

/// `artifact.classify` — apply or clear a manual classification override.
///
/// Pass `kind: null` to clear the override and re-apply workflow-profile rules (A6).
///
/// # Errors
/// Returns `Err(String)` on DB failure or if the artifact is not found.
#[tauri::command]
#[specta::specta]
pub async fn artifact_classify(
    state: State<'_, AppState>,
    request: ArtifactClassifyRequest,
) -> Result<ArtifactClassifyResponse, ContractError> {
    tracing::debug!("artifact.classify artifact={} kind={:?}", request.artifact_id, request.kind);
    let summary = artifact::classify_override(
        state.repo.pool(),
        &state.bus,
        &request.project_id,
        &request.artifact_id,
        request.kind.as_deref(),
        request.reason.as_deref(),
    )
    .await
    .map_err(ContractError::internal)?;
    // Return the flat contract shape (spec 033 T028; drift fix from nested envelope).
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
    Ok(ArtifactClassifyResponse {
        artifact_id: summary.id,
        classification: summary.kind,
        confidence: Some(summary.classification_confidence),
        classified_at: now,
    })
}

// ── artifact.mark_resolved ────────────────────────────────────────────────────

/// `artifact.mark_resolved` — mark a `missing` artifact as user-resolved.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
#[tauri::command]
#[specta::specta]
pub async fn artifact_mark_resolved(
    state: State<'_, AppState>,
    request: ArtifactMarkResolvedRequest,
) -> Result<(), ContractError> {
    tracing::debug!("artifact.mark_resolved artifact={}", request.artifact_id);
    artifact::mark_resolved(
        state.repo.pool(),
        &state.bus,
        &request.project_id,
        &request.artifact_id,
    )
    .await
    .map_err(ContractError::internal)
}
