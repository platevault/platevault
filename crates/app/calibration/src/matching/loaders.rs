// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared DB-loading helpers: session/master fingerprint rows and the
//! `MatchingRuleConfig` snapshot cache.

use std::sync::Arc;

use calibration_core::ranking::MatchingRuleConfig;
use calibration_core::{CalibrationKind, MasterInfo, SessionInfo};
use persistence_calibration::repositories::q_calibration;
use sqlx::SqlitePool;

use crate::caches;

use super::{KEY_BIAS_OVERRIDE, KEY_DARK_OVERRIDE, KEY_DARK_TEMP, KEY_FLAT_OVERRIDE, KEY_PREFILL};

/// Load `SessionInfo` from the `acquisition_fingerprint` table (migration 0023).
///
/// Returns `None` when no fingerprint exists for the session.
pub(super) async fn load_session(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<SessionInfo>, String> {
    // Validate session exists first (for proper "not found" error).
    let exists = q_calibration::acquisition_session_exists(pool, session_id)
        .await
        .map_err(|e| e.to_string())?;

    if !exists {
        return Ok(None);
    }

    // Try to load fingerprint.
    let row = q_calibration::get_acquisition_fingerprint(pool, session_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(Some(match row {
        Some(r) => SessionInfo {
            id: r.id,
            session_type: r.session_type.unwrap_or_else(|| "light".to_owned()),
            gain: r.gain,
            offset: r.offset_val,
            exposure_s: r.exposure_s,
            temp_c: r.temp_c,
            filter: r.filter_name,
            rotation_deg: r.rotation_deg,
            binning: r.binning,
            optic_train: r.optic_train,
            observing_night_date: r.observing_night_date,
            has_observer_location: r.has_observer_location.unwrap_or(0) != 0,
            has_exposure_start_utc: r.has_exposure_start_utc.unwrap_or(0) != 0,
        },
        // No fingerprint row → session exists but has no metadata yet.
        // #867: this no longer hard-rejects; suggest degrades gracefully
        // (missing observing_night_date becomes a metadata_missing soft
        // mismatch instead of excluding every candidate).
        None => SessionInfo {
            id: session_id.to_owned(),
            session_type: "light".to_owned(),
            has_observer_location: false,
            has_exposure_start_utc: false,
            ..Default::default()
        },
    }))
}

/// Load `MasterInfo` rows from `calibration_fingerprint` table (migration 0023).
pub(super) async fn load_masters(
    pool: &SqlitePool,
    kinds: &[CalibrationKind],
) -> Result<Vec<MasterInfo>, String> {
    let rows =
        q_calibration::list_calibration_fingerprints(pool).await.map_err(|e| e.to_string())?;

    let type_filter: Vec<&str> = kinds
        .iter()
        .filter_map(|k| match k {
            CalibrationKind::Dark => Some("dark"),
            CalibrationKind::Flat => Some("flat"),
            CalibrationKind::Bias => Some("bias"),
            CalibrationKind::DarkFlat => None,
        })
        .collect();

    Ok(rows
        .into_iter()
        .filter(|r| type_filter.is_empty() || type_filter.contains(&r.calibration_type.as_str()))
        .filter_map(|r| {
            // DB CHECK constrains `calibration_type` to dark/flat/bias;
            // anything unparseable is skipped, preserving prior behavior.
            let kind: CalibrationKind = r.calibration_type.parse().ok()?;
            Some(MasterInfo {
                id: r.id,
                kind,
                gain: r.gain,
                offset: r.offset_val,
                exposure_s: r.exposure_s,
                temp_c: r.temp_c,
                filter: r.filter_name,
                rotation_deg: r.rotation_deg,
                binning: r.binning,
                optic_train: r.optic_train,
                source_session_id: r.source_session_id,
                observing_night_date: r.observing_night_date,
            })
        })
        .collect())
}

/// Load a single `MasterInfo` by id from `calibration_fingerprint`.
pub(super) async fn load_master_by_id(
    pool: &SqlitePool,
    master_id: &str,
) -> Result<Option<MasterInfo>, String> {
    let row = q_calibration::get_calibration_fingerprint(pool, master_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.and_then(|r| {
        // DB CHECK constrains `calibration_type` to dark/flat/bias;
        // anything unparseable is skipped, preserving prior behavior.
        let kind: CalibrationKind = r.calibration_type.parse().ok()?;
        Some(MasterInfo {
            id: r.id,
            kind,
            gain: r.gain,
            offset: r.offset_val,
            exposure_s: r.exposure_s,
            temp_c: r.temp_c,
            filter: r.filter_name,
            rotation_deg: r.rotation_deg,
            binning: r.binning,
            optic_train: r.optic_train,
            source_session_id: r.source_session_id,
            observing_night_date: r.observing_night_date,
        })
    }))
}

/// Load `MatchingRuleConfig`, reading through the process-global
/// `caches::calibration_config` snapshot (in-memory caching layer, F0).
///
/// A hit returns the cached snapshot without touching the DB; a miss falls
/// through to [`load_config_from_db`] and stores the freshly loaded value
/// before returning it.
pub(super) async fn load_config(pool: &SqlitePool) -> MatchingRuleConfig {
    if let Some(cached) = caches::calibration_config().load() {
        return (*cached).clone();
    }
    let config = load_config_from_db(pool).await;
    caches::store_calibration_config(Arc::new(config.clone()));
    config
}

/// Load `MatchingRuleConfig` from persisted settings keys, falling back to defaults.
async fn load_config_from_db(pool: &SqlitePool) -> MatchingRuleConfig {
    let mut config = MatchingRuleConfig::default();

    // `require_same_offset` is persisted on the `calibration_tolerances`
    // singleton row (migration 0051), not the generic settings key/value
    // store — it's user-controlled via the Settings > Calibration Matching
    // "Offset match required" toggle (spec 043 P8). Falls back to
    // `MatchingRuleConfig::default()` (true) on read failure.
    if let Ok(row) = persistence_calibration::repositories::calibration_tolerances::get(pool).await
    {
        config.require_same_offset = row.require_same_offset;
    }

    if let Ok(Some(v)) =
        persistence_lifecycle::repositories::settings::get_raw(pool, KEY_DARK_TEMP).await
    {
        if let Some(n) = v.as_f64() {
            config.dark_temp_tolerance_c = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_lifecycle::repositories::settings::get_raw(pool, KEY_DARK_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.dark_override_penalty = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_lifecycle::repositories::settings::get_raw(pool, KEY_FLAT_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.flat_override_penalty = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_lifecycle::repositories::settings::get_raw(pool, KEY_BIAS_OVERRIDE).await
    {
        if let Some(n) = v.as_f64() {
            config.bias_override_penalty = n;
        }
    }
    if let Ok(Some(v)) =
        persistence_lifecycle::repositories::settings::get_raw(pool, KEY_PREFILL).await
    {
        if let Some(b) = v.as_bool() {
            config.prefill_suggestion = b;
        }
    }
    config
}
