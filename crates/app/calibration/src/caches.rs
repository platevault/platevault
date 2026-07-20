// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `app_core_calibration`-owned cache statics (in-memory caching layer, F0 foundation).
//!
//! Module-local process-global `OnceLock`s, mirroring `app_core`'s
//! `ACTIVE_RUNS`/`caches` pattern. This module defines the cache handles and
//! their `pub invalidate_*`/reader functions only — wiring reads through the
//! cache (`matching::suggest`/`batch_suggest`) and calling `invalidate_*` at
//! write sites is downstream (W-CALCFG, W-MASTERS) work.
//!
//! Both caches cache the matcher's *inputs* (config + masters list), not the
//! match output: DB round-trips dominate matching cost, and the match itself
//! is bounded CPU (see the caching layer plan's confirmed design call).

use std::sync::{Arc, OnceLock};

use app_core_cache::SnapshotCache;
use calibration_core::ranking::MatchingRuleConfig;
use contracts_core::calibration::CalibrationMaster;

// ── calibration config snapshot (`matching.rs`) ───────────────────────────────

/// [`MatchingRuleConfig`] loaded from the `calibration*` settings keys. 1 slot.
///
/// Invalidate at the settings-bag fan-out (`app_core_settings::update_setting`
/// / `restore_defaults` for the `calibrationDarkTempTolerance` /
/// `calibrationDarkOverridePenalty` / `calibrationFlatOverridePenalty` /
/// `calibrationBiasOverridePenalty` / `calibrationPrefillSuggestion` keys).
static CALIBRATION_CONFIG: OnceLock<SnapshotCache<MatchingRuleConfig>> = OnceLock::new();

/// Return the process-global calibration-config snapshot cache.
#[must_use]
pub fn calibration_config() -> &'static SnapshotCache<MatchingRuleConfig> {
    CALIBRATION_CONFIG.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded calibration-config snapshot.
pub fn store_calibration_config(value: Arc<MatchingRuleConfig>) {
    calibration_config().store(value);
}

/// Clear the calibration-config snapshot so the next read reloads from settings.
pub fn invalidate_calibration_config() {
    calibration_config().invalidate();
}

// ── calibration masters snapshot (`matching.rs`) ──────────────────────────────

/// All calibration masters (as seen in list views). 1 slot.
///
/// Invalidate site is **untested** — `assign:281` is a non-trigger (writes a
/// link, not a master); the real trigger is the master-frame INSERT on the
/// plan-apply/calibration-session path. The worker wiring this cache MUST
/// confirm the actual write site before calling [`invalidate_calibration_masters`].
static CALIBRATION_MASTERS: OnceLock<SnapshotCache<Vec<CalibrationMaster>>> = OnceLock::new();

/// Return the process-global calibration-masters snapshot cache.
#[must_use]
pub fn calibration_masters() -> &'static SnapshotCache<Vec<CalibrationMaster>> {
    CALIBRATION_MASTERS.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded calibration-masters snapshot.
pub fn store_calibration_masters(value: Arc<Vec<CalibrationMaster>>) {
    calibration_masters().store(value);
}

/// Clear the calibration-masters snapshot so the next read reloads from the DB.
pub fn invalidate_calibration_masters() {
    calibration_masters().invalidate();
}

/// Test-only serialization for the two process-global `SnapshotCache` statics
/// above.
///
/// Shared between this module's own round-trip tests and
/// `matching::tests`'s cache-behavior tests (`load_config`/`masters_list`
/// read through the same `CALIBRATION_CONFIG`/`CALIBRATION_MASTERS` slots).
/// Before this lock was shared, each test module held its own private mutex,
/// so a `caches::tests` round-trip test could run concurrently with a
/// `matching::tests` cache-hit test and race on the same slot — the
/// known-flaky `load_config_reads_require_same_offset_from_tolerances_table`
/// (#988).
#[cfg(test)]
pub(crate) mod cache_test_lock {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// Acquire the shared lock for an async (`#[tokio::test]`) caller.
    pub(crate) async fn lock() -> tokio::sync::MutexGuard<'static, ()> {
        LOCK.lock().await
    }

    /// Acquire the shared lock for a sync (`#[test]`) caller. Blocks the
    /// current thread rather than `.await`ing — safe here because these call
    /// sites have no Tokio runtime, unlike [`lock`]'s async callers.
    pub(crate) fn lock_sync() -> tokio::sync::MutexGuard<'static, ()> {
        LOCK.blocking_lock()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calibration_config_cache_store_load_invalidate_round_trips() {
        let _guard = cache_test_lock::lock_sync();
        invalidate_calibration_config();
        assert!(calibration_config().load().is_none());

        store_calibration_config(Arc::new(MatchingRuleConfig::default()));
        assert!(calibration_config().load().is_some());

        invalidate_calibration_config();
        assert!(calibration_config().load().is_none());
    }

    #[test]
    fn calibration_masters_cache_store_load_invalidate_round_trips() {
        let _guard = cache_test_lock::lock_sync();
        invalidate_calibration_masters();
        assert!(calibration_masters().load().is_none());

        store_calibration_masters(Arc::new(vec![]));
        let loaded = calibration_masters().load().expect("stored snapshot must load");
        assert!(loaded.is_empty());

        invalidate_calibration_masters();
        assert!(calibration_masters().load().is_none());
    }
}
