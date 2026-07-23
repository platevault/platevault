// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Source protection Tauri commands (spec 016 US2–US4).
//!
//! Implements the three JSON-Schema contracts:
//!   `source.protection.get`   — resolve effective protection for a source.
//!   `source.protection.set`   — set or replace a per-source protection override.
//!   `plan.protection.check`   — return protection-affected plan items for review.
//!
//! All logic lives in `crates/app/core/src/protection.rs`.
//! These commands are thin adapters.

use app_core::protection::{
    acknowledge_protected_item, get_source_protection, plan_protection_check, set_source_protection,
};
use contracts_core::protection::{
    PlanProtectionCheckRequest, PlanProtectionCheckResponse, SourceProtectionGetRequest,
    SourceProtectionGetResponse, SourceProtectionSetRequest, SourceProtectionSetResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

// ── source.protection.get ─────────────────────────────────────────────────────

/// `source.protection.get` — resolve effective protection for a source (US2, T012).
///
/// If `source_id` is `None`, returns the global defaults.
///
/// # Errors
///
/// Returns `Err(String)` with the contract error code on failure.
#[tauri::command]
#[specta::specta]
pub async fn source_protection_get(
    state: State<'_, AppState>,
    source_id: Option<String>,
) -> Result<SourceProtectionGetResponse, ContractError> {
    tracing::debug!("source.protection.get source_id={source_id:?}");
    let req = SourceProtectionGetRequest { source_id };
    get_source_protection(state.repo.pool(), &req).await
}

// ── source.protection.set ─────────────────────────────────────────────────────

/// `source.protection.set` — set or replace the protection override for a source
/// (US2, T013, T016).
///
/// # Errors
///
/// Returns `Err(String)` with the contract error code on failure.
#[tauri::command]
#[specta::specta]
pub async fn source_protection_set(
    state: State<'_, AppState>,
    request: SourceProtectionSetRequest,
) -> Result<SourceProtectionSetResponse, ContractError> {
    tracing::debug!(
        "source.protection.set source_id={} level={:?}",
        request.source_id,
        request.level
    );
    set_source_protection(state.repo.pool(), &state.bus, &request).await
}

// ── plan.protection.check ─────────────────────────────────────────────────────

/// `plan.protection.check` — return protection-affected plan items (US3, T023).
///
/// Only items requiring acknowledgement are returned in `protected_items`.
/// Normal and unprotected items appear only as summary counts.
///
/// # Errors
///
/// Returns `Err(String)` with `"plan.not_found"` if the plan does not exist.
#[tauri::command]
#[specta::specta]
pub async fn plan_protection_check_cmd(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<PlanProtectionCheckResponse, ContractError> {
    tracing::debug!("plan.protection.check plan_id={plan_id}");
    let req = PlanProtectionCheckRequest { plan_id };
    plan_protection_check(state.repo.pool(), &req).await
}

// ── protection.plan.acknowledged ──────────────────────────────────────────────

/// `protection.plan.acknowledged` — record user acknowledgement of a protected
/// plan item (US3, T025).
///
/// Returns the audit event id.
///
/// # Errors
///
/// Returns `Err(String)` on audit failure.
#[tauri::command]
#[specta::specta]
pub async fn protection_plan_acknowledged(
    state: State<'_, AppState>,
    plan_id: String,
    item_id: String,
    source_id: Option<String>,
    resolved_level: String,
    reason: String,
) -> Result<String, ContractError> {
    tracing::debug!("protection.plan.acknowledged plan_id={plan_id} item_id={item_id}");
    acknowledge_protected_item(
        &state.bus,
        &plan_id,
        &item_id,
        source_id.as_deref(),
        &resolved_level,
        &reason,
    )
    .await
}
