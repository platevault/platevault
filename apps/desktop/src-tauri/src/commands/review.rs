//! Spec 029 review queue stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use std::collections::HashMap;

use contracts_core::review::{ReviewItem, ReviewItemKind};
use contracts_core::sessions::{ConfidenceLevel, MetaValue, ProvenanceOrigin};
use contracts_core::ContractError;
use contracts_core::JsonAny;

/// `review.queue` — returns items awaiting user review.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn review_queue(filter: Option<String>) -> Result<Vec<ReviewItem>, ContractError> {
    tracing::debug!("stub: review.queue filter={filter:?}");
    Ok(vec![
        ReviewItem {
            id: "review-001".to_owned(),
            kind: ReviewItemKind::Session,
            session_id: Some("550e8400-e29b-41d4-a716-446655440003".to_owned()),
            file_path: None,
            confidence: ConfidenceLevel::Medium,
            blocking_reasons: vec!["filter origin is inferred".to_owned()],
            evidence: HashMap::from([(
                "target".to_owned(),
                MetaValue {
                    value: JsonAny::from(serde_json::json!("M31")),
                    raw: Some("M31".to_owned()),
                    origin: ProvenanceOrigin::Observed,
                    confidence: ConfidenceLevel::High,
                    evidence_ref: None,
                },
            )]),
            suggested_target: Some("M31".to_owned()),
            suggested_filter: Some("L".to_owned()),
        },
        ReviewItem {
            id: "review-002".to_owned(),
            kind: ReviewItemKind::UnclassifiedFile,
            session_id: None,
            file_path: Some("/astro/raw/unsorted/image_2026-04-12_001.fits".to_owned()),
            confidence: ConfidenceLevel::Low,
            blocking_reasons: vec![
                "no FITS OBJECT keyword".to_owned(),
                "camera not recognised".to_owned(),
            ],
            evidence: HashMap::from([(
                "filename".to_owned(),
                MetaValue {
                    value: JsonAny::from(serde_json::json!("image_2026-04-12_001.fits")),
                    raw: Some("image_2026-04-12_001.fits".to_owned()),
                    origin: ProvenanceOrigin::Observed,
                    confidence: ConfidenceLevel::Low,
                    evidence_ref: Some("filename".to_owned()),
                },
            )]),
            suggested_target: None,
            suggested_filter: None,
        },
        ReviewItem {
            id: "review-003".to_owned(),
            kind: ReviewItemKind::Session,
            session_id: Some("550e8400-e29b-41d4-a716-446655440002".to_owned()),
            file_path: None,
            confidence: ConfidenceLevel::Low,
            blocking_reasons: vec![
                "target confidence low".to_owned(),
                "no calibration match found".to_owned(),
            ],
            evidence: HashMap::from([(
                "target".to_owned(),
                MetaValue {
                    value: JsonAny::from(serde_json::json!("IC 1396")),
                    raw: Some("IC1396".to_owned()),
                    origin: ProvenanceOrigin::Inferred,
                    confidence: ConfidenceLevel::Low,
                    evidence_ref: Some("fits.object".to_owned()),
                },
            )]),
            suggested_target: Some("IC 1396".to_owned()),
            suggested_filter: Some("SII".to_owned()),
        },
    ])
}
