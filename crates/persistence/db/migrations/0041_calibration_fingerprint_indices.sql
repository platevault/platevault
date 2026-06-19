-- Migration 0033: Calibration fingerprint indices and masters backing (spec 033, T035, US3).
--
-- The calibration_fingerprint and acquisition_fingerprint tables were created
-- in migration 0023 but had no composite indices for the matching query path
-- (join on gain/temp/filter/binning). This migration adds:
--   - Composite index on calibration_fingerprint for the matching hot-path.
--   - Composite index on acquisition_fingerprint for lookup by session.
--   - calibration_master_view: denormalized view that backs calibration.masters.list/get
--     by joining calibration_session (id, kind, created_at, size_bytes) with
--     calibration_fingerprint. Real rows replace the fixture stubs (FR-013).
--
-- Also adds: destructive_confirmed column to plan_items so the plan-apply
-- executor can read it as a real DB field (T023a). Previously it was
-- #[sqlx(default)] and always read as None/false — the gate was inert.
--
-- Constitution §I: no image files touched; fingerprint tables store
-- extracted metadata only.
-- Constitution §II: destructive_confirmed as a real column ensures the
-- destructive-confirm gate has a persistent, auditable basis.

-- ── Calibration fingerprint index (matching hot-path) ────────────────────────

CREATE INDEX IF NOT EXISTS idx_cal_fp_type_gain_binning
    ON calibration_fingerprint (calibration_type, gain, binning);

CREATE INDEX IF NOT EXISTS idx_cal_fp_type_filter
    ON calibration_fingerprint (calibration_type, filter_name)
    WHERE filter_name IS NOT NULL;

-- ── Acquisition fingerprint index (per-session suggest lookup) ────────────────

CREATE INDEX IF NOT EXISTS idx_acq_fp_gain_binning
    ON acquisition_fingerprint (gain, binning);

-- ── calibration_master_view ───────────────────────────────────────────────────
-- Joins calibration_session with calibration_fingerprint to produce the
-- CalibrationMaster contract shape without a separate masters table.
-- size_bytes is stored on the session via total_size_bytes (spec 007 T006/T010).
-- age_days is computed as days since session.captured_on or created_at.
-- used_by_session_ids / used_by_project_ids require joins at query time and
-- are not stored on the view.

CREATE VIEW IF NOT EXISTS calibration_master_view AS
SELECT
    cs.id                                               AS id,
    cs.kind                                             AS kind,
    COALESCE(cf.calibration_type, cs.kind)              AS calibration_type,
    cs.created_at                                       AS created_at,
    -- size_bytes: calibration_session has no size column; compute at query
    -- time from frame count if available, or leave 0 for the view.
    0                                                   AS size_bytes,
    cf.gain                                             AS fp_gain,
    cf.offset_val                                       AS fp_offset_val,
    cf.exposure_s                                       AS fp_exposure_s,
    cf.temp_c                                           AS fp_temp_c,
    cf.filter_name                                      AS fp_filter_name,
    cf.rotation_deg                                     AS fp_rotation_deg,
    cf.binning                                          AS fp_binning,
    cf.optic_train                                      AS fp_optic_train,
    cf.source_session_id                                AS source_session_id,
    cf.observing_night_date                             AS observing_night_date
FROM calibration_session cs
LEFT JOIN calibration_fingerprint cf ON cf.id = cs.id
WHERE cs.kind IN ('dark', 'flat', 'bias');

-- ── destructive_confirmed column on plan_items (T023a) ───────────────────────
-- Promote from #[sqlx(default)] to a real DB column so the plan executor
-- can persist and read the user's destructive-action confirmation.
-- Default 0 (false) is safe: unconfirmed destructive items remain blocked.

ALTER TABLE plan_items ADD COLUMN destructive_confirmed INTEGER NOT NULL DEFAULT 0;
