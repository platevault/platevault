// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `app_core_targets`-owned cache statics (in-memory caching layer, F0 foundation).
//!
//! Module-local process-global `OnceLock`s, mirroring `app_core`'s
//! `ACTIVE_RUNS`/`caches` pattern. This module defines the cache handles and
//! their `pub invalidate_*`/reader functions only — wiring reads through the
//! cache (`target_management::list`, typeahead) and calling `invalidate_*` at
//! write sites is downstream (W-CATALOG, W-RESOLV) work.

use std::sync::{Arc, OnceLock};

use app_core_cache::SnapshotCache;
use contracts_core::targets::{ResolverSettings, TargetListItem};

// ── catalog snapshot: full target list (+ typeahead) (`target_management.rs`) ──

/// Whole-catalog snapshot backing `target.list`, inbox target recommendations,
/// and typeahead (filtered in memory instead of a per-keystroke SQLite
/// `LIKE`) — one cache, one invalidation point. 1 slot.
///
/// Invalidate at `target_management::alias_add`/`alias_remove`/
/// `display_alias_set`/`display_alias_clear`, constellation/magnitude UPDATE
/// sites, `target_resolve::resolve` (new-row branch only), `search.rs` INSERT
/// sites, and `project_setup.rs` alias INSERT. The resolver seed path stays
/// uninvalidated (resolver decoupling; the lazy first read happens post-seed).
static CATALOG: OnceLock<SnapshotCache<Vec<TargetListItem>>> = OnceLock::new();

/// Return the process-global catalog snapshot cache.
#[must_use]
pub fn catalog() -> &'static SnapshotCache<Vec<TargetListItem>> {
    CATALOG.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded catalog snapshot.
pub fn store_catalog(value: Arc<Vec<TargetListItem>>) {
    catalog().store(value);
}

/// Clear the catalog snapshot so the next read reloads from the DB.
pub fn invalidate_catalog() {
    catalog().invalidate();
}

// ── resolver_settings snapshot (`resolver_settings.rs`) ──────────────────────

/// Singleton resolver settings row snapshot. 1 slot.
///
/// Invalidate at `resolver_settings::update`.
static RESOLVER_SETTINGS: OnceLock<SnapshotCache<ResolverSettings>> = OnceLock::new();

/// Return the process-global resolver-settings snapshot cache.
#[must_use]
pub fn resolver_settings() -> &'static SnapshotCache<ResolverSettings> {
    RESOLVER_SETTINGS.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded resolver-settings snapshot.
pub fn store_resolver_settings(value: Arc<ResolverSettings>) {
    resolver_settings().store(value);
}

/// Clear the resolver-settings snapshot so the next read reloads from the DB.
pub fn invalidate_resolver_settings() {
    resolver_settings().invalidate();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_cache_store_load_invalidate_round_trips() {
        // Serialized against every other test in this crate that touches the
        // shared catalog/resolver-settings statics (`target_management`,
        // `target_resolve`, `target_search`, `resolver_settings`,
        // `ingest_resolution`) — see `target_management::cache_test_lock`.
        let _guard = crate::target_management::cache_test_lock::locked_reset();
        invalidate_catalog();
        assert!(catalog().load().is_none());

        store_catalog(Arc::new(vec![TargetListItem {
            id: "t-1".to_owned(),
            effective_label: "M31".to_owned(),
            primary_designation: "M31".to_owned(),
            object_type: "galaxy".to_owned(),
            ra_deg: 10.68,
            dec_deg: 41.27,
            constellation: None,
            magnitude: None,
            aliases: vec![],
            session_count: 0,
        }]));
        let loaded = catalog().load().expect("stored snapshot must load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "t-1");

        invalidate_catalog();
        assert!(catalog().load().is_none());
    }

    #[test]
    fn resolver_settings_cache_store_load_invalidate_round_trips() {
        // Serialized against every other test in this crate that touches the
        // shared catalog/resolver-settings statics — see
        // `target_management::cache_test_lock`.
        let _guard = crate::target_management::cache_test_lock::locked_reset();
        invalidate_resolver_settings();
        assert!(resolver_settings().load().is_none());

        store_resolver_settings(Arc::new(ResolverSettings {
            online_enabled: true,
            simbad_endpoint: "https://simbad.example/tap".to_owned(),
            debounce_ms: 300,
            request_timeout_secs: 10,
        }));
        let loaded = resolver_settings().load().expect("stored snapshot must load");
        assert!(loaded.online_enabled);

        invalidate_resolver_settings();
        assert!(resolver_settings().load().is_none());
    }
}
