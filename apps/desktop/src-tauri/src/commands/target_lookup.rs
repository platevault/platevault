//! Target search/resolve Tauri commands (spec 035 SIMBAD resolution; redb
//! resolve-cache facade adoption + in-use promotion by spec 052 P1).
#![allow(clippy::doc_markdown)] // spec/domain terminology not suited for backticks
//!
//! ## Commands
//!
//! - `target.resolve` — cache-first SIMBAD resolution, TAP + cache only (spec
//!   035); no longer writes `canonical_target` (spec 052 P1 FR-004). The
//!   debounced typeahead entrypoint — MUST NOT be called per keystroke with
//!   the Sesame fallback (it never reaches it at all).
//! - `target.resolve_explicit` — the deliberate resolve/confirm entrypoint
//!   (Enter with no typeahead match, "search more", Add/Confirm submit): TAP
//!   first, SIMBAD Sesame fallback only on a TAP miss (spec 052 P2,
//!   FR-008/FR-009). Same request/response contract as `target.resolve`.
//! - `target.search` — local typeahead search over the shared redb resolve
//!   cache (spec 035/052).
//! - `target.adopt` — explicit in-use commit for UI flows with no other
//!   natural commit point (spec 052 P1 FR-004).
//! - `target.cache.clear` — wipe + re-warm the redb resolve cache (FR-002).
//! - `target.resolution.settings` / `target.resolution.settings.update` — resolver settings.
//! - `target.astro_format.batch` — batched sexagesimal RA/Dec formatting (adopt target-match).
//!
//! Spec-013 commands `target.lookup` and `target.resolve.fits` have been
//! removed by spec 036 (superseded by spec-035 `target.search`/`target.resolve`).

use contracts_core::targets::{
    ResolverSettingsGetRequest, ResolverSettingsResponse, ResolverSettingsUpdateRequest,
    TargetAdoptRequest, TargetAdoptResponse, TargetAstroFormat, TargetAstroFormatBatchRequest,
    TargetAstroFormatBatchResponse, TargetCacheClearResponse, TargetResolveSimbadRequest,
    TargetResolveSimbadResponse, TargetSearchRequest, TargetSearchResponse,
};
use contracts_core::ContractError;
use persistence_db::repositories::q_desktop::get_resolver_settings;
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── target.resolve (spec 035 — SIMBAD cache-first resolution, US3) ───────────────

/// `target.resolve` — resolve a designation / common name (or FITS OBJECT
/// value) against the shared redb resolve cache, falling back to SIMBAD's
/// tabular (TAP) path on a miss when online resolution is enabled (spec 035).
/// The debounced typeahead entrypoint — TAP + cache only, never the Sesame
/// fallback (spec 052 P2 FR-009; see `target_resolve_explicit` for that).
/// Never writes `canonical_target` itself (spec 052 P1 FR-004) except via the
/// manual `override` path (T032) — see `app_core::target_resolve` for the
/// in-use promotion commit points.
///
/// The live `SimbadResolver` facade is built on demand from the persisted
/// `resolver_settings` (endpoint + timeout) plus the app-lifetime shared
/// redb cache. Cache hits never re-query SIMBAD (FR-006); offline / unknown /
/// ambiguous outcomes return `unresolved` and never fabricate coordinates
/// (FR-009).
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
    tracing::debug!("target.resolve query={:?}", req.query);
    let pool = state.repo.pool();
    let resolver = build_simbad_resolver(&state).await?;
    app_core::target_resolve::resolve(pool, &resolver, &req).await
}

// ── target.resolve_explicit (spec 052 P2 — FR-008/FR-009) ────────────────────

/// `target.resolve_explicit` — the deliberate resolve/confirm entrypoint
/// (Enter with no typeahead match, "search more", or an Add/Confirm submit).
/// Same request/response contract as `target.resolve`; consults
/// [`targeting_resolver::simbad::SimbadResolver::resolve_explicit`]
/// (TAP-first, Sesame-fallback-on-a-miss) instead of the TAP+cache-only path
/// `target.resolve` uses — the frontend MUST NOT call this per keystroke
/// (FR-009).
///
/// # Errors
///
/// Returns `Err(String)` only on a local database failure. Resolver outcomes
/// (offline / unknown / ambiguous) are encoded in the response status.
#[tauri::command]
#[specta::specta]
pub async fn target_resolve_explicit(
    state: State<'_, AppState>,
    req: TargetResolveSimbadRequest,
) -> Result<TargetResolveSimbadResponse, ContractError> {
    tracing::debug!("target.resolve_explicit query={:?}", req.query);
    let pool = state.repo.pool();
    let resolver = build_simbad_resolver(&state).await?;
    app_core::target_resolve::resolve_explicit(pool, &resolver, &req).await
}

/// Build the live `SimbadResolver` facade from persisted `resolver_settings`
/// plus the app-lifetime shared redb cache. Shared by `target.resolve` and
/// `target.resolve_explicit` (spec 052 P1/P2) so both entrypoints construct
/// the resolver identically.
///
/// # Errors
///
/// Returns `Err(String)` on a local database failure or if the underlying
/// `reqwest`/TLS client cannot be built.
async fn build_simbad_resolver(
    state: &State<'_, AppState>,
) -> Result<targeting_resolver::simbad::SimbadResolver, ContractError> {
    use targeting_resolver::simbad::{SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT};

    let pool = state.repo.pool();
    let settings =
        get_resolver_settings(pool).await.map_err(|e| ContractError::internal(e.to_string()))?;
    let (online_enabled, endpoint, timeout_secs) = settings.map_or_else(
        || (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10),
        |r| (r.online_enabled != 0, r.simbad_endpoint, r.request_timeout_secs),
    );

    let config =
        SimbadConfig::from_settings(endpoint, u64::try_from(timeout_secs.max(1)).unwrap_or(10));
    // FIX-3 preserved: when offline, `SimbadResolver::new` never builds a
    // reqwest/TLS client (see `EitherNetworkResolver`) — cache hits still
    // resolve; a miss reports an offline-shaped unresolved outcome.
    let resolve_cache = state.resolve_cache.read().await.clone();
    SimbadResolver::new(&config, &resolve_cache, online_enabled)
        .map_err(|e| ContractError::internal(e.to_string()))
}

// ── target.search (spec 035, US1) ───────────────────────────────────────────────

/// `target.search` — as-you-type target suggestions from the shared redb
/// resolve cache (seed + anything resolved/warmed so far).
///
/// Served purely from the local cache (no network); long-tail SIMBAD
/// enrichment is a separate `target.resolve` call. Returns ranked,
/// de-duplicated [`TargetSuggestion`](contracts_core::targets::TargetSuggestion)s
/// for the project-creation / target-selection typeahead (spec 035 FR-005).
///
/// # Errors
///
/// Returns `Err(String)` on an unexpected internal (cache) failure.
#[tauri::command]
#[specta::specta]
pub async fn target_search(
    state: State<'_, AppState>,
    req: TargetSearchRequest,
) -> Result<TargetSearchResponse, ContractError> {
    tracing::debug!("target.search query={:?} limit={}", req.query, req.limit);
    let cache = state.resolve_cache.read().await.clone();
    app_core::target_search::search(&cache.cache(), &req).await
}

// ── target.adopt (spec 052 P1 FR-004) ───────────────────────────────────────────

/// `target.adopt` — promote a redb-cache-only target into the durable
/// `canonical_target` table. The explicit in-use commit for UI flows with no
/// other natural commit point (e.g. the Targets-page "Add Target" dialog).
///
/// # Errors
///
/// Returns `Err(String)` on an invalid `target_id` or a local backend failure.
#[tauri::command]
#[specta::specta]
pub async fn target_adopt(
    state: State<'_, AppState>,
    req: TargetAdoptRequest,
) -> Result<TargetAdoptResponse, ContractError> {
    tracing::debug!("target.adopt target_id={}", req.target_id);
    let cache = state.resolve_cache.read().await.clone();
    app_core::target_resolve::adopt(state.repo.pool(), &cache.cache(), &req).await
}

// ── target.cache.clear (spec 052 P1 FR-002) ─────────────────────────────────────

/// `target.cache.clear` — wipe the redb resolve cache and re-warm it from the
/// bundled seed + existing durable `canonical_target` rows. Never touches
/// `canonical_target` itself (§V — the redb cache is a reproducible
/// projection, never canonical).
///
/// Best-effort on the underlying file swap: a transient failure to remove the
/// old redb file (e.g. a concurrent read still has it open) is reported as an
/// internal error rather than silently leaving a stale cache in place.
///
/// # Errors
///
/// Returns `Err(String)` if the cache file cannot be reopened/re-warmed.
#[tauri::command]
#[specta::specta]
pub async fn target_cache_clear(
    state: State<'_, AppState>,
) -> Result<TargetCacheClearResponse, ContractError> {
    tracing::info!("target.cache.clear");
    let rewarmed = crate::resolve_cache::clear_and_rewarm(&state).await?;
    Ok(TargetCacheClearResponse { rewarmed_count: u32::try_from(rewarmed).unwrap_or(u32::MAX) })
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
