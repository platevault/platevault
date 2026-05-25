//! Spec 029 calibration stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::calibration::{
    CalibrationFingerprint, CalibrationKind, CalibrationMaster, CompatibleSessionEntry,
    MasterDetail, MasterUsageStats, MatchCandidate,
};

/// `calibration.masters.list` — returns all calibration masters.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "calibration.masters.list")]
pub async fn calibration_masters_list() -> Result<Vec<CalibrationMaster>, String> {
    tracing::debug!("stub: calibration.masters.list");
    Ok(vec![
        CalibrationMaster {
            id: "master-001".to_owned(),
            kind: CalibrationKind::Dark,
            fingerprint: CalibrationFingerprint {
                camera: "ASI2600MM".to_owned(),
                sensor_mode: Some("normal".to_owned()),
                exposure_s: 300.0,
                temp_c: Some(-10.0),
                gain: 100.0,
                binning: "1x1".to_owned(),
                filter: None,
            },
            source_session_id: "cal-ses-001".to_owned(),
            created_at: "2026-05-15T20:00:00Z".to_owned(),
            age_days: 9,
            size_bytes: 52_428_800,
            used_by_session_ids: vec!["ses-001".to_owned(), "ses-003".to_owned()],
            used_by_project_ids: vec!["proj-001".to_owned()],
        },
        CalibrationMaster {
            id: "master-002".to_owned(),
            kind: CalibrationKind::Flat,
            fingerprint: CalibrationFingerprint {
                camera: "ASI2600MM".to_owned(),
                sensor_mode: Some("normal".to_owned()),
                exposure_s: 2.0,
                temp_c: None,
                gain: 100.0,
                binning: "1x1".to_owned(),
                filter: Some("L".to_owned()),
            },
            source_session_id: "cal-ses-002".to_owned(),
            created_at: "2026-03-10T18:00:00Z".to_owned(),
            age_days: 75,
            size_bytes: 26_214_400,
            used_by_session_ids: vec!["ses-001".to_owned()],
            used_by_project_ids: vec!["proj-001".to_owned()],
        },
        CalibrationMaster {
            id: "master-003".to_owned(),
            kind: CalibrationKind::Bias,
            fingerprint: CalibrationFingerprint {
                camera: "ASI2600MM".to_owned(),
                sensor_mode: Some("normal".to_owned()),
                exposure_s: 0.0,
                temp_c: Some(-10.0),
                gain: 100.0,
                binning: "1x1".to_owned(),
                filter: None,
            },
            source_session_id: "cal-ses-003".to_owned(),
            created_at: "2026-05-01T19:00:00Z".to_owned(),
            age_days: 23,
            size_bytes: 13_107_200,
            used_by_session_ids: vec!["ses-001".to_owned(), "ses-003".to_owned(), "ses-005".to_owned()],
            used_by_project_ids: vec!["proj-001".to_owned()],
        },
    ])
}

/// `calibration.masters.get` — returns a single calibration master detail.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "calibration.masters.get")]
pub async fn calibration_masters_get(id: String) -> Result<MasterDetail, String> {
    tracing::debug!("stub: calibration.masters.get id={id}");
    Ok(MasterDetail {
        id,
        kind: CalibrationKind::Dark,
        fingerprint: CalibrationFingerprint {
            camera: "ASI2600MM".to_owned(),
            sensor_mode: Some("normal".to_owned()),
            exposure_s: 300.0,
            temp_c: Some(-10.0),
            gain: 100.0,
            binning: "1x1".to_owned(),
            filter: None,
        },
        source_session_id: "cal-ses-001".to_owned(),
        created_at: "2026-05-15T20:00:00Z".to_owned(),
        age_days: 9,
        size_bytes: 52_428_800,
        used_by_session_ids: vec!["ses-001".to_owned(), "ses-003".to_owned()],
        used_by_project_ids: vec!["proj-001".to_owned()],
        compatible_sessions: vec![
            CompatibleSessionEntry {
                session_id: "ses-001".to_owned(),
                score: 0.97,
                soft_mismatches: vec![],
            },
            CompatibleSessionEntry {
                session_id: "ses-003".to_owned(),
                score: 0.94,
                soft_mismatches: vec!["temperature delta 2C".to_owned()],
            },
        ],
        usage_stats: MasterUsageStats { session_count: 2, project_count: 1 },
    })
}

/// `calibration.matches` — returns calibration match candidates for a session.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "calibration.matches")]
pub async fn calibration_matches(session_id: String) -> Result<Vec<MatchCandidate>, String> {
    tracing::debug!("stub: calibration.matches session_id={session_id}");
    Ok(vec![
        MatchCandidate {
            master_id: "master-001".to_owned(),
            kind: CalibrationKind::Dark,
            score: 0.97,
            filter: None,
            soft_mismatches: vec![],
        },
        MatchCandidate {
            master_id: "master-002".to_owned(),
            kind: CalibrationKind::Flat,
            score: 0.92,
            filter: Some("L".to_owned()),
            soft_mismatches: vec!["age > 60 days".to_owned()],
        },
        MatchCandidate {
            master_id: "master-003".to_owned(),
            kind: CalibrationKind::Bias,
            score: 0.99,
            filter: None,
            soft_mismatches: vec![],
        },
    ])
}
