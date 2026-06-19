#![allow(clippy::doc_markdown)]
//! Layer-1 integration tests for calibration matching & masters — feature 037 (T005 coverage area #5).
//!
//! Tests use the shared harness (`support::setup`) which provides a real in-memory
//! SQLite DB with all migrations applied. No mocks; all assertions are against
//! persisted state read back from the database.
//!
//! Coverage:
//! - `suggest`: session+fingerprint seeded → candidates returned.
//! - `suggest`: session without fingerprint → observer_location_missing guard fires.
//! - `assign`: happy-path → assignment persists and audit event emitted.
//! - `batch_suggest`: two sessions, one with matching master → results per session.

mod support;

use app_core::calibration::{assign, batch_suggest, suggest};
use contracts_core::calibration_match::{
    CalibrationMatchAssignRequest, CalibrationMatchBatchRequest, CalibrationMatchSuggestRequest,
    CalibrationType, SuggestStatus, ASSIGN_CONTRACT_VERSION, BATCH_CONTRACT_VERSION,
    SUGGEST_CONTRACT_VERSION,
};
use uuid::Uuid;

// ── Seed helpers ──────────────────────────────────────────────────────────────

/// Insert a minimal `acquisition_session` row.
async fn insert_acq_session(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO acquisition_session \
         (id, session_key, frame_ids, state, created_at) \
         VALUES (?, ?, '[]', 'confirmed', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("key-{id}"))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert acquisition_session failed: {e}"));
}

/// Insert an `acquisition_fingerprint` row with observer-location flags set so
/// the A6 guard passes. Both `gain` and `offset_val` are hard-rule dimensions
/// for dark matching and must be supplied to produce candidates.
async fn insert_acq_fingerprint(
    pool: &sqlx::SqlitePool,
    session_id: &str,
    gain: f64,
    offset: f64,
    temp_c: f64,
    binning: &str,
) {
    sqlx::query(
        "INSERT INTO acquisition_fingerprint \
         (id, session_type, gain, offset_val, temp_c, binning, \
          has_observer_location, has_exposure_start_utc, \
          observing_night_date) \
         VALUES (?, 'light', ?, ?, ?, ?, 1, 1, '2026-05-01')",
    )
    .bind(session_id)
    .bind(gain)
    .bind(offset)
    .bind(temp_c)
    .bind(binning)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert acquisition_fingerprint failed: {e}"));
}

/// Insert a minimal `calibration_session` row (required FK for `calibration_fingerprint`).
async fn insert_cal_session(pool: &sqlx::SqlitePool, id: &str, kind: &str) {
    sqlx::query(
        "INSERT INTO calibration_session \
         (id, session_key, frame_ids, kind, state, created_at) \
         VALUES (?, ?, '[]', ?, 'confirmed', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("calkey-{id}"))
    .bind(kind)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert calibration_session failed: {e}"));
}

/// Insert a `calibration_fingerprint` (master) row. `offset_val` is a hard
/// rule dimension alongside `gain`; both must match the session exactly.
async fn insert_cal_fingerprint(
    pool: &sqlx::SqlitePool,
    id: &str,
    kind: &str,
    gain: f64,
    offset: f64,
    temp_c: f64,
    binning: &str,
) {
    sqlx::query(
        "INSERT INTO calibration_fingerprint \
         (id, calibration_type, gain, offset_val, temp_c, binning) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(kind)
    .bind(gain)
    .bind(offset)
    .bind(temp_c)
    .bind(binning)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("insert calibration_fingerprint failed: {e}"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Seeding a light session + matching dark master returns candidates via `suggest`.
#[tokio::test]
async fn suggest_returns_candidates_when_master_matches() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let session_id = Uuid::new_v4().to_string();
    let master_id = Uuid::new_v4().to_string();

    // Seed light session with a fingerprint (gain=100, offset=10, temp=-10, binning=1x1).
    insert_acq_session(pool, &session_id).await;
    insert_acq_fingerprint(pool, &session_id, 100.0, 10.0, -10.0, "1x1").await;

    // Seed a matching dark master with identical hard-rule dimensions.
    insert_cal_session(pool, &master_id, "dark").await;
    insert_cal_fingerprint(pool, &master_id, "dark", 100.0, 10.0, -10.0, "1x1").await;

    let req = CalibrationMatchSuggestRequest {
        contract_version: SUGGEST_CONTRACT_VERSION.to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        calibration_types: Some(vec![CalibrationType::Dark]),
    };

    let resp = suggest(pool, req).await.expect("suggest should not return Err");

    assert_eq!(resp.status, "success", "expected success, got: {:?}", resp.error);
    let matches = resp.matches.expect("expected Some(matches)");
    assert!(!matches.is_empty(), "expected at least one candidate match");

    // The top candidate should reference our master.
    assert!(
        matches.iter().any(|m| m.master_id == master_id),
        "expected master_id={master_id} in candidates, got: {matches:?}",
    );

    // suggest_status should be Match or Ambiguous (not NoMatch).
    let status = resp.suggest_status.expect("expected Some(suggest_status)");
    assert!(
        matches!(status, SuggestStatus::Match | SuggestStatus::Ambiguous),
        "expected Match or Ambiguous, got {status:?}",
    );
}

/// Session with no fingerprint row (no observer location) triggers the A6 guard.
#[tokio::test]
async fn suggest_returns_observer_location_missing_when_no_fingerprint() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let session_id = Uuid::new_v4().to_string();

    // Seed the session but intentionally omit the fingerprint row so that
    // has_observer_location defaults to false → A6 guard fires.
    insert_acq_session(pool, &session_id).await;

    let req = CalibrationMatchSuggestRequest {
        contract_version: SUGGEST_CONTRACT_VERSION.to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        calibration_types: None,
    };

    let resp = suggest(pool, req).await.expect("suggest should not return Err");

    assert_eq!(resp.status, "error", "expected error status, got {}", resp.status);

    // The guard code `match.observer_location_missing` maps to
    // SuggestStatus::ObserverLocationMissing.
    let status = resp.suggest_status;
    assert!(
        matches!(status, Some(SuggestStatus::ObserverLocationMissing)),
        "expected ObserverLocationMissing, got {status:?}",
    );
}

/// Happy-path `assign`: persists the assignment row and emits an audit event.
#[tokio::test]
async fn assign_persists_assignment_and_emits_audit_event() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    let session_id = Uuid::new_v4().to_string();
    let master_id = Uuid::new_v4().to_string();

    // Seed matching light session + dark master (all hard-rule dimensions identical).
    insert_acq_session(pool, &session_id).await;
    insert_acq_fingerprint(pool, &session_id, 200.0, 20.0, -15.0, "2x2").await;
    insert_cal_session(pool, &master_id, "dark").await;
    insert_cal_fingerprint(pool, &master_id, "dark", 200.0, 20.0, -15.0, "2x2").await;

    let req = CalibrationMatchAssignRequest {
        contract_version: ASSIGN_CONTRACT_VERSION.to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        master_id: master_id.clone(),
        r#override: false,
    };

    let resp = assign(pool, &bus, req).await.expect("assign should not return Err");

    assert_eq!(resp.status, "success", "expected success, got: {:?}", resp.error);

    let assigned = resp.assigned.expect("expected Some(assigned)");
    assert_eq!(assigned.session_id, session_id);
    assert_eq!(assigned.master_id, master_id);
    assert!(!assigned.assignment_id.is_empty(), "assignment_id must be non-empty");

    // Verify the row was actually written to SQLite.
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM calibration_assignment \
         WHERE session_id = ? AND master_id = ? AND calibration_type = 'dark'",
    )
    .bind(&session_id)
    .bind(&master_id)
    .fetch_one(pool)
    .await
    .expect("calibration_assignment query failed");

    assert_eq!(count, 1, "expected 1 persisted assignment row, found {count}");

    // Verify an audit event was recorded for this assignment.
    // EventBus::publish writes to the `events` table (migration 0003) with
    // column `topic`, not `audit_log_entry`.
    let (audit_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM events \
         WHERE topic = 'calibration.assignment.created'",
    )
    .fetch_one(pool)
    .await
    .expect("events query failed");

    assert_eq!(audit_count, 1, "expected 1 audit event for assignment, found {audit_count}");
}

/// `batch_suggest` across two sessions: one with a matching master, one unknown.
#[tokio::test]
async fn batch_suggest_returns_results_and_errors_per_session() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let session_a = Uuid::new_v4().to_string();
    let master_id = Uuid::new_v4().to_string();
    let missing_session = Uuid::new_v4().to_string(); // never inserted → not_found

    // Session A has a fingerprint + a matching bias master.
    insert_acq_session(pool, &session_a).await;
    insert_acq_fingerprint(pool, &session_a, 50.0, 5.0, -5.0, "1x1").await;
    insert_cal_session(pool, &master_id, "bias").await;
    insert_cal_fingerprint(pool, &master_id, "bias", 50.0, 5.0, -5.0, "1x1").await;

    let req = CalibrationMatchBatchRequest {
        contract_version: BATCH_CONTRACT_VERSION.to_owned(),
        request_id: Uuid::new_v4().to_string(),
        session_ids: vec![session_a.clone(), missing_session.clone()],
        calibration_types: Some(vec![CalibrationType::Bias]),
    };

    let resp = batch_suggest(pool, req).await.expect("batch_suggest should not return Err");

    // Top-level status: partial (results for A + error for missing session).
    assert_eq!(resp.status, "partial", "expected partial (results + errors), got {}", resp.status);

    // Session A should appear in results.
    let results = resp.results.expect("expected Some(results)");
    assert!(
        results.iter().any(|r| r.session_id == session_a),
        "expected session_a in results, got {results:?}",
    );

    // Missing session should appear in errors with session.not_found.
    let errors = resp.errors.expect("expected Some(errors)");
    assert!(
        errors.iter().any(|e| e.session_id.as_deref() == Some(&missing_session)),
        "expected missing_session in errors, got {errors:?}",
    );
    assert!(
        errors.iter().any(|e| e.code == "session.not_found"),
        "expected session.not_found error code, got {errors:?}",
    );
}
