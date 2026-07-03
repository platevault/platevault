-- Migration 0050: drop the session review lifecycle (spec 041 T076, FR-051,
-- Phase 13, US14).
--
-- data-model.md "Sessions — lifecycle drop (E)" (R-16): acquisition and
-- calibration sessions become derived, already-confirmed inventory — like
-- calibration masters. This migration removes the review-state columns and
-- their supporting indices from both session tables:
--
--   * `state`              — the discovered/candidate/needs_review/confirmed/
--                             rejected/ignored review state (migration 0002).
--   * `review_snapshot_id` — unused review-snapshot pointer (migration 0002;
--                             never read or written anywhere in the codebase).
--   * `last_action`        — unused `{label, at, actor}` JSON blob tracking the
--                             last Confirm/Re-open/Reject action (migration
--                             0002; never read or written anywhere in the
--                             codebase).
--
-- Session metadata (session_key, frame_ids, target_id, canonical_target_id,
-- observer_location, root_id, etc.) is untouched and remains editable
-- post-hoc via the inbox per-file metadata/override tables — FR-051 only
-- removes the review gate, not the metadata.
--
-- Uses `ALTER TABLE ... DROP COLUMN` (SQLite 3.35.0+, bundled by this
-- project's libsqlite3-sys) rather than the rename → create → copy → drop
-- pattern used by migrations 0011/0036: `acquisition_fingerprint.id` and
-- `calibration_fingerprint.id` (migration 0023) and
-- `calibration_master.source_session_id` (migration 0002) hold a FK to
-- these tables. SQLite 3.25+ auto-rewrites *other* tables' `REFERENCES`
-- clauses when a table is renamed, so a rename-based rebuild would silently
-- repoint those FKs at the temporary `_pre0050` name and orphan them once it
-- is dropped. `DROP COLUMN` never renames the table, so this hazard does not
-- apply.
--
-- `DROP COLUMN` requires the column to be un-indexed, so the `state`
-- indices are dropped first.
--
-- `ledger_view` (migration 0004, recreated by 0011/0036) UNIONs
-- `acquisition_session`/`calibration_session` reading their `state` column;
-- since neither table has a review-transitionable state anymore, both
-- branches are dropped from the view and the view is recreated without them.

DROP VIEW IF EXISTS ledger_view;

-- ── acquisition_session ──────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_acq_session_state;
DROP INDEX IF EXISTS idx_acq_session_root_state;

ALTER TABLE acquisition_session DROP COLUMN state;
ALTER TABLE acquisition_session DROP COLUMN review_snapshot_id;
ALTER TABLE acquisition_session DROP COLUMN last_action;

-- ── calibration_session ──────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_cal_session_state;

ALTER TABLE calibration_session DROP COLUMN state;
ALTER TABLE calibration_session DROP COLUMN review_snapshot_id;
ALTER TABLE calibration_session DROP COLUMN last_action;

-- ── Recreate ledger_view without the acquisition_session/calibration_session
--    branches (migration 0036 shape, minus those two SELECTs) ────────────────

CREATE VIEW ledger_view AS
SELECT
    'file_record'      AS entity_type,
    id                 AS entity_id,
    state              AS state,
    NULL               AS title,
    relative_path      AS path,
    NULL               AS project_id,
    last_seen_at       AS updated_at
FROM file_record
UNION ALL
SELECT
    'project',
    id,
    lifecycle,
    name,
    NULL,
    id,
    updated_at
FROM projects
UNION ALL
SELECT
    'filesystem_plan',
    id,
    state,
    NULL,
    NULL,
    NULL,
    COALESCE(applied_at, created_at)
FROM filesystem_plan
UNION ALL
SELECT
    'processing_artifact',
    id,
    staleness,
    NULL,
    NULL,
    project_id,
    created_at
FROM processing_artifact
UNION ALL
SELECT
    'prepared_source',
    id,
    state,
    NULL,
    NULL,
    project_id,
    created_at
FROM prepared_source_view
UNION ALL
SELECT
    'data_source',
    id,
    state,
    label,
    current_path,
    NULL,
    COALESCE(last_seen_at, created_at)
FROM library_root;
