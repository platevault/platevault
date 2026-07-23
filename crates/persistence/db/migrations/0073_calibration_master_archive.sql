-- Migration 0073: #886 calibration master archive (reviewable fs-plan, not a
-- DB-only flag — decisions.md explicitly rejected the DB-only design).
--
-- Mirrors migration 0071's `plans` CHECK rebuild pattern to admit the new
-- `calibration_master_archive`/`calibration_master_restore` origin+plan_type
-- pair, and adds a plain archived_at/archived_via_plan_id column pair on
-- `calibration_session` — the master-equivalent of `project.archived_at` /
-- `project.archived_via_plan_id` (migration 0033-era), but WITHOUT a
-- lifecycle-transition state machine: masters have no lifecycle column
-- (migration 0050 dropped `calibration_session.state`), so archiving a
-- master is a plain flag+link set by the plan-apply finalize step
-- (crate::calibration_archive_generator), never by direct UI action —
-- reviewable-plan discipline is enforced by that call site, not by a schema
-- constraint here.

PRAGMA foreign_keys = OFF;

CREATE TABLE plans_0073 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','archive','restore','source_view','manifest','prepared_view_removal','prepared_view_regeneration','prepared_view_generation','calibration_master_archive','calibration_master_restore')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','restore','source_map','project_create','source_view_removal','source_view_regeneration','source_view_generation','calibration_master_archive','calibration_master_restore')),
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES plans_0073(id),
    items_total              INTEGER NOT NULL DEFAULT 0,
    items_applied            INTEGER NOT NULL DEFAULT 0,
    items_failed             INTEGER NOT NULL DEFAULT 0,
    items_skipped            INTEGER NOT NULL DEFAULT 0,
    items_cancelled          INTEGER NOT NULL DEFAULT 0,
    items_pending            INTEGER NOT NULL DEFAULT 0,
    total_bytes_required     INTEGER NOT NULL DEFAULT 0,
    approval_token           TEXT,
    approved_at              TEXT,
    discarded_at             TEXT,
    created_at               TEXT    NOT NULL,
    chosen_framing_id        TEXT    REFERENCES framing(id)
);

INSERT INTO plans_0073 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_0073 RENAME TO plans;

CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

PRAGMA foreign_keys = ON;

ALTER TABLE calibration_session ADD COLUMN archived_at TEXT;
ALTER TABLE calibration_session ADD COLUMN archived_via_plan_id TEXT;

-- Extend migration 0072's view with the new columns for the same reasons.
DROP VIEW IF EXISTS calibration_master_view;

CREATE VIEW calibration_master_view AS
SELECT
    cs.id                                               AS id,
    cs.kind                                             AS kind,
    COALESCE(cf.calibration_type, cs.kind)              AS calibration_type,
    cs.created_at                                       AS created_at,
    CAST(NULL AS INTEGER)                               AS size_bytes,
    cf.gain                                             AS fp_gain,
    cf.offset_val                                       AS fp_offset_val,
    cf.exposure_s                                       AS fp_exposure_s,
    cf.temp_c                                           AS fp_temp_c,
    cf.filter_name                                      AS fp_filter_name,
    cf.rotation_deg                                     AS fp_rotation_deg,
    cf.binning                                          AS fp_binning,
    cf.optic_train                                      AS fp_optic_train,
    cf.source_session_id                                AS source_session_id,
    cf.observing_night_date                             AS observing_night_date,
    cs.root_id                                          AS root_id,
    fr.relative_path                                    AS frame_relative_path,
    cs.archived_at                                      AS archived_at,
    cs.archived_via_plan_id                             AS archived_via_plan_id
FROM calibration_session cs
LEFT JOIN calibration_fingerprint cf ON cf.id = cs.id
LEFT JOIN file_record fr ON fr.id = json_extract(cs.frame_ids, '$[0]')
WHERE cs.kind IN ('dark', 'flat', 'bias');
