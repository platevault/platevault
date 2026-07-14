// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 030 cleanup policy + spec 017 cleanup candidate commands.
//!
//! Two-step cleanup flow (D11):
//!   - `cleanup.scan` — pure, read-only preview (candidates + reclaimable bytes);
//!     creates NO plan.
//!   - `cleanup.plan.generate` — materialise a reviewable cleanup plan from the
//!     same candidates via the spec-016 protection generator.
//!
//! Policy is persisted through `app_core::cleanup_generator` (the generic
//! `protection_defaults` store, D13); these commands are thin adapters.

use app_core::cleanup_generator;
use contracts_core::cleanup::{
    CleanupPolicy, CleanupScanResult, GenerateCleanupPlanRequest, GenerateCleanupPlanResult,
    RawFrameCleanupGenerateRequest, RawFrameCleanupScanRequest, RawFrameCleanupScanResponse,
    UpdateCleanupPolicy,
};
use contracts_core::ContractError;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `cleanup.policy.get` — returns the persisted cleanup policy (or the default).
///
/// # Errors
/// Returns `ContractError` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_policy_get(
    state: State<'_, AppState>,
) -> Result<CleanupPolicy, ContractError> {
    tracing::debug!("cleanup.policy.get");
    cleanup_generator::get_policy(state.repo.pool()).await
}

/// `cleanup.policy.update` — persist the cleanup policy.
///
/// # Errors
/// Returns `ContractError` on serialisation or database failure.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_policy_update(
    state: State<'_, AppState>,
    request: UpdateCleanupPolicy,
) -> Result<CleanupPolicy, ContractError> {
    tracing::debug!(
        "cleanup.policy.update ({} entries, auto={})",
        request.entries.len(),
        request.auto_on_completion,
    );
    let policy =
        CleanupPolicy { entries: request.entries, auto_on_completion: request.auto_on_completion };
    cleanup_generator::set_policy(state.repo.pool(), &policy).await
}

/// `cleanup.scan` — pure, read-only cleanup preview for a project (D11 step 1).
///
/// Enumerates the project's observed processing artifacts, classifies them,
/// applies the persisted policy, and returns candidate files plus reclaimable
/// bytes. Creates NO plan and performs NO filesystem mutation.
///
/// # Errors
/// Returns `ContractError` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_scan(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<CleanupScanResult, ContractError> {
    tracing::debug!("cleanup.scan project_id={project_id}");
    cleanup_generator::scan(state.repo.pool(), &project_id).await
}

/// `cleanup.plan.generate` — materialise a reviewable cleanup plan (D11 step 2).
///
/// Builds plan items from the current cleanup candidates and delegates to the
/// spec-016 protection generator, which resolves per-item protection and gates
/// approval. Generating the plan performs NO filesystem mutation (FR-002).
///
/// # Errors
/// Returns `ContractError` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_plan_generate(
    state: State<'_, AppState>,
    request: GenerateCleanupPlanRequest,
) -> Result<GenerateCleanupPlanResult, ContractError> {
    tracing::debug!("cleanup.plan.generate project_id={}", request.project_id);
    cleanup_generator::generate(
        state.repo.pool(),
        &request.project_id,
        request.title.as_deref(),
        request.destructive_destination.as_deref(),
    )
    .await
}

/// `cleanup.raw_frames.scan` — pure, read-only raw sub-frame cleanup preview
/// for a root or session (spec 048 US3). Distinct from `cleanup.scan`, which
/// enumerates a project's processing artifacts; this enumerates present,
/// non-protected per-frame inventory entries. Creates NO plan and performs
/// NO filesystem mutation.
///
/// # Errors
/// Returns `ContractError` on database failure or an invalid/empty scope.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_raw_frames_scan(
    state: State<'_, AppState>,
    request: RawFrameCleanupScanRequest,
) -> Result<RawFrameCleanupScanResponse, ContractError> {
    tracing::debug!("cleanup.raw_frames.scan scope={:?}", request.scope);
    cleanup_generator::scan_raw_frames(state.repo.pool(), &request).await
}

/// `cleanup.raw_frames.generate` — materialise a reviewable cleanup plan for
/// user-selected raw sub-frames (spec 048 US3). Reuses the same protection
/// generator tail as `cleanup.plan.generate` (PR #408 overlap guard,
/// `.astro-plan-archive/<planId>/` destination). Performs NO filesystem
/// mutation (FR-019).
///
/// # Errors
/// Returns `ContractError` on database failure or when no selected frame id
/// resolves to a present `file_record` row.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_raw_frames_generate(
    state: State<'_, AppState>,
    request: RawFrameCleanupGenerateRequest,
) -> Result<GenerateCleanupPlanResult, ContractError> {
    tracing::debug!("cleanup.raw_frames.generate selected={}", request.selected_frame_ids.len());
    cleanup_generator::generate_raw_frame_plan(state.repo.pool(), &request).await
}
