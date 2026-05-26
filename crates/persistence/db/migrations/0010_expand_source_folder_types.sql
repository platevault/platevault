-- Migration 0010: expand registered_sources.kind and simplify first_run_state
-- steps (spec 030, T007).
--
-- registered_sources.kind changes from the 4-type set
--   ('raw', 'calibration', 'project', 'inbox')
-- to the more granular 6-type set
--   ('light_frames', 'dark', 'flat', 'bias', 'project', 'inbox').
--
-- first_run_state.last_step changes from the 8-step wizard
--   ('welcome', 'raw', 'calibration', 'project', 'inbox', 'detect_tools',
--    'download_catalogs', 'finish')
-- to the simplified 5-step wizard
--   ('source_folders', 'processing_tools', 'catalogs', 'confirm', 'complete').
--
-- SQLite does not support ALTER CHECK, so both tables are rebuilt.

-- ── Rebuild registered_sources ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registered_sources_new (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('light_frames', 'dark', 'flat', 'bias', 'project', 'inbox')),
    path         TEXT NOT NULL,
    kind_subtype TEXT,
    scan_depth   TEXT NOT NULL DEFAULT 'recursive' CHECK (scan_depth IN ('recursive', 'single')),
    created_at   TEXT NOT NULL,
    created_via  TEXT NOT NULL CHECK (created_via IN ('first_run', 'settings_add', 'settings_restart')),
    last_seen_at TEXT,
    UNIQUE(kind, path)
);

-- Migrate data: 'raw' → 'light_frames', 'calibration' → 'dark' (best-effort).
INSERT INTO registered_sources_new
    (id, kind, path, kind_subtype, scan_depth, created_at, created_via, last_seen_at)
SELECT
    id,
    CASE kind
        WHEN 'raw'         THEN 'light_frames'
        WHEN 'calibration' THEN 'dark'
        ELSE kind
    END,
    path, kind_subtype, scan_depth, created_at, created_via, last_seen_at
FROM registered_sources;

DROP TABLE registered_sources;
ALTER TABLE registered_sources_new RENAME TO registered_sources;

-- ── Rebuild first_run_state ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS first_run_state_new (
    singleton_id TEXT PRIMARY KEY DEFAULT 'first_run' CHECK (singleton_id = 'first_run'),
    completed_at TEXT,
    last_step    TEXT NOT NULL DEFAULT 'source_folders' CHECK (last_step IN ('source_folders', 'processing_tools', 'catalogs', 'confirm', 'complete')),
    updated_at   TEXT NOT NULL
);

-- Migrate data: map old steps to new steps.
INSERT INTO first_run_state_new
    (singleton_id, completed_at, last_step, updated_at)
SELECT
    singleton_id,
    completed_at,
    CASE last_step
        WHEN 'welcome'           THEN 'source_folders'
        WHEN 'raw'               THEN 'source_folders'
        WHEN 'calibration'       THEN 'source_folders'
        WHEN 'project'           THEN 'source_folders'
        WHEN 'inbox'             THEN 'source_folders'
        WHEN 'detect_tools'      THEN 'processing_tools'
        WHEN 'download_catalogs' THEN 'catalogs'
        WHEN 'finish'            THEN 'complete'
        ELSE 'source_folders'
    END,
    updated_at
FROM first_run_state;

DROP TABLE first_run_state;
ALTER TABLE first_run_state_new RENAME TO first_run_state;
