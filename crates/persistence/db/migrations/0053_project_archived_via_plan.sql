-- Migration 0053: Spec 017 C5 archive support.
--
-- Two changes:
--   1. Record which archive plan drove a project into the `archived` lifecycle
--      state (`projects.archived_via_plan_id`) so the archive-management
--      operations (archive.send_to_trash / archive.permanently_delete) can act
--      on the owning plan in O(1). NULL for non-archived / legacy rows.
--   2. Re-add `'archive'` to the `plans.origin` CHECK constraint. The 0040
--      rebuild dropped it, but the whole-project archive generator (WP-B) needs
--      `origin = 'archive'` so archive plans are filterable (FR-010) and the
--      apply-path lifecycle closure can recognise them. `plan_type = 'archive'`
--      was already permitted.
--
-- SQLite has no DROP CONSTRAINT / ALTER COLUMN, so the CHECK change requires a
-- table rebuild (mirrors migration 0040).

-- 1. Project → archiving-plan link.
ALTER TABLE projects ADD COLUMN archived_via_plan_id TEXT;

-- 2. plans.origin CHECK: add 'archive'.
PRAGMA foreign_keys = OFF;

CREATE TABLE plans_0053 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','archive','source_view','manifest','prepared_view_removal','prepared_view_regeneration')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','source_map','project_create','source_view_removal','source_view_regeneration')),
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES plans_0053(id),
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

INSERT INTO plans_0053 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_0053 RENAME TO plans;

CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

PRAGMA foreign_keys = ON;
