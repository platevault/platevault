-- Migration 0032: collapse dark/flat/bias source kinds into a single
-- 'calibration' kind (spec 030 / feat/unify-calibration-source-kind).
--
-- registered_sources.kind changes from the 6-type set
--   ('light_frames', 'dark', 'flat', 'bias', 'project', 'inbox')
-- to the unified 4-type set
--   ('light_frames', 'calibration', 'project', 'inbox').
--
-- Per-image frame type (light/dark/flat/bias) is detected from image
-- metadata (FITS IMAGETYP header) during scan/ingest — NOT inferred from
-- the source-folder kind. The 'calibration' kind is only a user-facing
-- folder category.
--
-- SQLite does not support ALTER CHECK, so the table is rebuilt.

-- ── Rebuild registered_sources ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registered_sources_new (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('light_frames', 'calibration', 'project', 'inbox')),
    path         TEXT NOT NULL,
    kind_subtype TEXT,
    scan_depth   TEXT NOT NULL DEFAULT 'recursive' CHECK (scan_depth IN ('recursive', 'single')),
    created_at   TEXT NOT NULL,
    created_via  TEXT NOT NULL CHECK (created_via IN ('first_run', 'settings_add', 'settings_restart')),
    last_seen_at TEXT,
    UNIQUE(kind, path)
);

-- Migrate data: collapse 'dark', 'flat', 'bias' → 'calibration'.
-- Where multiple rows for the same path differ only in their old kind
-- (e.g. a path registered separately as 'dark' and as 'flat'), the
-- UNIQUE(kind, path) constraint on the new table would reject duplicates.
-- We guard against this by using INSERT OR IGNORE so that only the first
-- encountered row for each (calibration, path) pair is retained.
INSERT OR IGNORE INTO registered_sources_new
    (id, kind, path, kind_subtype, scan_depth, created_at, created_via, last_seen_at)
SELECT
    id,
    CASE kind
        WHEN 'dark' THEN 'calibration'
        WHEN 'flat' THEN 'calibration'
        WHEN 'bias' THEN 'calibration'
        ELSE kind
    END,
    path, kind_subtype, scan_depth, created_at, created_via, last_seen_at
FROM registered_sources
ORDER BY created_at ASC;

DROP TABLE registered_sources;
ALTER TABLE registered_sources_new RENAME TO registered_sources;
