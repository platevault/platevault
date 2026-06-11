-- Migration 0029: prepared_source_views + prepared_source_view_items (spec 026)
--               + expand plans.origin and plans.plan_type CHECK constraints
--                 to include prepared_view_removal / prepared_view_regeneration /
--                 source_view_removal / source_view_regeneration values.
--
-- SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT, so we recreate
-- the plans and plan_items tables with the expanded constraints while preserving
-- all existing data (same technique as migration 0019).

PRAGMA foreign_keys = OFF;

-- ── plans table (expand origin + plan_type) ───────────────────────────────────

CREATE TABLE plans_new_029 (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN (
                                 'project','inbox','cleanup','source_view','manifest',
                                 'prepared_view_removal','prepared_view_regeneration'
                             )),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN (
                                 'draft','ready_for_review','approved','applying','paused',
                                 'applied','partially_applied','failed','cancelled','discarded'
                             )),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN (
                                 'split','restructure','cleanup','archive','source_map',
                                 'project_create','source_view_removal','source_view_regeneration'
                             )),
    destructive_destination  TEXT    NOT NULL CHECK (destructive_destination IN ('trash','archive','none')),
    parent_plan_id           TEXT    REFERENCES plans_new_029(id),
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

INSERT INTO plans_new_029 SELECT * FROM plans;
DROP TABLE plans;
ALTER TABLE plans_new_029 RENAME TO plans;

-- ── plan_items table (preserve unchanged, re-create for FK integrity) ─────────

CREATE TABLE plan_items_new_029 (
    id                   TEXT PRIMARY KEY NOT NULL,
    plan_id              TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    item_index           INTEGER NOT NULL,
    name                 TEXT NOT NULL,
    action               TEXT NOT NULL CHECK (action IN (
                             'move','archive','delete','link','write','mkdir','write_manifest'
                         )),
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
    item_stale           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plan_items_new_029 SELECT * FROM plan_items;
DROP TABLE plan_items;
ALTER TABLE plan_items_new_029 RENAME TO plan_items;

CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items (plan_id, item_index ASC);

PRAGMA foreign_keys = ON;

-- ── prepared_source_views table ───────────────────────────────────────────────
--
--
-- Tracks app-generated project source views (symlinks, junctions, copies).
-- Records are never hard-deleted; state `removed` retains full membership
-- for regeneration (A4, GRILL 2026-05-22).
--
-- Constitution I:  only view paths (app-created links/copies) are stored here;
--                  inventory source paths are referenced by id, never owned.
-- Constitution II: removal/regeneration go through a reviewable FilesystemPlan.
-- Constitution V:  SQLite rows are the durable record; the view on disk is a
--                  reproducible projection.
--
-- ViewKind: symlink | junction | copy   (hardlink reserved, deferred to v1.x)
-- ViewState: current | stale | missing | removed | failed | kind_diverged

CREATE TABLE IF NOT EXISTS prepared_source_views (
    id           TEXT    NOT NULL PRIMARY KEY,          -- UUID
    project_id   TEXT    NOT NULL REFERENCES projects(id),
    kind         TEXT    NOT NULL CHECK (kind IN (
                     'symlink', 'junction', 'copy', 'hardlink'
                 )),
    state        TEXT    NOT NULL DEFAULT 'current' CHECK (state IN (
                     'current', 'stale', 'missing', 'removed',
                     'failed', 'kind_diverged'
                 )),
    created_at   TEXT    NOT NULL,                      -- RFC-3339 UTC
    removed_at   TEXT                                   -- set when ViewRemovalPlan applied
);

CREATE INDEX IF NOT EXISTS idx_prepared_source_views_project
    ON prepared_source_views (project_id);

-- Per-item membership record. Preserved after removal for regeneration.
--
-- last_observed_state: present | missing | changed_kind | diverged | hash_diverged
-- `hash_diverged` applies only to copy-kind items (A3).

CREATE TABLE IF NOT EXISTS prepared_source_view_items (
    id                   TEXT    NOT NULL PRIMARY KEY,  -- UUID
    view_id              TEXT    NOT NULL REFERENCES prepared_source_views(id),
    inventory_item_id    TEXT    NOT NULL,              -- FK to inventory items (no FK constraint — inventory may be missing)
    view_relative_path   TEXT    NOT NULL,              -- path under project workspace
    materialization      TEXT    NOT NULL CHECK (materialization IN (
                             'symlink', 'junction', 'copy', 'hardlink'
                         )),
    last_observed_state  TEXT    NOT NULL DEFAULT 'present' CHECK (last_observed_state IN (
                             'present', 'missing', 'changed_kind', 'diverged', 'hash_diverged'
                         ))
);

CREATE INDEX IF NOT EXISTS idx_psvi_view_id
    ON prepared_source_view_items (view_id);
