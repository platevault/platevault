// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Free-function query repository for calibration matching (spec 007) and
//! equipment auto-detect flags (spec 030), migrated out of
//! `app_calibration::matching` / `app_calibration::equipment`
//! (db-boundary-zero drain). Business logic, domain mapping, and error
//! handling stay in the app layer — this module only executes SQL against the
//! tables it fronts: `cameras`/`telescopes`/`filters` (auto-detect flag only),
//! `calibration_session`, `calibration_fingerprint`, `calibration_assignment`,
//! `calibration_master_view`, `acquisition_fingerprint`, `project_sources`.

use sqlx::SqlitePool;

use crate::DbResult;

// ── Equipment auto-detect flag (spec 030) ──────────────────────────────────

/// Mark a camera row as auto-detected (`cameras.auto_detected = 1`).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn mark_camera_auto_detected(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query("UPDATE cameras SET auto_detected = 1 WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

/// Mark a telescope row as auto-detected (`telescopes.auto_detected = 1`).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn mark_telescope_auto_detected(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query("UPDATE telescopes SET auto_detected = 1 WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Mark a filter row as auto-detected (`filters.auto_detected = 1`).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn mark_filter_auto_detected(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query("UPDATE filters SET auto_detected = 1 WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ── Session / master fingerprint rows (spec 007, migration 0023) ──────────

/// Row from `acquisition_fingerprint`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AcquisitionFingerprintRow {
    pub id: String,
    pub session_type: Option<String>,
    pub gain: Option<f64>,
    pub offset_val: Option<f64>,
    pub exposure_s: Option<f64>,
    pub temp_c: Option<f64>,
    pub filter_name: Option<String>,
    pub rotation_deg: Option<f64>,
    pub binning: Option<String>,
    pub optic_train: Option<String>,
    pub observing_night_date: Option<String>,
    pub has_observer_location: Option<i64>,
    pub has_exposure_start_utc: Option<i64>,
}

/// Row from `calibration_fingerprint`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CalibrationFingerprintRow {
    pub id: String,
    pub calibration_type: String,
    pub gain: Option<f64>,
    pub offset_val: Option<f64>,
    pub exposure_s: Option<f64>,
    pub temp_c: Option<f64>,
    pub filter_name: Option<String>,
    pub rotation_deg: Option<f64>,
    pub binning: Option<String>,
    pub optic_train: Option<String>,
    pub source_session_id: Option<String>,
    pub observing_night_date: Option<String>,
}

/// Row from `calibration_master_view` (migration 0033).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CalibrationMasterViewRow {
    pub id: String,
    pub kind: String,
    pub created_at: String,
    pub size_bytes: i64,
    pub fp_gain: Option<f64>,
    pub fp_exposure_s: Option<f64>,
    pub fp_temp_c: Option<f64>,
    pub fp_filter_name: Option<String>,
    pub fp_binning: Option<String>,
    pub fp_optic_train: Option<String>,
    pub source_session_id: Option<String>,
}

/// Whether an `acquisition_session` row exists for `session_id`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn acquisition_session_exists(pool: &SqlitePool, session_id: &str) -> DbResult<bool> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM acquisition_session WHERE id = ?")
        .bind(session_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Load the `acquisition_fingerprint` row for a session id, if present.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_acquisition_fingerprint(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<AcquisitionFingerprintRow>> {
    let row = sqlx::query_as::<_, AcquisitionFingerprintRow>(
        "
        SELECT id, session_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               observing_night_date, has_observer_location, has_exposure_start_utc
        FROM acquisition_fingerprint
        WHERE id = ?
        ",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// List `calibration_fingerprint` rows restricted to dark/flat/bias kinds.
///
/// Callers apply any requested-kind narrowing in-memory (mirrors prior
/// behavior: SQL restricts to the fixed dark/flat/bias set).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn list_calibration_fingerprints(
    pool: &SqlitePool,
) -> DbResult<Vec<CalibrationFingerprintRow>> {
    let rows = sqlx::query_as::<_, CalibrationFingerprintRow>(
        "
        SELECT id, calibration_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               source_session_id, observing_night_date
        FROM calibration_fingerprint
        WHERE calibration_type IN ('dark', 'flat', 'bias')
        ",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Load a single `calibration_fingerprint` row by id.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_calibration_fingerprint(
    pool: &SqlitePool,
    master_id: &str,
) -> DbResult<Option<CalibrationFingerprintRow>> {
    let row = sqlx::query_as::<_, CalibrationFingerprintRow>(
        "
        SELECT id, calibration_type, gain, offset_val, exposure_s,
               temp_c, filter_name, rotation_deg, binning, optic_train,
               source_session_id, observing_night_date
        FROM calibration_fingerprint
        WHERE id = ?
        ",
    )
    .bind(master_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

// ── Masters list / get (T037, FR-013) ──────────────────────────────────────

/// List all `calibration_master_view` rows, newest first.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn list_calibration_masters(
    pool: &SqlitePool,
) -> DbResult<Vec<CalibrationMasterViewRow>> {
    let rows = sqlx::query_as::<_, CalibrationMasterViewRow>(
        "SELECT id, kind, created_at, size_bytes,
                fp_gain, fp_exposure_s, fp_temp_c, fp_filter_name, fp_binning,
                fp_optic_train, source_session_id
         FROM calibration_master_view
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Load a single `calibration_master_view` row by id.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_calibration_master(
    pool: &SqlitePool,
    master_id: &str,
) -> DbResult<Option<CalibrationMasterViewRow>> {
    let row = sqlx::query_as::<_, CalibrationMasterViewRow>(
        "SELECT id, kind, created_at, size_bytes,
                fp_gain, fp_exposure_s, fp_temp_c, fp_filter_name, fp_binning,
                fp_optic_train, source_session_id
         FROM calibration_master_view
         WHERE id = ?",
    )
    .bind(master_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// List `session_id`s from `calibration_assignment` rows assigned to a master.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn list_assignment_session_ids(
    pool: &SqlitePool,
    master_id: &str,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT session_id FROM calibration_assignment WHERE master_id = ?")
            .bind(master_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(s,)| s).collect())
}

/// List distinct `project_id`s linked (via `project_sources`) to sessions
/// assigned a given calibration master.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn list_assignment_project_ids(
    pool: &SqlitePool,
    master_id: &str,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT ps.project_id
         FROM project_sources ps
         JOIN calibration_assignment ca ON ca.session_id = ps.session_id
         WHERE ca.master_id = ?",
    )
    .bind(master_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}
