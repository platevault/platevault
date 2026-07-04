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
//! target_id, observer_location (JSON), created_at.
//! `acquisition_fingerprint` stores per-session metadata dimensions for
//! calibration matching (gain, filter, binning, optic_train, etc.).
//!
//! Many contract DTO fields (confidence, total_integration_seconds, total_size_bytes,
//! metadata, warnings, framesets) have no column yet; defaulted with
//! `// TODO(037):` markers until later columns/views are built.
//!
//! Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
//! inventory — the `state` column (and the review lifecycle it backed) was
//! removed. `confidence` is now a constant `Confirmed` rather than derived
//! from a review state.
//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b) as a pure
//! leaf: it has zero `crate::` references and nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::sessions` so the
//! public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use contracts_core::calibration::CalibrationKind;
use contracts_core::sessions::{
    AcquisitionSession, ConfidenceLevel, Frameset, SessionCalibrationMatch, SessionDetail,
    SessionHistoryEntry, SessionKey,
};
use sqlx::SqlitePool;
use std::collections::HashMap;

/// One `acquisition_session` row joined with its canonical target (spec 035
/// US4/T044). Columns: id, session_key, legacy target_id, frame_ids (JSON),
/// created_at, canonical_target_id, canonical primary designation.
type SessionRow = (String, String, Option<String>, String, String, Option<String>, Option<String>);

// -- Public use-case functions ------------------------------------------------

/// `sessions.list` -- return all acquisition sessions from real DB rows.
///
/// Queries `acquisition_session` and joins `acquisition_fingerprint` for
/// supplementary metadata dimensions. Sessions are ordered by `created_at DESC`.
///
/// # Errors
/// Returns `Err(String)` on database failure.
pub async fn list_sessions(pool: &SqlitePool) -> Result<Vec<AcquisitionSession>, String> {
    // spec 035 US4/T044: LEFT JOIN the spec-035 canonical_target so a session's
    // resolved target name (`primary_designation`) surfaces in the read path.
    // `canonical_target_id` (migration 0046) is the spec-035 link; it coexists
    // with the legacy `target_id` (→ old `target` table, left NULL by ingest).
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT s.id, s.session_key, s.target_id, s.frame_ids, s.created_at,
                s.canonical_target_id, ct.primary_designation
         FROM acquisition_session s
         LEFT JOIN canonical_target ct ON ct.id = s.canonical_target_id
         ORDER BY s.created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut sessions = Vec::with_capacity(rows.len());
    for (
        id,
        session_key_json,
        target_id,
        frame_ids_json,
        _created_at,
        canonical_target_id,
        canonical_name,
    ) in rows
    {
        let fp = load_fingerprint(pool, &id).await?;
        let mut sk = parse_session_key(&session_key_json, fp.as_ref());
        // Prefer the canonical target's display designation when linked.
        if let Some(name) = canonical_name.filter(|n| !n.is_empty()) {
            sk.target = name;
        }
        // Spec 041 FR-051: sessions are derived, already-confirmed inventory —
        // there is no review state left to derive a confidence level from.
        let confidence = ConfidenceLevel::Confirmed;
        // TODO(037): optical_train_id -- fingerprint stores name, not UUID.
        let optical_train_id = fp.as_ref().and_then(|f| f.optic_train.clone()).unwrap_or_default();
        // spec 048 US1: frame_count/total_size_bytes are the ACTIVE (non-missing)
        // file_record members — honest counts/totals, not the raw array length
        // (which may retain `missing` ids in flag-missing mode).
        let (frame_count, total_size_bytes) = active_frame_summary(pool, &frame_ids_json).await?;
        // TODO(037): total_integration_seconds -- not stored; requires frame-level data.
        let total_integration_seconds = 0.0_f64;
        // TODO(037): metadata -- not stored as structured provenance rows yet.
        let metadata = HashMap::new();
        // Surface the canonical target id (spec 035) when the legacy target_id is
        // absent — ingested sessions link via canonical_target_id (R10).
        let target_ids = target_id.or(canonical_target_id).into_iter().collect();
        let project_ids = load_project_ids(pool, &id).await?;
        // TODO(037): warnings -- not stored; derive from fingerprint in future.
        let warnings = Vec::new();
        sessions.push(AcquisitionSession {
            id,
            session_key: sk,
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
    let row: Option<SessionRow> = sqlx::query_as(
        "SELECT s.id, s.session_key, s.target_id, s.frame_ids, s.created_at,
                s.canonical_target_id, ct.primary_designation
         FROM acquisition_session s
         LEFT JOIN canonical_target ct ON ct.id = s.canonical_target_id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (
        id,
        session_key_json,
        target_id,
        frame_ids_json,
        _created_at,
        canonical_target_id,
        canonical_name,
    ) = row.ok_or_else(|| format!("session.not_found: {id}"))?;

    let fp = load_fingerprint(pool, &id).await?;
    let mut sk = parse_session_key(&session_key_json, fp.as_ref());
    if let Some(name) = canonical_name.filter(|n| !n.is_empty()) {
        sk.target = name;
    }
    // Spec 041 FR-051: sessions are derived, already-confirmed inventory —
    // there is no review state left to derive a confidence level from.
    let confidence = ConfidenceLevel::Confirmed;
    // TODO(037): optical_train_id -- fingerprint stores name, not UUID.
    let optical_train_id = fp.as_ref().and_then(|f| f.optic_train.clone()).unwrap_or_default();
    // spec 048 US1: active (non-missing) frame_count/total_size_bytes.
    let (frame_count, total_size_bytes) = active_frame_summary(pool, &frame_ids_json).await?;
    // TODO(037): total_integration_seconds -- not stored.
    let total_integration_seconds = 0.0_f64;
    // TODO(037): metadata -- not stored as structured provenance rows yet.
    let metadata = HashMap::new();
    let target_ids = target_id.or(canonical_target_id).into_iter().collect();
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

/// Active `(frame_count, total_size_bytes)` for a session's `frame_ids` JSON
/// array (spec 048 US1, INV-5): only `file_record` rows whose `state !=
/// 'missing'` count toward membership/totals. A `frame_ids` entry with no
/// matching `file_record` (never written, or a future hard-delete) is simply
/// excluded rather than erroring — sessions must never fail to load.
///
/// # Errors
///
/// Returns `Err(String)` on database failure.
async fn active_frame_summary(
    pool: &SqlitePool,
    frame_ids_json: &str,
) -> Result<(u32, u64), String> {
    let ids: Vec<String> = serde_json::from_str(frame_ids_json).unwrap_or_default();
    if ids.is_empty() {
        return Ok((0, 0));
    }
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM file_record WHERE state != 'missing' AND id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in &ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");
    let (count, total): (i64, i64) =
        builder.build_query_as().fetch_one(pool).await.map_err(|e| e.to_string())?;
    Ok((u32::try_from(count.max(0)).unwrap_or(0), u64::try_from(total.max(0)).unwrap_or(0)))
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
