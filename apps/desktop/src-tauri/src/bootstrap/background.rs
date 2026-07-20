// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Background tasks spawned once at startup by `run_app`: the stale-dependent
//! propagator (spec 002 FR-003) and the SIMBAD ingest-resolution drain
//! (spec 035 US4).

use audit::bus::EventBus;
use audit::stale_propagator::{resolve_project_dependents_hook, StalePropagator};
use sqlx::SqlitePool;

/// Spawn the spec 002 FR-003 (#713) stale-dependent propagator.
///
/// Never spawned in production before this — projections/prepared sources
/// only recomputed their staleness through calling code that happened to
/// run the exact update, not automatically on the owning project's
/// transition (research.md §6 fan-out).
pub(crate) fn spawn_stale_dependent_propagator(
    pool: SqlitePool,
    bus: &EventBus,
) -> tokio::task::JoinHandle<()> {
    StalePropagator::new().with_hook(resolve_project_dependents_hook(pool)).spawn(bus)
}

/// Spawn the spec-035 US4/T043 background ingest-resolution drain.
///
/// Every interval the task rebuilds the resolver from the persisted
/// `resolver_settings`, drains the pending `ingest_resolution` queue
/// (cache-first → SIMBAD when online; cache-only when offline), then back-fills
/// `acquisition_session.canonical_target_id` for sessions whose frames resolved
/// this pass. Failures are logged, never fatal — the next pass retries.
pub(crate) fn spawn_ingest_resolution_drain(
    pool: SqlitePool,
    bus: EventBus,
    resolve_cache: targeting_resolver::simbad::ResolveCache,
) {
    use targeting_resolver::simbad::{SimbadConfig, SimbadResolver, DEFAULT_TAP_ENDPOINT};
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(30);
        loop {
            tokio::time::sleep(interval).await;

            // Read resolver settings (online toggle + endpoint + timeout).
            let settings = persistence_db::repositories::q_desktop::get_resolver_settings(&pool)
                .await
                .unwrap_or(None);
            let (online_enabled, endpoint, timeout_secs) = settings.map_or_else(
                || (true, DEFAULT_TAP_ENDPOINT.to_owned(), 10),
                |r| (r.online_enabled != 0, r.simbad_endpoint, r.request_timeout_secs),
            );

            // `SimbadResolver::new` never builds a reqwest/TLS client when
            // `online_enabled` is false (mirrors target.resolve FIX-3); cache
            // hits still resolve regardless.
            let config = SimbadConfig::from_settings(
                endpoint,
                u64::try_from(timeout_secs.max(1)).unwrap_or(10),
            );
            let drain = match SimbadResolver::new(&config, &resolve_cache, online_enabled) {
                Ok(resolver) => {
                    app_core::ingest_resolution::resolve_pending(
                        &pool,
                        &resolver,
                        Some(&bus),
                        online_enabled,
                        50,
                    )
                    .await
                }
                Err(e) => {
                    tracing::warn!("failed to build SimbadResolver for ingest drain: {e:?}");
                    continue;
                }
            };
            if let Err(e) = drain {
                tracing::warn!("ingest_resolution drain failed: {e:?}");
                continue;
            }

            // Back-fill sessions whose frames just resolved.
            if let Err(e) = app_core::ingest_sessions::backfill_session_targets(&pool).await {
                tracing::warn!("acquisition_session target back-fill failed: {e:?}");
            }
        }
    });
}
