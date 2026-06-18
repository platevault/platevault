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
use contracts_core::targets::{
    TargetResolveSimbadRequest, TargetResolveSimbadResponse, TargetSearchRequest,
    TargetSearchResponse,
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
#[specta::specta(rename = "target.lookup")]
pub async fn target_lookup(
    state: State<'_, AppState>,
    req: TargetLookupRequest,
) -> Result<TargetLookupResponse, String> {
    tracing::debug!("target.lookup query={:?} limit={}", req.query, req.limit);
    let catalog =
        targeting::load::load_from_db(state.repo.pool()).await.map_err(|e| e.to_string())?;
    Ok(app_core::target_lookup::lookup(&catalog, &req))
}

// ── target.resolve.fits (spec 013 — local catalog resolution) ───────────────────
//
// RECONCILIATION (spec 035): spec 035 supersedes spec-013 *online* resolution
// and takes over the canonical `target.resolve` command name (the SIMBAD
// cache-first resolver below). This spec-013 command — local in-memory catalog
// resolution of a FITS OBJECT value — is retained but moved to the
// `target.resolve.fits` invoke target so both coexist without a name collision.
// It is not invoked by the current frontend.

/// `target.resolve.fits` — resolve a FITS OBJECT header value against the local
/// in-memory catalog (spec 013).
///
/// Non-blocking: callers MUST handle `unresolved`, `ambiguous`, and `error`
/// responses without blocking the ingestion flow (FR-006, constitution §II).
///
/// # Errors
///
/// Returns `Err(String)` on unexpected internal failure. Resolution errors
/// (empty query, catalog not installed) are encoded in the response status.
#[tauri::command]
#[specta::specta(rename = "target.resolve.fits")]
pub async fn target_resolve_fits(
    state: State<'_, AppState>,
    req: TargetResolveRequest,
) -> Result<TargetResolveResponse, String> {
    tracing::debug!("target.resolve.fits fits_object_value={:?}", req.fits_object_value);
    let catalog =
        targeting::load::load_from_db(state.repo.pool()).await.map_err(|e| e.to_string())?;
    Ok(app_core::target_lookup::resolve(&catalog, &req))
}

// ── target.resolve (spec 035 — SIMBAD cache-first resolution, US3) ───────────────

/// `target.resolve` — cache-first resolution of a designation / common name (or
/// FITS OBJECT value) against the local cache + bundled seed, falling back to
/// SIMBAD on a miss when online resolution is enabled (spec 035).
///
/// The live `SimbadResolver` is built on demand from the persisted
/// `resolver_settings` (endpoint + timeout). Cache hits never re-query SIMBAD
/// (FR-006); offline / unknown / ambiguous outcomes return `unresolved` and
/// never fabricate coordinates (FR-009). The manual `override` write path is
/// T032.
///
/// # Errors
///
/// Returns `Err(String)` only on a local database failure. Resolver outcomes
/// (offline / unknown / ambiguous) are encoded in the response status.
#[tauri::command]
#[specta::specta(rename = "target.resolve")]
pub async fn target_resolve(
    state: State<'_, AppState>,
    req: TargetResolveSimbadRequest,
) -> Result<TargetResolveSimbadResponse, String> {
    use targeting::resolver::simbad::{SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT};

    tracing::debug!("target.resolve query={:?}", req.query);
    let pool = state.repo.pool();

    // Build the live resolver from persisted settings (endpoint + timeout).
    let settings: Option<(String, i64)> = sqlx::query_as(
        "SELECT simbad_endpoint, request_timeout_secs FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (endpoint, timeout_secs) =
        settings.unwrap_or_else(|| (DEFAULT_TAP_ENDPOINT.to_owned(), 10));
    let config = SimbadConfig::from_settings(endpoint, u64::try_from(timeout_secs.max(1)).unwrap_or(10));
    let resolver = SimbadResolver::new(&config).map_err(|e| e.to_string())?;

    app_core::target_resolve::resolve(pool, &resolver, &req).await.map_err(|e| e.message)
}

// ── target.search (spec 035, US1) ───────────────────────────────────────────────

/// `target.search` — as-you-type target suggestions from local seed + cache.
///
/// Served purely from the local resolution cache / bundled seed (no network);
/// long-tail SIMBAD enrichment is a separate `target.resolve` call. Returns
/// ranked, de-duplicated [`TargetSuggestion`]s for the project-creation /
/// target-selection typeahead (spec 035 FR-005).
///
/// # Errors
///
/// Returns `Err(String)` on an unexpected internal (database) failure.
#[tauri::command]
#[specta::specta(rename = "target.search")]
pub async fn target_search(
    state: State<'_, AppState>,
    req: TargetSearchRequest,
) -> Result<TargetSearchResponse, String> {
    tracing::debug!("target.search query={:?} limit={}", req.query, req.limit);
    app_core::target_search::search(state.repo.pool(), &req).await.map_err(|e| e.message)
}
