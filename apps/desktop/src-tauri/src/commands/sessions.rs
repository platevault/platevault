//! Spec 029 session query stubs exposed to the Tauri webview.
//!
//! This is the proof-of-concept command for validating the end-to-end
//! tauri-specta pipeline: Rust stub -> typed TS binding -> frontend invoke.
//! The stub returns hardcoded fixture data matching the mock layer until
//! the real persistence layer is wired.

use std::collections::HashMap;

use contracts_core::sessions::{
    AcquisitionSession, ConfidenceLevel, MetaValue, ProvenanceOrigin, SessionKey, SessionState,
};
use contracts_core::JsonAny;

/// `sessions.list` — returns all acquisition sessions.
///
/// Stub implementation returning hardcoded fixture data that mirrors
/// `apps/desktop/src/data/fixtures/sessions.ts`.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "sessions.list")]
pub async fn sessions_list() -> Result<Vec<AcquisitionSession>, String> {
    tracing::debug!("stub: sessions.list");
    Ok(stub_sessions())
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
