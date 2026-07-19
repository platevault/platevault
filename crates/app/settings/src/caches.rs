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
use serde_json::Value;

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

/// The noisy-key values (as a JSON object) from the most recently PUBLISHED
/// `settings.snapshot` event (issue #668). 1 slot.
///
/// `emit_snapshot` compares its freshly collected values against this before
/// publishing, and skips the publish (a no-op) when nothing changed — mirrors
/// `app_core_targets::ingest_resolution::resolve_pending`'s
/// `target.resolve_batch.completed` suppression on `considered == 0`: a
/// periodic heartbeat with nothing to report should not flood the activity
/// log (#668 — ~470/500 rows in a real sweep were this + the target
/// heartbeat). Not invalidated by `update_setting`/`restore_defaults`/
/// `set_source_override`: those already emit their own real
/// `settings.changed`/`protection.default.changed` events, so a later
/// snapshot correctly finds "no further noisy-key change" and stays quiet
/// until a *noisy* key changes.
static LAST_SNAPSHOT_VALUES: OnceLock<SnapshotCache<Value>> = OnceLock::new();

/// Return the process-global last-published-snapshot value cache.
#[must_use]
pub fn last_snapshot_values() -> &'static SnapshotCache<Value> {
    LAST_SNAPSHOT_VALUES.get_or_init(SnapshotCache::new)
}

/// Store the noisy-key values just published in a `settings.snapshot` event.
pub fn store_last_snapshot_values(value: Arc<Value>) {
    last_snapshot_values().store(value);
}

/// Clear the last-published-snapshot cache (test isolation only — the real
/// `emit_snapshot` caller never needs to invalidate this outside its own
/// store-on-publish).
pub fn invalidate_last_snapshot_values() {
    last_snapshot_values().invalidate();
}

#[cfg(test)]
mod tests {
    use super::*;

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
