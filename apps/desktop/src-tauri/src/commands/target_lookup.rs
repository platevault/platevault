//! Target search/resolve Tauri commands (spec 035 SIMBAD resolution).
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks
//!
//! ## Commands
//!
//! - `target.resolve` — cache-first SIMBAD resolution (spec 035).
//! - `target.search` — local typeahead search (spec 035).
//! - `target.resolution.settings` / `target.resolution.settings.update` — resolver settings.
//!
//! Spec-013 commands `target.lookup` and `target.resolve.fits` have been
//! removed by spec 036 (superseded by spec-035 `target.search`/`target.resolve`).

use contracts_core::targets::{
    ResolverSettingsGetRequest, ResolverSettingsResponse, ResolverSettingsUpdateRequest,
    TargetResolveSimbadRequest, TargetResolveSimbadResponse, TargetSearchRequest,
    TargetSearchResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

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
#[specta::specta]
pub async fn target_resolve(
    state: State<'_, AppState>,
    req: TargetResolveSimbadRequest,
) -> Result<TargetResolveSimbadResponse, String> {
    use targeting::resolver::simbad::{
        OfflineResolver, SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT,
    };

    tracing::debug!("target.resolve query={:?}", req.query);
    let pool = state.repo.pool();

    // Read settings (incl. online_enabled) to decide whether to build a client.
    let settings: Option<(i64, String, i64)> = sqlx::query_as(
        "SELECT online_enabled, simbad_endpoint, request_timeout_secs FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (online_enabled, endpoint, timeout_secs) = settings
        .map_or_else(|| (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10), |(o, e, t)| (o != 0, e, t));

    // FIX-3: when online resolution is disabled, do NOT construct a reqwest/TLS
    // client (it can fail to build, turning an offline-by-config call into an
    // error). The use case is still cache-first; the offline resolver only ever
    // reports `Disabled`, which the use case maps to `unresolved("offline")`.
    if !online_enabled {
        return app_core::target_resolve::resolve(pool, &OfflineResolver, &req)
            .await
            .map_err(|e| e.message);
    }

    let config =
        SimbadConfig::from_settings(endpoint, u64::try_from(timeout_secs.max(1)).unwrap_or(10));
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
#[specta::specta]
pub async fn target_search(
    state: State<'_, AppState>,
    req: TargetSearchRequest,
) -> Result<TargetSearchResponse, String> {
    tracing::debug!("target.search query={:?} limit={}", req.query, req.limit);
    app_core::target_search::search(state.repo.pool(), &req).await.map_err(|e| e.message)
}

// ── target.resolution.settings (spec 035, US5 — FR-015) ─────────────────────────

/// `target.resolution.settings` — read the SIMBAD resolver settings.
///
/// # Errors
///
/// Returns `Err(String)` on a local database failure.
#[tauri::command]
#[specta::specta]
pub async fn target_resolution_settings(
    state: State<'_, AppState>,
    req: ResolverSettingsGetRequest,
) -> Result<ResolverSettingsResponse, String> {
    tracing::debug!("target.resolution.settings (get)");
    app_core::resolver_settings::get(state.repo.pool(), &req).await.map_err(|e| e.message)
}

/// `target.resolution.settings.update` — persist new resolver settings.
///
/// # Errors
///
/// Returns `Err(String)` on a local database failure.
#[tauri::command]
#[specta::specta]
pub async fn target_resolution_settings_update(
    state: State<'_, AppState>,
    req: ResolverSettingsUpdateRequest,
) -> Result<ResolverSettingsResponse, String> {
    tracing::debug!(
        "target.resolution.settings.update online_enabled={}",
        req.settings.online_enabled
    );
    app_core::resolver_settings::update(state.repo.pool(), &req).await.map_err(|e| e.message)
}
