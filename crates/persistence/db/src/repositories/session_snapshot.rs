//! T047 — immutable session snapshot writer (FR-005).
//!
//! Fired on every transition into or out of `confirmed`, `rejected`, or
//! `needs_review` for `AcquisitionSession` / `CalibrationSession`. Stores a
//! JSON-encoded frozen context (provenance, target binding, frame count, etc.)
//! against the audit row that drove the transition so reviewers can compare
//! current state to "what we knew when we approved this".

use serde_json::Value;
use sqlx::types::Json;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::DbResult;

/// Two session families share this writer (data-model.md §AcquisitionSession +
/// §CalibrationSession lifecycle is identical).
#[derive(Clone, Copy, Debug)]
pub enum SessionKind {
    Acquisition,
    Calibration,
}

impl SessionKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Acquisition => "acquisition",
            Self::Calibration => "calibration",
        }
    }
}

/// Set of session states whose entry or exit triggers a snapshot per FR-005.
#[must_use]
pub fn should_snapshot(state: &str) -> bool {
    matches!(state, "confirmed" | "rejected" | "needs_review")
}

/// Write a snapshot row keyed against the audit entry that drove the transition.
///
/// `context` should be the frozen provenance/state object the reviewer saw at
/// transition time. Callers compose it from the entity row + provenance
/// hydration.
///
/// # Errors
/// Returns [`DbError::Database`] on insert failure, including JSON encoding
/// of `context` (encoded via `sqlx::types::Json`).
pub async fn write_session_snapshot(
    pool: &SqlitePool,
    session_id: &str,
    kind: SessionKind,
    transition_from: &str,
    transition_to: &str,
    captured_at: &str,
    audit_id: &str,
    context: &Value,
) -> DbResult<String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO session_snapshot \
         (id, session_id, session_kind, transition_from, transition_to, captured_at, audit_id, context_json) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(session_id)
    .bind(kind.as_str())
    .bind(transition_from)
    .bind(transition_to)
    .bind(captured_at)
    .bind(audit_id)
    .bind(Json(context))
    .execute(pool)
    .await?;
    Ok(id)
}

/// Read the latest snapshot for the given session, newest first.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn latest_snapshot(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<SessionSnapshotRow>> {
    let row: Option<(String, String, String, String, String, String, String, String)> =
        sqlx::query_as(
            "SELECT id, session_id, session_kind, transition_from, transition_to, captured_at, audit_id, context_json \
             FROM session_snapshot WHERE session_id = ? ORDER BY captured_at DESC LIMIT 1",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(
        |(
            id,
            session_id,
            session_kind,
            transition_from,
            transition_to,
            captured_at,
            audit_id,
            context_json,
        )| SessionSnapshotRow {
            id,
            session_id,
            session_kind,
            transition_from,
            transition_to,
            captured_at,
            audit_id,
            context_json,
        },
    ))
}

/// Decoded `session_snapshot` row.
#[derive(Clone, Debug)]
pub struct SessionSnapshotRow {
    pub id: String,
    pub session_id: String,
    pub session_kind: String,
    pub transition_from: String,
    pub transition_to: String,
    pub captured_at: String,
    pub audit_id: String,
    pub context_json: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_trigger_states() {
        for s in ["confirmed", "rejected", "needs_review"] {
            assert!(should_snapshot(s), "{s} must trigger snapshot");
        }
        for s in ["discovered", "candidate", "ignored"] {
            assert!(!should_snapshot(s), "{s} must NOT trigger snapshot");
        }
    }
}
