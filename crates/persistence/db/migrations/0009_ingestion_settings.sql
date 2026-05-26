-- Migration 0009: ingestion settings singleton (spec 030, T006).
--
-- Controls filesystem watcher behaviour, scan policies, symlink/junction
-- handling, hashing strategy, metadata extraction, and grouping tolerances.
-- Constitution §I requires follow_symlinks and follow_junctions to default
-- off; Constitution §IV requires eager_hashing to default off.

CREATE TABLE IF NOT EXISTS ingestion_settings (
    singleton_id                    TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    watcher_enabled                 INTEGER NOT NULL DEFAULT 1,
    scan_on_startup                 INTEGER NOT NULL DEFAULT 1,
    follow_symlinks                 INTEGER NOT NULL DEFAULT 0,
    follow_junctions                INTEGER NOT NULL DEFAULT 0,
    eager_hashing                   INTEGER NOT NULL DEFAULT 0,
    metadata_extraction             INTEGER NOT NULL DEFAULT 1,
    exposure_grouping_tolerance_s   REAL NOT NULL DEFAULT 2.0,
    temperature_grouping_tolerance_c REAL NOT NULL DEFAULT 5.0,
    default_filter                  TEXT,
    updated_at                      TEXT NOT NULL
);

-- Seed singleton with defaults.
INSERT OR IGNORE INTO ingestion_settings (singleton_id, updated_at) VALUES
    ('default', '2026-05-26T00:00:00Z');
