//! Spec 029 session stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use std::collections::HashMap;

use contracts_core::calibration::CalibrationKind;
use contracts_core::sessions::{
    AcquisitionSession, CalendarData, CalendarDay, CalendarMonth, CalendarSessionStub,
    ConfidenceLevel, Frameset, MetaValue, ProvenanceOrigin, SessionCalibrationMatch, SessionDetail,
    SessionHistoryEntry, SessionKey, SessionState,
};
use contracts_core::JsonAny;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Wrapper for `sessions.split` return value.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSplitResult {
    pub original: AcquisitionSession,
    pub new: AcquisitionSession,
}

/// `sessions.list` — returns all acquisition sessions.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.list")]
pub async fn sessions_list() -> Result<Vec<AcquisitionSession>, String> {
    tracing::debug!("stub: sessions.list");
    Ok(stub_sessions())
}

/// `sessions.get` — returns a single session detail.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.get")]
pub async fn sessions_get(id: String) -> Result<SessionDetail, String> {
    tracing::debug!("stub: sessions.get id={id}");
    let base = &stub_sessions()[0];
    Ok(SessionDetail {
        id: id.clone(),
        session_key: base.session_key.clone(),
        state: base.state,
        confidence: base.confidence,
        optical_train_id: base.optical_train_id.clone(),
        frame_count: base.frame_count,
        total_integration_seconds: base.total_integration_seconds,
        total_size_bytes: base.total_size_bytes,
        metadata: base.metadata.clone(),
        target_ids: base.target_ids.clone(),
        project_ids: base.project_ids.clone(),
        warnings: base.warnings.clone(),
        framesets: vec![
            Frameset { filter: "Ha".to_owned(), count: 18, integration_s: 10800.0 },
            Frameset { filter: "OIII".to_owned(), count: 15, integration_s: 9000.0 },
            Frameset { filter: "SII".to_owned(), count: 12, integration_s: 7200.0 },
        ],
        calibration_matches: vec![
            SessionCalibrationMatch {
                master_id: "master-001".to_owned(),
                kind: CalibrationKind::Dark,
                score: 0.97,
                soft_mismatches: vec![],
            },
            SessionCalibrationMatch {
                master_id: "master-002".to_owned(),
                kind: CalibrationKind::Flat,
                score: 0.92,
                soft_mismatches: vec!["age > 60 days".to_owned()],
            },
        ],
        history: vec![
            SessionHistoryEntry {
                timestamp: "2026-04-12T22:00:00Z".to_owned(),
                event: "discovered".to_owned(),
                actor: "system".to_owned(),
            },
            SessionHistoryEntry {
                timestamp: "2026-04-13T10:30:00Z".to_owned(),
                event: "confirmed".to_owned(),
                actor: "user".to_owned(),
            },
        ],
    })
}

/// `sessions.calendar` — returns calendar data for a month range.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.calendar")]
pub async fn sessions_calendar(
    start_month: String,
    end_month: String,
) -> Result<CalendarData, String> {
    tracing::debug!("stub: sessions.calendar start={start_month} end={end_month}");
    Ok(CalendarData {
        months: vec![CalendarMonth {
            year: 2026,
            month: 5,
            days: vec![
                CalendarDay {
                    day: 18,
                    sessions: vec![CalendarSessionStub {
                        id: "ses-001".to_owned(),
                        target: "M31".to_owned(),
                        filter: "L".to_owned(),
                    }],
                },
                CalendarDay {
                    day: 19,
                    sessions: vec![
                        CalendarSessionStub {
                            id: "ses-003".to_owned(),
                            target: "M31".to_owned(),
                            filter: "R".to_owned(),
                        },
                        CalendarSessionStub {
                            id: "ses-004".to_owned(),
                            target: "M31".to_owned(),
                            filter: "G".to_owned(),
                        },
                    ],
                },
                CalendarDay {
                    day: 20,
                    sessions: vec![CalendarSessionStub {
                        id: "ses-005".to_owned(),
                        target: "NGC 7000".to_owned(),
                        filter: "Ha".to_owned(),
                    }],
                },
            ],
        }],
    })
}

/// `sessions.transition` — transition a session to a new state.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.transition")]
pub async fn sessions_transition(
    id: String,
    action: String,
    metadata: Option<serde_json::Value>,
) -> Result<AcquisitionSession, String> {
    tracing::debug!("stub: sessions.transition id={id} action={action} metadata={metadata:?}");
    let mut session = stub_sessions().into_iter().next().unwrap();
    session.id = id;
    session.state = SessionState::Confirmed;
    session.confidence = ConfidenceLevel::Confirmed;
    Ok(session)
}

/// `sessions.split` — split a session at a given frame index.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.split")]
pub async fn sessions_split(
    id: String,
    split_at_index: u32,
) -> Result<SessionSplitResult, String> {
    tracing::debug!("stub: sessions.split id={id} split_at_index={split_at_index}");
    let sessions = stub_sessions();
    let mut original = sessions[0].clone();
    original.id = id;
    original.frame_count = split_at_index;

    let mut new_session = sessions[1].clone();
    new_session.id = "550e8400-e29b-41d4-a716-446655440099".to_owned();
    new_session.frame_count = 18_u32.saturating_sub(split_at_index);

    Ok(SessionSplitResult { original, new: new_session })
}

/// `sessions.merge` — merge multiple sessions into one.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.merge")]
pub async fn sessions_merge(ids: Vec<String>) -> Result<AcquisitionSession, String> {
    tracing::debug!("stub: sessions.merge ids={ids:?}");
    let mut merged = stub_sessions().into_iter().next().unwrap();
    merged.id = ids.into_iter().next().unwrap_or_default();
    merged.frame_count = 30;
    merged.total_integration_seconds = 18000.0;
    Ok(merged)
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

/// Optical train and target UUIDs matching the frontend fixture constants.
mod ids {
    pub const TRAIN_FSQ106: &str = "550e8400-e29b-41d4-a716-446655440101";
    pub const TRAIN_GT81: &str = "550e8400-e29b-41d4-a716-446655440102";
    pub const TARGET_NGC7000: &str = "550e8400-e29b-41d4-a716-446655440201";
    pub const TARGET_M31: &str = "550e8400-e29b-41d4-a716-446655440202";
    pub const TARGET_IC1396: &str = "550e8400-e29b-41d4-a716-446655440203";
    pub const TARGET_M42: &str = "550e8400-e29b-41d4-a716-446655440204";
    pub const PROJECT_NGC7000_NB: &str = "550e8400-e29b-41d4-a716-446655440301";
}

fn meta(
    value: &str,
    raw: &str,
    origin: ProvenanceOrigin,
    confidence: ConfidenceLevel,
    evidence_ref: Option<&str>,
) -> MetaValue {
    MetaValue {
        value: JsonAny::from(serde_json::json!(value)),
        raw: Some(raw.to_owned()),
        origin,
        confidence,
        evidence_ref: evidence_ref.map(ToOwned::to_owned),
    }
}

fn key(target: &str, filter: &str, binning: &str, gain: &str, night: &str) -> SessionKey {
    SessionKey {
        target: target.to_owned(),
        filter: filter.to_owned(),
        binning: binning.to_owned(),
        gain: gain.to_owned(),
        night: night.to_owned(),
    }
}

fn stub_sessions() -> Vec<AcquisitionSession> {
    vec![
        // discovered — NGC 7000 Ha
        AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440001".to_owned(),
            session_key: key("NGC 7000", "Ha", "1", "100", "2026-04-12"),
            state: SessionState::Discovered,
            confidence: ConfidenceLevel::Unknown,
            optical_train_id: ids::TRAIN_FSQ106.to_owned(),
            frame_count: 18,
            total_integration_seconds: 10800.0,
            total_size_bytes: 1_258_291_200,
            metadata: HashMap::from([
                ("target".to_owned(), meta("NGC 7000", "NGC7000", ProvenanceOrigin::Observed, ConfidenceLevel::Medium, None)),
                ("filter".to_owned(), meta("Ha", "H-alpha 7nm", ProvenanceOrigin::Observed, ConfidenceLevel::High, None)),
            ]),
            target_ids: vec![ids::TARGET_NGC7000.to_owned()],
            project_ids: vec![],
            warnings: vec!["target not yet confirmed".to_owned()],
        },
        // discovered — IC 1396 SII
        AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440002".to_owned(),
            session_key: key("IC 1396", "SII", "1", "100", "2026-04-14"),
            state: SessionState::Discovered,
            confidence: ConfidenceLevel::Low,
            optical_train_id: ids::TRAIN_FSQ106.to_owned(),
            frame_count: 12,
            total_integration_seconds: 7200.0,
            total_size_bytes: 838_860_800,
            metadata: HashMap::from([(
                "target".to_owned(),
                meta("IC 1396", "IC1396", ProvenanceOrigin::Inferred, ConfidenceLevel::Low, Some("fits.object")),
            )]),
            target_ids: vec![ids::TARGET_IC1396.to_owned()],
            project_ids: vec![],
            warnings: vec![
                "target confidence low".to_owned(),
                "no calibration match found".to_owned(),
            ],
        },
        // needs_review — M31 L
        AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440003".to_owned(),
            session_key: key("M31", "L", "1", "0", "2026-03-28"),
            state: SessionState::NeedsReview,
            confidence: ConfidenceLevel::Medium,
            optical_train_id: ids::TRAIN_GT81.to_owned(),
            frame_count: 60,
            total_integration_seconds: 5400.0,
            total_size_bytes: 2_147_483_648,
            metadata: HashMap::from([(
                "target".to_owned(),
                meta("M31", "M31", ProvenanceOrigin::Observed, ConfidenceLevel::High, None),
            )]),
            target_ids: vec![ids::TARGET_M31.to_owned()],
            project_ids: vec![],
            warnings: vec!["filter origin is inferred \u{2014} please verify".to_owned()],
        },
        // confirmed — NGC 7000 OIII
        AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440005".to_owned(),
            session_key: key("NGC 7000", "OIII", "1", "100", "2026-04-15"),
            state: SessionState::Confirmed,
            confidence: ConfidenceLevel::Confirmed,
            optical_train_id: ids::TRAIN_FSQ106.to_owned(),
            frame_count: 15,
            total_integration_seconds: 9000.0,
            total_size_bytes: 1_048_576_000,
            metadata: HashMap::from([
                ("target".to_owned(), meta("NGC 7000", "NGC7000", ProvenanceOrigin::Reviewed, ConfidenceLevel::Confirmed, None)),
                ("filter".to_owned(), meta("OIII", "OIII 6.5nm", ProvenanceOrigin::Reviewed, ConfidenceLevel::Confirmed, None)),
            ]),
            target_ids: vec![ids::TARGET_NGC7000.to_owned()],
            project_ids: vec![ids::PROJECT_NGC7000_NB.to_owned()],
            warnings: vec![],
        },
        // rejected — M42 OIII
        AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440009".to_owned(),
            session_key: key("M42", "OIII", "1", "100", "2026-02-11"),
            state: SessionState::Rejected,
            confidence: ConfidenceLevel::Rejected,
            optical_train_id: ids::TRAIN_GT81.to_owned(),
            frame_count: 8,
            total_integration_seconds: 4800.0,
            total_size_bytes: 560_000_000,
            metadata: HashMap::from([(
                "target".to_owned(),
                meta("M42", "M42", ProvenanceOrigin::Observed, ConfidenceLevel::High, None),
            )]),
            target_ids: vec![ids::TARGET_M42.to_owned()],
            project_ids: vec![],
            warnings: vec![
                "high cloud cover during capture".to_owned(),
                "star FWHM > 6 arcsec".to_owned(),
            ],
        },
    ]
}
