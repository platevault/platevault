// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Masters list/get + suggest/config-cache tests (T032, T037).

use super::loaders::load_config;
use super::*;
use persistence_db::Database;

use crate::caches;
use crate::caches::cache_test_lock;

async fn test_db() -> Database {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    db
}

/// `masters_list`/`load_config` read through process-global snapshot
/// caches (`caches::calibration_masters`/`calibration_config`), which are
/// also touched by `caches::tests`. Tests that exercise them run
/// concurrently by default under `cargo test`, so without serialization one
/// test's `invalidate`+prime can race another test's assertions on the same
/// static slot — hence the shared `crate::caches::cache_test_lock` (#988;
/// previously a module-private lock here only serialized against sibling
/// tests in *this* module, not `caches::tests`, which is the actual race
/// that made `load_config_reads_require_same_offset_from_tolerances_table`
/// flaky).
async fn lock_cache_tests() -> tokio::sync::MutexGuard<'static, ()> {
    cache_test_lock::lock().await
}

/// T032 / T037: masters_list returns real rows from calibration_master_view.
#[tokio::test]
async fn masters_list_returns_real_rows_not_fixtures() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-t1', 'dark-300s', 'dark', '2026-06-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO calibration_fingerprint \
         (id, calibration_type, gain, exposure_s, temp_c, binning, optic_train) \
         VALUES ('cal-t1', 'dark', 100.0, 300.0, -10.0, '1x1', 'ASI2600MM')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1, "must return exactly 1 real master from DB");
    assert_eq!(masters[0].id, "cal-t1");
    assert_eq!(masters[0].kind, contracts_core::calibration::CalibrationKind::Dark);
    assert!((masters[0].fingerprint.gain.unwrap() - 100.0).abs() < f64::EPSILON);
    assert_eq!(masters[0].fingerprint.camera.as_deref(), Some("ASI2600MM"));
}

/// T129 (Q16 / FR-136): absent fingerprint/size metadata round-trips as
/// `None`, never a synthesized sentinel (0.0, "", "1x1", or the master's
/// own id standing in for a missing source session).
#[tokio::test]
async fn masters_list_carries_absent_metadata_as_none_not_sentinels() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    // Session with NO calibration_fingerprint row at all: every
    // fingerprint field and size_bytes must resolve to None, and
    // source_session_id must not fall back to the master's own id.
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-none', 'bias-none', 'bias', '2026-06-02T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1);
    let m = &masters[0];
    assert_eq!(m.fingerprint.camera, None);
    assert_eq!(m.fingerprint.gain, None);
    assert_eq!(m.fingerprint.exposure_s, None);
    assert_eq!(m.fingerprint.binning, None);
    assert_eq!(m.source_session_id, None, "must never default to the master's own id");
    assert_eq!(m.size_bytes, None, "must never default to 0");
}

/// T032 / T037: masters_list returns empty on a fresh DB (no fixtures).
#[tokio::test]
async fn masters_list_returns_empty_on_fresh_db() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;
    let masters = masters_list(db.pool()).await.unwrap();
    assert!(masters.is_empty(), "fresh DB must have no masters — not fixtures");
}

/// T032 / T037: masters_get returns the correct row.
#[tokio::test]
async fn masters_get_returns_correct_row() {
    let _guard = lock_cache_tests().await;
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-t2', 'flat-2s-Ha', 'flat', '2026-05-15T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO calibration_fingerprint \
         (id, calibration_type, gain, exposure_s, filter_name, binning) \
         VALUES ('cal-t2', 'flat', 100.0, 2.0, 'Ha', '1x1')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let detail = masters_get(db.pool(), "cal-t2").await.unwrap();
    assert_eq!(detail.id, "cal-t2");
    assert_eq!(detail.kind, contracts_core::calibration::CalibrationKind::Flat);
    assert_eq!(detail.fingerprint.filter, Some("Ha".to_owned()));
}

/// #642: masters_list/masters_get expose `root_id`/`relative_path`
/// resolved from `calibration_session.frame_ids[0]` → `file_record`, the
/// master's own applied frame file written at master-confirm time
/// (`crates/app/inbox/src/plan_listener.rs`).
#[tokio::test]
async fn masters_list_and_get_resolve_frame_path_from_file_record() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES ('root-1', 'Library', '/data/lib', 'local', 'active', '2026-06-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES ('fr-1', 'root-1', 'masters/masterDark_300s.xisf', 1000, \
                 '2026-06-01T00:00:00Z', 'observed', '2026-06-01T00:00:00Z', \
                 '2026-06-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, frame_ids, root_id, created_at) \
         VALUES ('cal-path', 'dark-300s', 'dark', '[\"fr-1\"]', 'root-1', '2026-06-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1);
    assert_eq!(masters[0].root_id.as_deref(), Some("root-1"));
    assert_eq!(masters[0].relative_path.as_deref(), Some("masters/masterDark_300s.xisf"));

    let detail = masters_get(db.pool(), "cal-path").await.unwrap();
    assert_eq!(detail.root_id.as_deref(), Some("root-1"));
    assert_eq!(detail.relative_path.as_deref(), Some("masters/masterDark_300s.xisf"));
}

/// #642: an unresolved master frame (`frame_ids = '[]'`, the common case
/// before spec 048 US1 wired real file-record writes) must leave both
/// fields `None` — never a guessed/empty-string path.
#[tokio::test]
async fn masters_list_leaves_path_none_when_frame_unresolved() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-unresolved', 'bias-none', 'bias', '2026-06-02T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1);
    assert_eq!(masters[0].root_id, None);
    assert_eq!(masters[0].relative_path, None);
}

/// T032 / T037: masters_get returns error for unknown id.
#[tokio::test]
async fn masters_get_returns_error_for_unknown_id() {
    let _guard = lock_cache_tests().await;
    let db = test_db().await;
    let err = masters_get(db.pool(), "nonexistent").await.unwrap_err();
    assert!(err.contains("master.not_found"), "expected master.not_found error, got: {err}");
}

/// #868: masters_get.compatible_sessions is populated from a real
/// domain-matcher pass over light sessions, not hardcoded to empty.
#[tokio::test]
async fn masters_get_populates_compatible_sessions() {
    let _guard = lock_cache_tests().await;
    let db = test_db().await;

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-t3', 'dark-300s', 'dark', '2026-05-15T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO calibration_fingerprint \
         (id, calibration_type, gain, offset_val, exposure_s, temp_c, binning) \
         VALUES ('cal-t3', 'dark', 100.0, 50.0, 300.0, -10.0, '1x1')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // Compatible light session: matches every hard-rule dimension.
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, created_at) \
         VALUES ('acq-t3', 'M31/L/2026-05-15/300/1x1', '2026-05-15T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO acquisition_fingerprint \
         (id, session_type, gain, offset_val, exposure_s, temp_c, binning, \
          has_observer_location, has_exposure_start_utc) \
         VALUES ('acq-t3', 'light', 100.0, 50.0, 300.0, -10.0, '1x1', 1, 1)",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // Incompatible light session: gain hard-rule mismatch (dark's hard
    // dimensions are gain + offset, so this must exclude the candidate).
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, created_at) \
         VALUES ('acq-t4', 'M31/L/2026-05-16/300/1x1', '2026-05-16T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO acquisition_fingerprint \
         (id, session_type, gain, offset_val, exposure_s, temp_c, binning) \
         VALUES ('acq-t4', 'light', 200.0, 50.0, 300.0, -10.0, '1x1')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let detail = masters_get(db.pool(), "cal-t3").await.unwrap();
    let ids: Vec<&str> = detail.compatible_sessions.iter().map(|e| e.session_id.as_str()).collect();
    assert_eq!(ids, vec!["acq-t3"], "only the matching light session should be compatible");
}

/// T032 / T037: calibration suggest finds real masters from populated fingerprints.
#[tokio::test]
async fn suggest_uses_real_fingerprint_rows() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    // Insert acquisition session + fingerprint.
    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, created_at) \
         VALUES ('acq-t1', 'M31/L/2026-03-01/100/1x1', '2026-03-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO acquisition_fingerprint \
         (id, session_type, gain, exposure_s, binning, \
          has_observer_location, has_exposure_start_utc) \
         VALUES ('acq-t1', 'light', 100.0, 300.0, '1x1', 0, 0)",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // Insert calibration master fingerprint.
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-t3', 'dark-300s-gain100', 'dark', '2026-03-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO calibration_fingerprint \
         (id, calibration_type, gain, exposure_s, binning) \
         VALUES ('cal-t3', 'dark', 100.0, 300.0, '1x1')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    // masters_list must return the real row.
    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1);
    assert_eq!(masters[0].id, "cal-t3");
}

/// In-memory caching layer (F0 follow-up): a `load_config` cache hit must
/// skip the DB entirely, so a `calibration_tolerances` update after the
/// first call is invisible until `invalidate_calibration_config` is
/// called.
#[tokio::test]
async fn load_config_cache_hit_skips_db_until_invalidated() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_config();
    let db = test_db().await;

    let first = load_config(db.pool()).await;
    assert!(first.require_same_offset, "fresh DB primes the cache with the default (true)");

    let row = persistence_db::repositories::calibration_tolerances::CalibrationTolerancesRow {
        temperature_tolerance_c: 5.0,
        exposure_tolerance_s: 2.0,
        aging_limit_days: 365,
        require_same_camera: true,
        require_same_gain: true,
        require_same_binning: true,
        require_same_offset: false,
    };
    persistence_db::repositories::calibration_tolerances::update(db.pool(), &row).await.unwrap();

    let cached = load_config(db.pool()).await;
    assert!(cached.require_same_offset, "cache hit must not see the post-priming update");

    caches::invalidate_calibration_config();
    let fresh = load_config(db.pool()).await;
    assert!(!fresh.require_same_offset, "after invalidation, the update must be visible");
}

/// Spec 043 P8: `load_config` defaults `require_same_offset` to true on a
/// fresh DB, matching `MatchingRuleConfig::default()` (migration 0008/0051
/// seed row).
#[tokio::test]
async fn load_config_defaults_require_same_offset_true() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_config();
    let db = test_db().await;
    let config = load_config(db.pool()).await;
    assert!(config.require_same_offset);
}

/// In-memory caching layer (F0 follow-up): a `masters_list` cache hit
/// must skip the DB entirely, so a row inserted after the first call is
/// invisible until `invalidate_calibration_masters` is called.
#[tokio::test]
async fn masters_list_cache_hit_skips_db_until_invalidated() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_masters();
    let db = test_db().await;

    let first = masters_list(db.pool()).await.unwrap();
    assert!(first.is_empty(), "fresh DB primes the cache with an empty snapshot");

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES ('cal-t4', 'dark-60s', 'dark', '2026-06-01T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO calibration_fingerprint (id, calibration_type, gain, exposure_s, binning) \
         VALUES ('cal-t4', 'dark', 100.0, 60.0, '1x1')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let cached = masters_list(db.pool()).await.unwrap();
    assert!(cached.is_empty(), "cache hit must not see the row inserted after priming");

    caches::invalidate_calibration_masters();
    let fresh = masters_list(db.pool()).await.unwrap();
    assert_eq!(fresh.len(), 1, "after invalidation, the new row must be visible");
}

/// Spec 043 P8: the Settings > Calibration Matching "Offset match
/// required" toggle persists via `calibration_tolerances` and must feed
/// `MatchingRuleConfig::require_same_offset` on the next `load_config`
/// call — this is the engine-side half of closing the STUB-OFFSET-REQUIRED
/// gap.
///
/// #988: was flaky under `cargo test` before the cache-test lock was shared
/// with `caches::tests` (see [`lock_cache_tests`]) — a concurrently running
/// `caches::tests` round-trip test could invalidate/store the same
/// `CALIBRATION_CONFIG` slot between this test's `invalidate` and its final
/// `load_config` read.
#[tokio::test]
async fn load_config_reads_require_same_offset_from_tolerances_table() {
    let _guard = lock_cache_tests().await;
    caches::invalidate_calibration_config();
    let db = test_db().await;

    let row = persistence_db::repositories::calibration_tolerances::CalibrationTolerancesRow {
        temperature_tolerance_c: 5.0,
        exposure_tolerance_s: 2.0,
        aging_limit_days: 365,
        require_same_camera: true,
        require_same_gain: true,
        require_same_binning: true,
        require_same_offset: false,
    };
    persistence_db::repositories::calibration_tolerances::update(db.pool(), &row).await.unwrap();

    let config = load_config(db.pool()).await;
    assert!(!config.require_same_offset, "toggling off must reach MatchingRuleConfig");
}
