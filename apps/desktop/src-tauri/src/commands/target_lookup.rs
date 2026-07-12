//! Target search/resolve Tauri commands (spec 035 SIMBAD resolution).
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks
//!
//! ## Commands
//!
//! - `target.resolve` — cache-first SIMBAD resolution (spec 035).
//! - `target.search` — local typeahead search (spec 035).
//! - `target.resolution.settings` / `target.resolution.settings.update` — resolver settings.
//! - `target.astro_format.batch` — batched sexagesimal RA/Dec formatting (adopt target-match).
//!
//! Spec-013 commands `target.lookup` and `target.resolve.fits` have been
//! removed by spec 036 (superseded by spec-035 `target.search`/`target.resolve`).

use contracts_core::targets::{
    ResolverSettingsGetRequest, ResolverSettingsResponse, ResolverSettingsUpdateRequest,
    TargetAstroFormat, TargetAstroFormatBatchRequest, TargetAstroFormatBatchResponse,
    TargetResolveSimbadRequest, TargetResolveSimbadResponse, TargetSearchRequest,
    TargetSearchResponse,
};
use contracts_core::ContractError;
use persistence_db::repositories::q_desktop::get_resolver_settings;
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
) -> Result<TargetResolveSimbadResponse, ContractError> {
    use targeting_resolver::simbad::{
        OfflineResolver, SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT,
    };

    tracing::debug!("target.resolve query={:?}", req.query);
    let pool = state.repo.pool();

    // Read settings (incl. online_enabled) to decide whether to build a client.
    let settings =
        get_resolver_settings(pool).await.map_err(|e| ContractError::internal(e.to_string()))?;
    let (online_enabled, endpoint, timeout_secs) = settings.map_or_else(
        || (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10),
        |r| (r.online_enabled != 0, r.simbad_endpoint, r.request_timeout_secs),
    );

    // FIX-3: when online resolution is disabled, do NOT construct a reqwest/TLS
    // client (it can fail to build, turning an offline-by-config call into an
    // error). The use case is still cache-first; the offline resolver only ever
    // reports `Disabled`, which the use case maps to `unresolved("offline")`.
    if !online_enabled {
        return app_core::target_resolve::resolve(pool, &OfflineResolver, &req).await;
    }

    let config =
        SimbadConfig::from_settings(endpoint, u64::try_from(timeout_secs.max(1)).unwrap_or(10));
    let resolver =
        SimbadResolver::new(&config).map_err(|e| ContractError::internal(e.to_string()))?;

    app_core::target_resolve::resolve(pool, &resolver, &req).await
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
) -> Result<TargetSearchResponse, ContractError> {
    tracing::debug!("target.search query={:?} limit={}", req.query, req.limit);
    app_core::target_search::search(state.repo.pool(), &req).await
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
) -> Result<ResolverSettingsResponse, ContractError> {
    tracing::debug!("target.resolution.settings (get)");
    app_core::resolver_settings::get(state.repo.pool(), &req).await
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
) -> Result<ResolverSettingsResponse, ContractError> {
    tracing::debug!(
        "target.resolution.settings.update online_enabled={}",
        req.settings.online_enabled
    );
    app_core::resolver_settings::update(state.repo.pool(), &req).await
}

// ── target.astro_format.batch (adopt target-match) ───────────────────────────

/// `target.astro_format.batch` — sexagesimal RA/Dec formatting for N targets
/// in one call (never per-row round trips). Pure geometry (`targeting::astro_format`,
/// backed by `skymath::Equatorial`'s carry-safe sexagesimal formatting) —
/// no database access, so this never fails on a well-formed request.
///
/// Targets whose RA/Dec is non-finite are omitted from `formatted` (never a
/// fabricated string); callers key results by `id`.
///
/// # Errors
///
/// This command does not fail; the `Result` shape matches the rest of the
/// command surface for a consistent IPC error contract.
#[tauri::command]
#[specta::specta]
pub async fn target_astro_format_batch(
    req: TargetAstroFormatBatchRequest,
) -> Result<TargetAstroFormatBatchResponse, ContractError> {
    tracing::debug!("target.astro_format.batch count={}", req.targets.len());
    let formatted =
        req.targets
            .into_iter()
            .filter_map(|t| {
                targeting::astro_format::sexagesimal(t.ra_deg, t.dec_deg).map(|s| {
                    TargetAstroFormat { id: t.id, ra_sexagesimal: s.ra, dec_sexagesimal: s.dec }
                })
            })
            .collect();
    Ok(TargetAstroFormatBatchResponse { formatted })
}
