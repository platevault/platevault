//! Target lookup and resolve Tauri commands (spec 013).
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks
//!
//! ## Commands
//!
//! - `target.lookup` — ranked candidate list from a free-form query.
//! - `target.resolve` — single-value resolution for a FITS OBJECT hint.
//!
//! Both commands use the in-memory [`targeting::catalog::TargetCatalog`]
//! loaded at startup from SQLite. The catalog is held in `AppState.catalog`
//! behind an `Arc<RwLock>` so it can be rebuilt on
//! `catalog.download.completed` without restarting the app.
//!
//! ## Ingestion integration boundary (spec 005)
//!
//! The `target.resolve` use case in `app_core::target_lookup::resolve` is the
//! designated entry point for the ingestion/metadata pipeline. When spec 005
//! is implemented it should call that function directly (not this Tauri
//! command) and treat non-`resolved` outcomes as non-blocking.

use contracts_core::target_lookup::{
    TargetLookupRequest, TargetLookupResponse, TargetResolveRequest, TargetResolveResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── target.lookup ─────────────────────────────────────────────────────────────

/// `target.lookup` — ranked candidate list from a free-form query.
///
/// Runs the normalize → exact → fuzzy → edit-distance pipeline and returns
/// ranked matches for the UI catalog picker.
///
/// # Errors
///
/// Returns `Err(String)` on unexpected internal failure. Lookup errors
/// (empty query, catalog not installed) are encoded in the response body.
#[tauri::command]
#[specta::specta]
pub async fn target_lookup(
    state: State<'_, AppState>,
    req: TargetLookupRequest,
) -> Result<TargetLookupResponse, String> {
    tracing::debug!("target.lookup query={:?} limit={}", req.query, req.limit);
    let catalog =
        targeting::load::load_from_db(state.repo.pool()).await.map_err(|e| e.to_string())?;
    Ok(app_core::target_lookup::lookup(&catalog, &req))
}

// ── target.resolve ────────────────────────────────────────────────────────────

/// `target.resolve` — resolve a FITS OBJECT header value to a stable target.
///
/// Non-blocking: callers MUST handle `unresolved`, `ambiguous`, and `error`
/// responses without blocking the ingestion flow (FR-006, constitution §II).
///
/// # Errors
///
/// Returns `Err(String)` on unexpected internal failure. Resolution errors
/// (empty query, catalog not installed) are encoded in the response status.
#[tauri::command]
#[specta::specta]
pub async fn target_resolve(
    state: State<'_, AppState>,
    req: TargetResolveRequest,
) -> Result<TargetResolveResponse, String> {
    tracing::debug!("target.resolve fits_object_value={:?}", req.fits_object_value);
    let catalog =
        targeting::load::load_from_db(state.repo.pool()).await.map_err(|e| e.to_string())?;
    Ok(app_core::target_lookup::resolve(&catalog, &req))
}
