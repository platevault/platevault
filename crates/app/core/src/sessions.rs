//! Session use cases (spec 029 / spec 037).
//!
//! Real implementations (T037):
//!   `list_sessions` -- backed by `acquisition_session` + `acquisition_fingerprint`.
//!   `get_session`   -- backed by `acquisition_session` joined with related tables
//!                      for calibration_matches and audit history.
//!
//! Stub placeholders (to be wired when domain logic is built):
//!   `split_session` -- not yet implemented.
//!   `merge_sessions` -- not yet implemented.
//!
//! # Architecture
//!
//! `acquisition_session` stores: id, session_key (JSON), frame_ids (JSON array),
//! state, target_id, observer_location (JSON), last_action (JSON), created_at.
//! `acquisition_fingerprint` stores per-session metadata dimensions for
//! calibration matching (gain, filter, binning, optic_train, etc.).
//!
//! Many contract DTO fields (confidence, total_integration_seconds, total_size_bytes,
//! metadata, warnings, framesets) have no column yet; defaulted with
//! `// TODO(037):` markers until later columns/views are built.

use contracts_core::calibration::CalibrationKind;
use contracts_core::sessions::{
    AcquisitionSession, ConfidenceLevel, Frameset, SessionCalibrationMatch, SessionDetail,
    SessionHistoryEntry, SessionKey, SessionState,
};
use sqlx::SqlitePool;
use std::collections::HashMap;

// -- Public use-case functions ------------------------------------------------

/// `sessions.list` -- return all acquisition sessions from real DB rows.
///
/// Queries `acquisition_session` and joins `acquisition_fingerprint` for
/// supplementary metadata dimensions. Sessions are ordered by `created_at DESC`.
///
/// # Errors
/// Returns `Err(String)` on database failure.
pub async fn list_sessions(pool: &SqlitePool) -> Result<Vec<AcquisitionSession>, String> {
    let rows: Vec<(
        String,         // id
        String,         // session_key (JSON)
        String,         // state
        Option<String>, // target_id
        String,         // frame_ids (JSON array)
        String,         // created_at
    )> = sqlx::query_as(
        "SELECT id, session_key, state, target_id, frame_ids, created_at
         FROM acquisition_session
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut sessions = Vec::with_capacity(rows.len());
    for (id, session_key_json, state, target_id, frame_ids_json, _created_at) in rows {
        let fp = load_fingerprint(pool, &id).await?;
        let sk = parse_session_key(&session_key_json, fp.as_ref());
        let st = parse_session_state(&state);
        // TODO(037): confidence has no column; derive a best-effort value from state.
        let confidence = confidence_from_state(st);
        // TODO(037): optical_train_id -- fingerprint stores name, not UUID.
        let optical_train_id = fp.as_ref().and_then(|f| f.optic_train.clone()).unwrap_or_default();
        // frame_count from JSON array length; 0 when frame_ids is malformed.
        let frame_count = count_json_array(&frame_ids_json);
        // TODO(037): total_integration_seconds -- not stored; requires frame-level data.
        let total_integration_seconds = 0.0_f64;
        // TODO(037): total_size_bytes -- not stored; requires frame-level data.
        let total_size_bytes = 0_u64;
        // TODO(037): metadata -- not stored as structured provenance rows yet.
        let metadata = HashMap::new();
        let target_ids = target_id.into_iter().collect();
        let project_ids = load_project_ids(pool, &id).await?;
        // TODO(037): warnings -- not stored; derive from state/fingerprint in future.
        let warnings = Vec::new();
        sessions.push(AcquisitionSession {
            id,
            session_key: sk,
            state: st,
            confidence,
            optical_train_id,
            frame_count,
            total_integration_seconds,
            total_size_bytes,
            metadata,
            target_ids,
            project_ids,
            warnings,
        });
    }
    Ok(sessions)
}

/// `sessions.get` -- return detail for a single acquisition session.
///
/// Returns `Err("session.not_found: <id>")` when the session does not exist,
/// mirroring the `masters_get` not-found pattern.
///
/// # Errors
/// Returns `Err(String)` on database failure or when the session is absent.
pub async fn get_session(pool: &SqlitePool, id: &str) -> Result<SessionDetail, String> {
    let row: Option<(
        String,         // id
        String,         // session_key (JSON)
        String,         // state
        Option<String>, // target_id
        String,         // frame_ids (JSON)
        String,         // created_at
    )> = sqlx::query_as(
        "SELECT id, session_key, state, target_id, frame_ids, created_at
         FROM acquisition_session
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (id, session_key_json, state, target_id, frame_ids_json, _created_at) =
        row.ok_or_else(|| format!("session.not_found: {id}"))?;

    let fp = load_fingerprint(pool, &id).await?;
    let sk = parse_session_key(&session_key_json, fp.as_ref());
    let st = parse_session_state(&state);
    // TODO(037): confidence has no column; derive from state.
    let confidence = confidence_from_state(st);
    // TODO(037): optical_train_id -- fingerprint stores name, not UUID.
    let optical_train_id = fp.as_ref().and_then(|f| f.optic_train.clone()).unwrap_or_default();
    let frame_count = count_json_array(&frame_ids_json);
    // TODO(037): total_integration_seconds -- not stored.
    let total_integration_seconds = 0.0_f64;
    // TODO(037): total_size_bytes -- not stored.
    let total_size_bytes = 0_u64;
    // TODO(037): metadata -- not stored as structured provenance rows yet.
    let metadata = HashMap::new();
    let target_ids = target_id.into_iter().collect();
    let project_ids = load_project_ids(pool, &id).await?;
    // TODO(037): warnings -- not stored.
    let warnings = Vec::new();
    // Calibration matches from calibration_assignment (real DB rows).
    let calibration_matches = load_calibration_matches(pool, &id).await?;
    // Audit history from audit_log_entry (real DB rows).
    let history = load_history(pool, &id).await?;
    // TODO(037): framesets -- requires frame-level data (frame_ids join).
    let framesets: Vec<Frameset> = Vec::new();

    Ok(SessionDetail {
        id,
        session_key: sk,
        state: st,
        confidence,
        optical_train_id,
        frame_count,
        total_integration_seconds,
        total_size_bytes,
        metadata,
        target_ids,
        project_ids,
        warnings,
        framesets,
        calibration_matches,
        history,
    })
}

// -- Stub placeholders --------------------------------------------------------

/// Split a session by a given property, producing multiple new sessions.
///
/// # Errors
///
/// Currently returns a `NotImplemented` error.
#[allow(clippy::unused_async)] // will await DB queries when wired
pub async fn split_session(
    _pool: &SqlitePool,
    _session_id: &str,
    _split_property: &str,
) -> Result<Vec<String>, String> {
    Err("session.split: not yet implemented".to_owned())
}

/// Merge multiple sessions into a single combined session.
///
/// # Errors
///
/// Currently returns a `NotImplemented` error.
#[allow(clippy::unused_async)] // will await DB queries when wired
pub async fn merge_sessions(_pool: &SqlitePool, _session_ids: &[String]) -> Result<String, String> {
    Err("session.merge: not yet implemented".to_owned())
}

// -- Private helpers ----------------------------------------------------------

/// Row from `acquisition_fingerprint` for supplementary metadata.
struct Fingerprint {
    gain: Option<f64>,
    filter_name: Option<String>,
    binning: Option<String>,
    optic_train: Option<String>,
    observing_night_date: Option<String>,
}

type FingerprintRow =
    Option<(Option<f64>, Option<String>, Option<String>, Option<String>, Option<String>)>;

async fn load_fingerprint(pool: &SqlitePool, id: &str) -> Result<Option<Fingerprint>, String> {
    let row: FingerprintRow = sqlx::query_as(
        "SELECT gain, filter_name, binning, optic_train, observing_night_date
         FROM acquisition_fingerprint
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(gain, filter_name, binning, optic_train, observing_night_date)| Fingerprint {
        gain,
        filter_name,
        binning,
        optic_train,
        observing_night_date,
    }))
}

/// Parse `SessionKey` from the stored JSON session_key string.
///
/// The JSON object may contain `target`, `filter`, `binning`, `gain`, `night`
/// keys. Missing fields are supplemented from the fingerprint row, then
/// defaulted to empty string when absent from both.
fn parse_session_key(json: &str, fp: Option<&Fingerprint>) -> SessionKey {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);

    let str_field =
        |key: &str| v.get(key).and_then(|x| x.as_str()).map(ToOwned::to_owned).unwrap_or_default();

    let target = str_field("target");
    let filter = v
        .get("filter")
        .and_then(|x| x.as_str())
        .map(ToOwned::to_owned)
        .or_else(|| fp.and_then(|f| f.filter_name.clone()))
        .unwrap_or_default();
    let binning = v
        .get("binning")
        .and_then(|x| x.as_str())
        .map(ToOwned::to_owned)
        .or_else(|| fp.and_then(|f| f.binning.clone()))
        .unwrap_or_default();
    let gain = v
        .get("gain")
        .and_then(|x| x.as_str())
        .map(ToOwned::to_owned)
        .or_else(|| fp.and_then(|f| f.gain).map(|n| n.to_string()))
        .unwrap_or_default();
    let night = v
        .get("night")
        .and_then(|x| x.as_str())
        .map(ToOwned::to_owned)
        .or_else(|| fp.and_then(|f| f.observing_night_date.clone()))
        .unwrap_or_default();

    SessionKey { target, filter, binning, gain, night }
}

/// Map the `state` TEXT column to the `SessionState` enum.
fn parse_session_state(state: &str) -> SessionState {
    match state {
        "confirmed" => SessionState::Confirmed,
        "needs_review" => SessionState::NeedsReview,
        "rejected" => SessionState::Rejected,
        "ignored" => SessionState::Ignored,
        "candidate" => SessionState::Candidate,
        _ => SessionState::Discovered,
    }
}

/// Derive a `ConfidenceLevel` from `SessionState`.
///
/// TODO(037): confidence should be its own column once metadata extraction
/// populates it. Until then we derive a coarse level from state.
fn confidence_from_state(state: SessionState) -> ConfidenceLevel {
    match state {
        SessionState::Confirmed => ConfidenceLevel::Confirmed,
        SessionState::Rejected => ConfidenceLevel::Rejected,
        SessionState::NeedsReview => ConfidenceLevel::Medium,
        SessionState::Candidate => ConfidenceLevel::Low,
        SessionState::Ignored | SessionState::Discovered => ConfidenceLevel::Unknown,
    }
}

/// Count elements in a stored JSON array string; returns 0 on parse failure.
fn count_json_array(json: &str) -> u32 {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.as_array().map(Vec::len))
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

/// Load project ids linked to a session via `project_sources`.
async fn load_project_ids(pool: &SqlitePool, session_id: &str) -> Result<Vec<String>, String> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT project_id FROM project_sources WHERE inventory_session_id = ?")
            .bind(session_id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

/// Load calibration matches for a session from `calibration_assignment`.
async fn load_calibration_matches(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<SessionCalibrationMatch>, String> {
    let rows: Vec<(String, String, f64, String)> = sqlx::query_as(
        "SELECT master_id, calibration_type, confidence, mismatched_dimensions
         FROM calibration_assignment
         WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(rows
        .into_iter()
        .map(|(master_id, calibration_type, score, mismatch_json)| {
            // DB CHECK constrains `calibration_type` to dark/flat/bias; unknown
            // values fall back to Dark, preserving prior behavior.
            let kind = calibration_type.parse().unwrap_or(CalibrationKind::Dark);
            let soft_mismatches: Vec<String> =
                serde_json::from_str(&mismatch_json).unwrap_or_default();
            SessionCalibrationMatch { master_id, kind, score, soft_mismatches }
        })
        .collect())
}

/// Load audit history entries for a session from `audit_log_entry`.
async fn load_history(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<SessionHistoryEntry>, String> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT at, trigger, actor
         FROM audit_log_entry
         WHERE entity_type = 'acquisition_session' AND entity_id = ?
         ORDER BY at ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(rows
        .into_iter()
        .map(|(timestamp, event, actor)| SessionHistoryEntry { timestamp, event, actor })
        .collect())
}

// -- Tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn split_session_returns_not_implemented() {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        let result = split_session(&pool, "ses-001", "filter").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }

    #[tokio::test]
    async fn merge_sessions_returns_not_implemented() {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        let ids = vec!["ses-001".to_owned(), "ses-002".to_owned()];
        let result = merge_sessions(&pool, &ids).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }

    #[test]
    fn parse_session_state_maps_all_known_values() {
        assert!(matches!(parse_session_state("confirmed"), SessionState::Confirmed));
        assert!(matches!(parse_session_state("needs_review"), SessionState::NeedsReview));
        assert!(matches!(parse_session_state("rejected"), SessionState::Rejected));
        assert!(matches!(parse_session_state("ignored"), SessionState::Ignored));
        assert!(matches!(parse_session_state("candidate"), SessionState::Candidate));
        assert!(matches!(parse_session_state("discovered"), SessionState::Discovered));
        assert!(matches!(parse_session_state("unknown_future"), SessionState::Discovered));
    }

    #[test]
    fn count_json_array_handles_edge_cases() {
        assert_eq!(count_json_array("[]"), 0);
        assert_eq!(count_json_array(r#"["a","b"]"#), 2);
        assert_eq!(count_json_array("not json"), 0);
        assert_eq!(count_json_array("{}"), 0);
    }

    #[test]
    fn parse_session_key_falls_back_to_fingerprint() {
        let fp = Fingerprint {
            gain: Some(100.0),
            filter_name: Some("Ha".to_owned()),
            binning: Some("1x1".to_owned()),
            optic_train: Some("FSQ106".to_owned()),
            observing_night_date: Some("2026-06-01".to_owned()),
        };
        let sk = parse_session_key(r#"{"target":"NGC 7000"}"#, Some(&fp));
        assert_eq!(sk.target, "NGC 7000");
        assert_eq!(sk.filter, "Ha");
        assert_eq!(sk.binning, "1x1");
        assert_eq!(sk.gain, "100");
        assert_eq!(sk.night, "2026-06-01");
    }

    #[test]
    fn parse_session_key_prefers_json_over_fingerprint() {
        let fp = Fingerprint {
            gain: Some(200.0),
            filter_name: Some("OIII".to_owned()),
            binning: Some("2x2".to_owned()),
            optic_train: None,
            observing_night_date: Some("2026-05-01".to_owned()),
        };
        let json =
            r#"{"target":"M31","filter":"Ha","binning":"1x1","gain":"100","night":"2026-04-01"}"#;
        let sk = parse_session_key(json, Some(&fp));
        assert_eq!(sk.filter, "Ha");
        assert_eq!(sk.binning, "1x1");
        assert_eq!(sk.gain, "100");
        assert_eq!(sk.night, "2026-04-01");
    }

    #[test]
    fn parse_session_key_handles_invalid_json() {
        let sk = parse_session_key("not-json", None);
        assert_eq!(sk.target, "");
        assert_eq!(sk.filter, "");
    }
}
