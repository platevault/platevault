-- Migration 0014: plans and plan_items tables (spec 017).
--
-- Constitution §I: plans store metadata/relationships; no image files are copied.
-- Constitution §II: every plan is reviewable before apply; soft-delete via discarded state.
-- Constitution §V: paths stored as (root_id, relative_path) for cross-platform portability.

CREATE TABLE IF NOT EXISTS plans (
    id                       TEXT PRIMARY KEY NOT NULL,
    number                   INTEGER NOT NULL,
    title                    TEXT NOT NULL,
    origin                   TEXT NOT NULL CHECK (origin IN ('inbox','restructure','cleanup','archive','project')),
    origin_path              TEXT,
    state                    TEXT NOT NULL DEFAULT 'draft'
                               CHECK (state IN (
                                 'draft','ready_for_review','approved',
                                 'applying','paused',
                                 'applied','partially_applied','failed','cancelled','discarded'
                               )),
    plan_type                TEXT NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','source_map')),
    destructive_destination  TEXT NOT NULL DEFAULT 'archive' CHECK (destructive_destination IN ('archive','os_trash')),
    parent_plan_id           TEXT,
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
    created_at               TEXT NOT NULL,
    FOREIGN KEY (parent_plan_id) REFERENCES plans(id)
);

-- Display-number sequence: one row per plan; auto-increment via max(number)+1.
CREATE INDEX IF NOT EXISTS plans_state_created ON plans (state, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_parent        ON plans (parent_plan_id);

CREATE TABLE IF NOT EXISTS plan_items (
    id                   TEXT PRIMARY KEY NOT NULL,
    plan_id              TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    item_index           INTEGER NOT NULL,   -- 1-based ordinal
    name                 TEXT NOT NULL,
    action               TEXT NOT NULL CHECK (action IN ('move','archive','delete','link','write')),
    from_root_id         TEXT,
    from_relative_path   TEXT NOT NULL DEFAULT '',
    to_root_id           TEXT,
    to_relative_path     TEXT NOT NULL DEFAULT '',
    reason               TEXT NOT NULL DEFAULT '',
    protection           TEXT NOT NULL DEFAULT 'normal' CHECK (protection IN ('normal','protected')),
    linked_entity        TEXT,              -- soft ref to inventory session/project/cal set
    item_state           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (item_state IN ('pending','applying','succeeded','failed','skipped','cancelled')),
    failure_reason       TEXT,
    provenance           TEXT,              -- JSON array of {label,value}
    approved_mtime       TEXT,             -- ISO-8601 snapshot at approve time (R-FS-1)
    approved_size_bytes  INTEGER,          -- byte size snapshot at approve time (R-FS-1)
    archive_path         TEXT,             -- computed destination under .astro-plan-archive/<planId>/
    created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items (plan_id, item_index ASC);
