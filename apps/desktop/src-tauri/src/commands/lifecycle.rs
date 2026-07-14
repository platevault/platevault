// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 002 lifecycle commands exposed to the Tauri webview.
//!
//! Every command is annotated with both `#[tauri::command]` (so Tauri
//! discovers it) and `#[specta::specta]` (so tauri-specta emits a typed TS
//! binding for it). Inputs/outputs are the language-neutral contract DTOs in
//! `contracts_core::{lifecycle,provenance}` plus a small ledger filter DTO
//! defined locally so we don't leak persistence-internal types through the
//! IPC boundary.

use std::sync::Arc;

use app_core::ledger_use_case::list_assets_ledger;
use app_core::provenance_use_case::read_provenance;
use app_core::transition_use_case::{apply_transition, preview_transition};
use audit::bus::EventBus;
use contracts_core::lifecycle::{TransitionRequest, TransitionResponse};
use contracts_core::provenance::{ProvenanceReadRequest, ProvenanceReadResponse};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::lifecycle::{LedgerFilter, LedgerRow, SqliteLifecycleRepository};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;
use uuid::Uuid;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub repo: Arc<SqliteLifecycleRepository>,
    pub bus: EventBus,
    /// Spec 052 P1 (D2): the shared SIMBAD resolve cache — one global redb
    /// file, opened once at app startup. Readers clone the cheap `Arc`-backed
    /// handle out from under a short-lived read lock; `target.cache.clear`
    /// (`commands::resolve_cache::clear_and_rewarm`) takes the write lock to
    /// swap in a freshly reopened, re-warmed store.
    pub resolve_cache: tokio::sync::RwLock<targeting_resolver::simbad::ResolveCache>,
    /// Filesystem path backing `resolve_cache`, needed by
    /// `target.cache.clear` to delete + reopen the redb file.
    pub resolve_cache_path: std::path::PathBuf,
}

impl AppState {
    #[must_use]
    pub fn new(
        repo: Arc<SqliteLifecycleRepository>,
        bus: EventBus,
        resolve_cache: targeting_resolver::simbad::ResolveCache,
        resolve_cache_path: std::path::PathBuf,
    ) -> Self {
        Self {
            repo,
            bus,
            resolve_cache: tokio::sync::RwLock::new(resolve_cache),
            resolve_cache_path,
        }
    }
}

/// JSON-friendly ledger filter mirrored to TypeScript via specta.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LedgerFilterDto {
    #[serde(default)]
    pub entity_types: Vec<String>,
    #[serde(default)]
    pub states: Vec<String>,
    #[serde(default)]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub updated_after: Option<String>,
    #[serde(default)]
    pub updated_before: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

impl LedgerFilterDto {
    fn into_filter(self) -> LedgerFilter {
        LedgerFilter {
            entity_types: self.entity_types.iter().filter_map(|s| parse_entity_type(s)).collect(),
            states: self.states,
            project_id: self.project_id.map(EntityId::from_uuid),
            updated_after: self.updated_after,
            updated_before: self.updated_before,
            limit: self.limit,
            offset: self.offset,
        }
    }
}

fn parse_entity_type(s: &str) -> Option<EntityType> {
    Some(match s {
        "library_root" => EntityType::LibraryRoot,
        "file_record" => EntityType::FileRecord,
        "data_source" => EntityType::DataSource,
        "project" => EntityType::Project,
        "prepared_source" => EntityType::PreparedSource,
        "processing_artifact" => EntityType::ProcessingArtifact,
        "projection" => EntityType::Projection,
        "plan" => EntityType::Plan,
        "filesystem_plan" => EntityType::FilesystemPlan,
        _ => return None,
    })
}

/// `provenance.read` Tauri command — returns the contract response shape.
///
/// # Errors
/// Never returns `Err`; persistence failures are folded into
/// `ProvenanceReadResponse::error(...)`. The `Result` shape exists so the
/// frontend's invoke wrapper still gets a typed envelope.
#[tauri::command]
#[specta::specta]
pub async fn provenance_read(
    state: State<'_, AppState>,
    request: ProvenanceReadRequest,
) -> Result<ProvenanceReadResponse, String> {
    Ok(read_provenance(state.repo.pool(), request).await)
}

/// `lifecycle.transition.apply` Tauri command.
///
/// # Errors
/// Never returns `Err`; refusal / persistence errors fold into
/// `TransitionResponse::error(...)` per the contract.
#[tauri::command]
#[specta::specta]
pub async fn lifecycle_transition_apply(
    state: State<'_, AppState>,
    request: TransitionRequest,
) -> Result<TransitionResponse, String> {
    Ok(apply_transition(state.repo.as_ref(), &state.bus, request).await)
}

/// `lifecycle.transition.preview` — read-only dry-run for UI button enabling.
///
/// # Errors
/// Never returns `Err`; refusal codes fold into `TransitionResponse::error(...)`.
#[tauri::command]
#[specta::specta]
pub async fn lifecycle_transition_preview(
    request: TransitionRequest,
) -> Result<TransitionResponse, String> {
    Ok(preview_transition(request))
}

/// camelCase wire shape mirroring [`LedgerRow`] for the typed Tauri surface.
///
/// `LedgerRow` itself doesn't derive `specta::Type` (the persistence layer
/// stays language-internal). This DTO is the IPC projection.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRowDto {
    pub entity_id: Uuid,
    pub entity_type: String,
    pub current_state: String,
    pub title: Option<String>,
    pub path: Option<String>,
    pub project_id: Option<Uuid>,
    pub updated_at: Option<String>,
}

impl From<LedgerRow> for LedgerRowDto {
    fn from(row: LedgerRow) -> Self {
        Self {
            entity_id: row.entity_id.as_uuid(),
            entity_type: row.entity_type.as_str().to_owned(),
            current_state: row.current_state,
            title: row.title,
            path: row.path,
            project_id: row.project_id.map(EntityId::as_uuid),
            updated_at: row.updated_at,
        }
    }
}

/// `lifecycle.ledger.list` Tauri command.
///
/// # Errors
/// Returns a stringified persistence error when the repository query fails
/// (e.g. transient DB unavailability). Successful empty results are `Ok(vec![])`.
#[tauri::command]
#[specta::specta]
pub async fn lifecycle_ledger_list(
    state: State<'_, AppState>,
    filter: LedgerFilterDto,
) -> Result<Vec<LedgerRowDto>, String> {
    list_assets_ledger(state.repo.as_ref(), filter.into_filter())
        .await
        .map(|rows| rows.into_iter().map(LedgerRowDto::from).collect())
        .map_err(|err| err.to_string())
}
