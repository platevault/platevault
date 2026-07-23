-- Migration 0069: fix dangling `project_id` FK on `processing_artifact` and
-- `prepared_source_view` (found via #713 FR-003 test coverage).
--
-- Migration 0036 renamed `project` -> `_project_pre0036` then created a fresh
-- `project` table. SQLite's `ALTER TABLE ... RENAME TO` rewrites *other*
-- tables' FK definitions that reference the renamed table by name, so
-- `processing_artifact.project_id` and `prepared_source_view.project_id`
-- silently ended up referencing `_project_pre0036`, which 0036 then dropped.
-- Neither table had ever been written to with `PRAGMA foreign_keys = ON` and
-- a non-null `project_id` until now, so this has been a latent "no such
-- table: main._project_pre0036" landmine since 0036 shipped.
--
-- Recreate both tables (rename-copy-drop, same pattern as 0036) with the FK
-- pointing at the current `project` table, then recreate `ledger_view`
-- (0050's shape, verbatim) since the rename would otherwise leave its
-- `FROM processing_artifact` / `FROM prepared_source_view` branches pointing
-- at the renamed-away tables too.
--
-- `ledger_view` MUST be dropped first: SQLite auto-rewrites a view's body on
-- every `ALTER TABLE ... RENAME` of a table it references, so renaming BOTH
-- tables while the view still exists left the second rename re-validating a
-- view that already pointed at the first table's (now-dropped) renamed-away
-- name, failing the whole migration with a dangling-reference error.

DROP VIEW IF EXISTS ledger_view;

-- ── processing_artifact ───────────────────────────────────────────────────────

ALTER TABLE processing_artifact RENAME TO _processing_artifact_pre0069;

CREATE TABLE processing_artifact (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT REFERENCES project(id),
    file_record_id TEXT NOT NULL REFERENCES file_record(id),
    kind TEXT NOT NULL CHECK (kind IN ('master', 'integration', 'drizzle', 'manifest', 'other')),
    tool TEXT,
    staleness TEXT NOT NULL CHECK (staleness IN ('current', 'stale', 'regenerating')),
    created_at TEXT NOT NULL
);

INSERT INTO processing_artifact (id, project_id, file_record_id, kind, tool, staleness, created_at)
SELECT id, project_id, file_record_id, kind, tool, staleness, created_at
FROM _processing_artifact_pre0069;

DROP TABLE _processing_artifact_pre0069;

-- ── prepared_source_view ──────────────────────────────────────────────────────

ALTER TABLE prepared_source_view RENAME TO _prepared_source_view_pre0069;

CREATE TABLE prepared_source_view (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES project(id),
    state TEXT NOT NULL CHECK (state IN ('not_created', 'planned', 'ready', 'stale', 'retired')),
    created_at TEXT NOT NULL
);

INSERT INTO prepared_source_view (id, project_id, state, created_at)
SELECT id, project_id, state, created_at
FROM _prepared_source_view_pre0069;

DROP TABLE _prepared_source_view_pre0069;

-- ── Recreate ledger_view (0050 shape, verbatim) ──────────────────────────────

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
