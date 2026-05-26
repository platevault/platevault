-- Migration 0006: first-run source setup tables (spec 003)
--
-- registered_sources: user-configured library root directories registered
-- during first-run or settings management.
--
-- first_run_state: singleton row tracking first-run wizard progress.

CREATE TABLE IF NOT EXISTS registered_sources (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('raw', 'calibration', 'project', 'inbox')),
    path        TEXT NOT NULL,
    kind_subtype TEXT,
    scan_depth  TEXT NOT NULL DEFAULT 'recursive' CHECK (scan_depth IN ('recursive', 'single')),
    created_at  TEXT NOT NULL,
    created_via TEXT NOT NULL CHECK (created_via IN ('first_run', 'settings_add', 'settings_restart')),
    last_seen_at TEXT,
    UNIQUE(kind, path)
);

CREATE TABLE IF NOT EXISTS first_run_state (
    singleton_id TEXT PRIMARY KEY DEFAULT 'first_run' CHECK (singleton_id = 'first_run'),
    completed_at TEXT,
    last_step    TEXT NOT NULL DEFAULT 'welcome' CHECK (last_step IN ('welcome', 'raw', 'calibration', 'project', 'inbox', 'detect_tools', 'download_catalogs', 'finish')),
    updated_at   TEXT NOT NULL
);
