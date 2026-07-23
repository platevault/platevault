// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `app_core_settings`-owned cache statics (in-memory caching layer, F0 foundation).
//!
//! Module-local process-global `OnceLock`, mirroring `app_core`'s
//! `ACTIVE_RUNS`/`caches` pattern. This module defines the cache handle and
//! its `pub invalidate_settings_bag`/reader functions only — wiring
//! `get_settings` to read through the cache and calling
//! `invalidate_settings_bag` at write sites (`update_setting`,
//! `restore_defaults`, `set_source_override`) is downstream (W-SETTINGS)
//! work. Defined early (F0) so the parallel `W-PROT`/`W-CALCFG`/`W-RESOLV`
//! workers can call `invalidate_settings_bag` from their own fan-out without
//! waiting for W-SETTINGS to land.

use std::sync::{Arc, OnceLock};

use app_core_cache::SnapshotCache;
use domain_core::settings::SettingsState;

/// Per-instance settings-bag cache state.
///
/// Replaces the former process-global `SETTINGS_BAG` `OnceLock`. Wrap in `Arc`
/// and thread alongside `SqlitePool`/`EventBus`; tests construct a fresh
/// instance per test to eliminate cross-contamination without needing
/// `invalidate_settings_bag()` or serialization mutexes.
pub struct SettingsCaches {
    bag: SnapshotCache<SettingsState>,
}

impl SettingsCaches {
    /// Construct a fresh, empty instance.
    #[must_use]
    pub fn new() -> Self {
        Self { bag: SnapshotCache::new() }
    }

    /// Return the cached settings bag, or `None` on a miss.
    #[must_use]
    pub fn load_bag(&self) -> Option<Arc<SettingsState>> {
        self.bag.load()
    }

    /// Store a freshly loaded settings-bag snapshot.
    pub fn store_bag(&self, value: Arc<SettingsState>) {
        self.bag.store(value);
    }

    /// Clear the settings-bag snapshot so the next read reloads from the DB.
    pub fn invalidate_bag(&self) {
        self.bag.invalidate();
    }
}

impl Default for SettingsCaches {
    fn default() -> Self {
        Self::new()
    }
}

// ── Deprecated process-global accessors (migration shim) ─────────────────────

/// The full v1 settings bag, hydrated with in-code defaults for missing rows
/// (mirrors `get_settings`'s output). 1 slot.
///
/// Invalidate at `update_setting`, `restore_defaults`, and
/// `set_source_override` (per-source overrides also affect `resolve_setting`,
/// which is not itself cached here but reads through the same underlying
/// rows).
static SETTINGS_BAG: OnceLock<SnapshotCache<SettingsState>> = OnceLock::new();

/// Return the process-global settings-bag snapshot cache.
#[must_use]
pub fn settings_bag() -> &'static SnapshotCache<SettingsState> {
    SETTINGS_BAG.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded settings-bag snapshot.
pub fn store_settings_bag(value: Arc<SettingsState>) {
    settings_bag().store(value);
}

/// Clear the settings-bag snapshot so the next read reloads from the DB.
pub fn invalidate_settings_bag() {
    settings_bag().invalidate();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_caches_instance_store_load_invalidate_round_trips() {
        let caches = SettingsCaches::new();
        assert!(caches.load_bag().is_none());

        caches.store_bag(Arc::new(SettingsState::default()));
        assert!(caches.load_bag().is_some());

        caches.invalidate_bag();
        assert!(caches.load_bag().is_none());
    }

    #[test]
    fn settings_bag_cache_store_load_invalidate_round_trips() {
        invalidate_settings_bag();
        assert!(settings_bag().load().is_none());

        store_settings_bag(Arc::new(SettingsState::default()));
        assert!(settings_bag().load().is_some());

        invalidate_settings_bag();
        assert!(settings_bag().load().is_none());
    }
}
