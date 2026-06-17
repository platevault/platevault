-- Migration 0036: Project lifecycle reconciliation (spec 033 US5, D2).
--
-- D2 decision: `projects.lifecycle` (spec-008) is the single canonical lifecycle
-- column for projects. The legacy `project.state` column (spec-002, migration 0002)
-- is the divergence root. This migration:
--
--   1. Backfills `projects.lifecycle` from `project.state` for any project rows
--      that have a corresponding `project` row AND whose `projects.lifecycle`
--      is still 'setup_incomplete' (the creation default). If `project.state`
--      leads (i.e. it differs from the canonical default), we promote it.
--   2. Maps the legacy `project.state` values to canonical lifecycle values.
--      The enum is identical: setup_incomplete | ready | prepared | processing |
--      completed | archived | blocked.
--   3. Drops `project.state` column (via table-rename-and-recreate because
--      SQLite < 3.35.0 does not support DROP COLUMN).
--   4. Recreates `ledger_view` so the 'project' branch reads from
--      `projects.lifecycle` instead of the now-gone `project.state`.
--
-- Note: The legacy `project` table (migration 0002) and the `projects` table
-- (migration 0018) are separate tables. Projects created after spec-008 live
-- in `projects` only. The `project` table is the spec-002 lifecycle entity
-- table; its `state` column was the write target of `transition_use_case.rs`
-- (via `table_for(EntityType::Project)` = "project"). After this migration,
-- `transition_use_case.rs` is re-pointed to `projects.lifecycle` (T052),
-- and `table_for(EntityType::Project)` is updated to return "projects" with
-- the "lifecycle" column.

-- ── Step 1: backfill `projects.lifecycle` from `project.state` ───────────────
-- Only promote rows where the legacy `project` table has a non-default state
-- that differs from the current `projects.lifecycle` value.
UPDATE projects
SET lifecycle = (
    SELECT p.state
    FROM project p
    WHERE p.id = projects.id
      AND p.state IS NOT NULL
)
WHERE id IN (
    SELECT projects.id
    FROM projects
    INNER JOIN project ON project.id = projects.id
    WHERE project.state IS NOT NULL
      AND project.state <> projects.lifecycle
);

-- ── Step 2: drop `state` column from `project` via table recreation ───────────
-- We keep all other columns because child tables FK onto `project(id)`:
--   processing_artifact.project_id → project(id)
--   prepared_source_view.project_id → project(id)
-- We drop `state`, `last_action`, and `block_reason` (all spec-002 artefacts
-- that are now superseded by the canonical `projects` + audit tables).
-- NOTE: Foreign keys must be disabled for the rename/recreate to work without
-- constraint errors. sqlx migrations run in a transaction with FK-off mode.

ALTER TABLE project RENAME TO _project_pre0036;

CREATE TABLE project (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    target_id   TEXT NOT NULL REFERENCES target(id),
    session_ids TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_target ON project(target_id);

INSERT INTO project (id, name, target_id, session_ids, created_at)
SELECT id, name, target_id, session_ids, created_at
FROM _project_pre0036;

DROP TABLE _project_pre0036;

-- ── Step 3: recreate ledger_view with the 'project' branch reading from
--            `projects.lifecycle` (canonical per D2). All other branches
--            are verbatim from migration 0004 to preserve identical shape.
DROP VIEW IF EXISTS ledger_view;

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
-- Projects: state now sourced from `projects.lifecycle` (D2 canonical).
-- project_id column carries the project's own id (same as before, was `id`).
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
