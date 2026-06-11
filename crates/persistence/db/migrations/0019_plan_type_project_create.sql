-- Migration 0019: Expand plan_type and action CHECK constraints for spec 008.
--
-- Adds 'project_create' to the plan_type allowed values.
-- Adds 'mkdir' and 'write_manifest' to the plan_items action allowed values.
--
-- SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT, so we recreate
-- both tables (plans and plan_items) with the expanded CHECKs.  All existing
-- data is preserved via INSERT INTO ... SELECT.
--
-- Spec 008: project.create generates a FilesystemPlan of type 'project_create'
-- with mkdir items (one per tool subfolder) and a write_manifest item for the
-- app-owned project marker (Constitution II).

PRAGMA foreign_keys = OFF;

-- ── plans table ───────────────────────────────────────────────────────────────

CREATE TABLE plans_new (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','source_view','manifest')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','source_map','project_create')),
    destructive_destination  TEXT    NOT NULL CHECK (destructive_destination IN ('trash','archive','none')),
    parent_plan_id           TEXT    REFERENCES plans_new(id),
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

INSERT INTO plans_new SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_new RENAME TO plans;

-- ── plan_items table ──────────────────────────────────────────────────────────

CREATE TABLE plan_items_new (
    id                   TEXT PRIMARY KEY NOT NULL,
    plan_id              TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    item_index           INTEGER NOT NULL,
    name                 TEXT NOT NULL,
    action               TEXT NOT NULL CHECK (action IN ('move','archive','delete','link','write','mkdir','write_manifest')),
    from_root_id         TEXT,
    from_relative_path   TEXT NOT NULL DEFAULT '',
    to_root_id           TEXT,
    to_relative_path     TEXT NOT NULL DEFAULT '',
    reason               TEXT NOT NULL DEFAULT '',
    protection           TEXT NOT NULL DEFAULT 'normal' CHECK (protection IN ('normal','protected')),
    linked_entity        TEXT,
    item_state           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (item_state IN ('pending','applying','succeeded','failed','skipped','cancelled')),
    failure_reason       TEXT,
    provenance           TEXT,
    approved_mtime       TEXT,
    approved_size_bytes  INTEGER,
    archive_path         TEXT,
    created_at           TEXT NOT NULL,
    -- added by migration 0015
    item_stale           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plan_items_new SELECT * FROM plan_items;
DROP TABLE plan_items;
ALTER TABLE plan_items_new RENAME TO plan_items;

CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items (plan_id, item_index ASC);

PRAGMA foreign_keys = ON;
