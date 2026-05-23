-- T047 — immutable session snapshot (FR-005).
--
-- One row per transition into or out of a review-significant state
-- (`confirmed`, `rejected`, `needs_review`). The `context_json` column
-- freezes the contributing observed / inferred / reviewed values so
-- the review snapshot can be audited later even after the source
-- session's mutable fields drift.

CREATE TABLE IF NOT EXISTS session_snapshot (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    session_kind    TEXT NOT NULL CHECK(session_kind IN ('acquisition', 'calibration')),
    transition_from TEXT NOT NULL,
    transition_to   TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    audit_id        TEXT NOT NULL,
    context_json    TEXT NOT NULL,
    FOREIGN KEY (audit_id) REFERENCES audit_log_entry(audit_id)
);

CREATE INDEX IF NOT EXISTS idx_session_snapshot_session
    ON session_snapshot(session_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_snapshot_audit
    ON session_snapshot(audit_id);
