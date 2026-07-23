// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing artifact Tauri commands (spec 012 TX01/T008).
//!
//! ## Commands
//!
//! - `artifact.list`             — list observed artifacts for a project, grouped by tool launch.
//! - `artifact.classify`         — apply / clear a manual classification override.
//! - `artifact.mark_resolved`    — mark a missing artifact as user-resolved.
//! - `artifact.watcher.attach`   — attach the live filesystem watcher for a project (T008).
//! - `artifact.watcher.detach`   — detach it (project drawer close lifecycle, T008).

use app_core::artifact;
use contracts_core::tools::{
    ArtifactClassifyRequest, ArtifactClassifyResponse, ArtifactListRequest, ArtifactListResponse,
    ArtifactMarkResolvedRequest, ArtifactWatcherRequest,
};
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::lifecycle::AppState;
use crate::watcher::ArtifactWatcherRegistry;
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

// ── artifact.watcher.attach / artifact.watcher.detach ────────────────────────

/// `artifact.watcher.attach` — attach the live filesystem watcher for a
/// project's output folder (spec 012 T008: project drawer open lifecycle).
///
/// Idempotent: attaching an already-attached project is a no-op. Runs an
/// on-attach reconciliation pass first so files written while detached are
/// still detected.
///
/// # Errors
/// Returns `Err(ContractError)` on DB failure or if the watcher cannot be
/// started. An unavailable output folder (e.g. a removed drive) is NOT an
/// error — attach succeeds and simply does not watch until a later retry.
#[tauri::command]
#[specta::specta]
pub async fn artifact_watcher_attach(
    pool: State<'_, SqlitePool>,
    state: State<'_, AppState>,
    registry: State<'_, ArtifactWatcherRegistry>,
    request: ArtifactWatcherRequest,
) -> Result<(), ContractError> {
    tracing::debug!("artifact.watcher.attach project={}", request.project_id);
    crate::watcher::attach_project_watcher(&pool, &state.bus, &registry, &request.project_id)
        .await
        .map_err(ContractError::internal)
}

/// `artifact.watcher.detach` — detach the live filesystem watcher for a
/// project (spec 012 T008: project drawer close lifecycle).
///
/// Idempotent: detaching an unattached project is a silent no-op.
///
/// # Errors
/// Never fails; the `Result` return type matches the shared command shape.
#[tauri::command]
#[specta::specta]
pub async fn artifact_watcher_detach(
    registry: State<'_, ArtifactWatcherRegistry>,
    request: ArtifactWatcherRequest,
) -> Result<(), ContractError> {
    tracing::debug!("artifact.watcher.detach project={}", request.project_id);
    crate::watcher::detach_project_watcher(&registry, &request.project_id).await;
    Ok(())
}
