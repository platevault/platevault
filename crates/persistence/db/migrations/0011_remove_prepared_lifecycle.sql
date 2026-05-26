-- Migration 0011: remove 'prepared' lifecycle state from project table
-- (spec 030, T008).
--
-- The project lifecycle enum changes from
--   ('setup_incomplete', 'ready', 'prepared', 'processing', 'completed',
--    'archived', 'blocked')
-- to
--   ('setup', 'ready', 'processing', 'completed', 'archived', 'blocked').
--
-- 'setup_incomplete' is renamed to 'setup' and 'prepared' is merged into
-- 'processing'. SQLite does not support ALTER CHECK, so the table is rebuilt.

-- ── Rebuild project table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_new (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    target_id    TEXT NOT NULL REFERENCES target(id),
    session_ids  TEXT NOT NULL DEFAULT '[]',
    state        TEXT NOT NULL CHECK (state IN ('setup', 'ready', 'processing', 'completed', 'archived', 'blocked')),
    last_action  TEXT,
    block_reason TEXT,
    created_at   TEXT NOT NULL
);

-- Migrate data: 'prepared' → 'processing', 'setup_incomplete' → 'setup'.
INSERT INTO project_new
    (id, name, target_id, session_ids, state, last_action, block_reason, created_at)
SELECT
    id, name, target_id, session_ids,
    CASE state
        WHEN 'prepared'         THEN 'processing'
        WHEN 'setup_incomplete' THEN 'setup'
        ELSE state
    END,
    last_action, block_reason, created_at
FROM project;

-- Drop dependent view before dropping the table.
DROP VIEW IF EXISTS ledger_view;

DROP TABLE project;
ALTER TABLE project_new RENAME TO project;

CREATE INDEX IF NOT EXISTS idx_project_state ON project(state);

-- ── Recreate ledger_view (from 0004) with updated project states ─────────────
-- The view definition is unchanged; it reads state as-is from the project table.

CREATE VIEW IF NOT EXISTS ledger_view AS
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
    'acquisition_session',
    id,
    state,
    NULL,
    NULL,
    NULL,
    created_at
FROM acquisition_session
UNION ALL
SELECT
    'calibration_session',
    id,
    state,
    NULL,
    NULL,
    NULL,
    created_at
FROM calibration_session
UNION ALL
SELECT
    'project',
    id,
    state,
    name,
    NULL,
    id,
    created_at
FROM project
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
