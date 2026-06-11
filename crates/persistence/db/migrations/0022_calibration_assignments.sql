-- Migration 0022: calibration assignment records (spec 007 T009/T026).
--
-- calibration_assignment: persisted result of calibration.match.assign.
--   - (session_id, calibration_type) is unique (data-model invariant 4).
--   - mismatched_dimensions stored as JSON array of dimension name strings.
--   - was_override records whether the user bypassed hard-rule checks.

CREATE TABLE IF NOT EXISTS calibration_assignment (
    id                    TEXT PRIMARY KEY NOT NULL,
    session_id            TEXT NOT NULL,
    calibration_type      TEXT NOT NULL CHECK (calibration_type IN ('dark', 'flat', 'bias')),
    master_id             TEXT NOT NULL,
    confidence            REAL NOT NULL,
    was_override          INTEGER NOT NULL DEFAULT 0,  -- 0=false, 1=true
    mismatched_dimensions TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
    assigned_at           TEXT NOT NULL,               -- ISO-8601 UTC

    UNIQUE (session_id, calibration_type)
);

-- Index for per-session lookups (project-level calibration summary).
CREATE INDEX IF NOT EXISTS idx_cal_assignment_session
    ON calibration_assignment (session_id);
