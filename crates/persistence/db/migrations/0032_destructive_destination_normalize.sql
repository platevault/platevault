-- Migration 0032: Destructive-destination normalization (spec 033, T017, D1, FR-038).
--
-- Resolves the 0014 (archive/os_trash) ↔ 0019 (trash/archive/none) vocabulary drift.
-- Canonical enum after this migration: archive | trash
--   - os_trash → trash (the `trash` crate / OS recycle bin)
--   - none     → archive (safest re-derivation: keep files safe)
--   - archive  → archive (unchanged)
--
-- Constitution §II: destructive ops must prefer archive/trash over permanent deletion.
-- The canonical vocabulary removes the ambiguous 'none' option.
--
-- Implementation: SQLite does not support DROP CONSTRAINT or ALTER COLUMN.
-- We recreate the plans table with the corrected CHECK constraint, preserving
-- all data with the normalized destination values.

PRAGMA foreign_keys = OFF;

-- Normalize the destructive_destination values in-place before table recreation.
UPDATE plans SET destructive_destination = 'trash'   WHERE destructive_destination = 'os_trash';
UPDATE plans SET destructive_destination = 'archive' WHERE destructive_destination = 'none';

-- Recreate plans with the canonical CHECK constraint.
CREATE TABLE plans_0032 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','source_view','manifest','prepared_view_removal','prepared_view_regeneration')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','source_map','project_create','source_view_removal','source_view_regeneration')),
    -- Canonical destructive-destination: archive | trash only (D1, FR-038).
    -- os_trash and none were normalized in the UPDATE statements above.
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES plans_0032(id),
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
    created_at               TEXT    NOT NULL
);

INSERT INTO plans_0032 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_0032 RENAME TO plans;

-- Restore indices.
CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

PRAGMA foreign_keys = ON;
