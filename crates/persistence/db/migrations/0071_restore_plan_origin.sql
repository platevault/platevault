-- Migration 0071: #885 restore (un-archive) plan origin/type.
--
-- Adds the `restore` plan origin and plan_type so `archive_generator::generate_restore`
-- can persist a reviewable un-archive plan (mirrors the archive-plan shape,
-- reversed: archive folder -> original recorded location).
--
-- SQLite has no DROP CONSTRAINT / ALTER COLUMN, so the CHECK change requires a
-- table rebuild (mirrors migrations 0040/0053/0054).

PRAGMA foreign_keys = OFF;

CREATE TABLE plans_0071 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','archive','restore','source_view','manifest','prepared_view_removal','prepared_view_regeneration','prepared_view_generation')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','restore','source_map','project_create','source_view_removal','source_view_regeneration','source_view_generation')),
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES plans_0071(id),
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

INSERT INTO plans_0071 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_0071 RENAME TO plans;

CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

PRAGMA foreign_keys = ON;
