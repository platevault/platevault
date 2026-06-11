-- Migration 0023: calibration fingerprint metadata (spec 007 T009).
--
-- calibration_fingerprint: extracted metadata for calibration master sessions,
-- used as the right-hand side of matching rules. One row per calibration_session.
--
-- acquisition_fingerprint: extracted metadata for light sessions (anchors),
-- used as the left-hand side of matching. One row per acquisition_session.
--
-- Both tables store optional float/text fields because header metadata may be
-- missing or partially available. Missing hard-rule dimensions cause exclusion
-- from suggestion; missing soft dimensions reduce confidence.

-- Fingerprint for a calibration master (right-hand side of matching).
CREATE TABLE IF NOT EXISTS calibration_fingerprint (
    id                    TEXT PRIMARY KEY NOT NULL REFERENCES calibration_session(id),
    calibration_type      TEXT NOT NULL CHECK (calibration_type IN ('dark', 'flat', 'bias')),
    gain                  REAL,
    offset_val            REAL,
    exposure_s            REAL,
    temp_c                REAL,
    filter_name           TEXT,
    rotation_deg          REAL,
    binning               TEXT,
    optic_train           TEXT,
    source_session_id     TEXT,   -- originating capture session (for same_session reason)
    observing_night_date  TEXT    -- YYYY-MM-DD local observing night
);

CREATE INDEX IF NOT EXISTS idx_cal_fingerprint_type
    ON calibration_fingerprint (calibration_type);

-- Fingerprint for a light session (left-hand side / anchor of matching).
CREATE TABLE IF NOT EXISTS acquisition_fingerprint (
    id                    TEXT PRIMARY KEY NOT NULL REFERENCES acquisition_session(id),
    session_type          TEXT NOT NULL DEFAULT 'light',
    gain                  REAL,
    offset_val            REAL,
    exposure_s            REAL,
    temp_c                REAL,
    filter_name           TEXT,
    rotation_deg          REAL,
    binning               TEXT,
    optic_train           TEXT,
    observing_night_date  TEXT,   -- YYYY-MM-DD local observing night
    has_observer_location INTEGER NOT NULL DEFAULT 0,
    has_exposure_start_utc INTEGER NOT NULL DEFAULT 0
);
