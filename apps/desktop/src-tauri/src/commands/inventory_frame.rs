// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-frame inventory Tauri commands (spec 048 T006).
//!
//! `inventory_frame_list`, `inventory_reconcile_run`, and
//! `inventory_frame_relink` are wired through `app_core::frame_inventory`.
//! `inventory_root_config_get`/`_set` are wired through
//! `app_core_settings::root_config`.
//!
//! Command fn names below are the literal Tauri invoke targets (no specta
//! rename) — e.g. `inventory_frame_list` is invoked as `"inventory_frame_list"`.

use app_core::frame_inventory::{list_frames, relink_frame, run_reconcile};
use app_core::settings::root_config::{get_root_config, set_root_config};
use contracts_core::inventory_frame::{
    InventoryFrameListRequest, InventoryFrameListResponse, InventoryFrameRelinkRequest,
    InventoryFrameRelinkResponse, InventoryReconcileRunRequest, InventoryReconcileRunResponse,
    RootConfigGetRequest, RootConfigSetRequest, RootInventoryConfig,
};
use contracts_core::ContractError;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// `inventory.frame.list` — list per-frame inventory entries for a session
/// or root.
///
/// # Errors
/// Returns `ContractError` on database failure or an invalid scope.
#[tauri::command]
#[specta::specta]
pub async fn inventory_frame_list(
    req: InventoryFrameListRequest,
    pool: State<'_, SqlitePool>,
) -> Result<InventoryFrameListResponse, ContractError> {
    list_frames(&pool, &req).await
}

/// `inventory.reconcile.run` — run a reconciliation pass over a root.
///
/// # Errors
/// Returns `ContractError` (`root.unavailable`) when the root is not
/// registered, or a database error otherwise. Never mutates a file.
#[tauri::command]
#[specta::specta]
pub async fn inventory_reconcile_run(
    req: InventoryReconcileRunRequest,
    pool: State<'_, SqlitePool>,
    app_state: State<'_, AppState>,
) -> Result<InventoryReconcileRunResponse, ContractError> {
    run_reconcile(&pool, &app_state.bus, &req).await
}

/// `inventory.frame.relink` — relink a surfaced missing frame to a candidate
/// file under the same root, confirmed by sha256 content hash.
///
/// # Errors
/// Returns `ContractError` (`frame.not_found`, `root.unavailable`,
/// `file.not_found`, `hash.mismatch`) per `app_core::frame_inventory::relink_frame`.
#[tauri::command]
#[specta::specta]
pub async fn inventory_frame_relink(
    req: InventoryFrameRelinkRequest,
    pool: State<'_, SqlitePool>,
    app_state: State<'_, AppState>,
) -> Result<InventoryFrameRelinkResponse, ContractError> {
    relink_frame(&pool, &app_state.bus, &req).await
}

/// `inventory.root_config.get` — read a root's reconcile/detection
/// configuration, with documented defaults filled in for unset keys.
///
/// # Errors
/// Returns `ContractError` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn inventory_root_config_get(
    req: RootConfigGetRequest,
    pool: State<'_, SqlitePool>,
) -> Result<RootInventoryConfig, ContractError> {
    get_root_config(&pool, &req.root_id).await
}

/// `inventory.root_config.set` — write a (possibly partial) update to a
/// root's reconcile/detection configuration.
///
/// # Errors
/// Returns `ContractError` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn inventory_root_config_set(
    req: RootConfigSetRequest,
    pool: State<'_, SqlitePool>,
) -> Result<RootInventoryConfig, ContractError> {
    set_root_config(&pool, &req).await
}
