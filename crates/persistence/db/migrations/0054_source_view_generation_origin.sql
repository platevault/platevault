-- Migration 0054: Spec 049 source view generation plan origin.
--
-- Adds the distinct `prepared_view_generation` plan origin and
-- `source_view_generation` plan type for first-materialization of a project
-- source view, separate from spec 026's `prepared_view_regeneration` /
-- `source_view_regeneration` (regeneration-after-removal). This lets
-- generation be routed and audited distinctly from regeneration (FR-021a).
--
-- SQLite has no DROP CONSTRAINT / ALTER COLUMN, so the CHECK change requires a
-- table rebuild (mirrors migrations 0040/0053).
--
-- No `plan_items` change needed: `link` and `mkdir` are already valid
-- `plan_items.action` values (migration 0029), and the table name is
-- preserved across the `plans` rebuild so existing `plan_items` FKs keep
-- working (see 0053).

PRAGMA foreign_keys = OFF;

CREATE TABLE plans_0054 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','archive','source_view','manifest','prepared_view_removal','prepared_view_regeneration','prepared_view_generation')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','source_map','project_create','source_view_removal','source_view_regeneration','source_view_generation')),
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES plans_0054(id),
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

INSERT INTO plans_0054 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_0054 RENAME TO plans;

CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

PRAGMA foreign_keys = ON;
