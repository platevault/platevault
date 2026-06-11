-- Migration 0013: settings and per-source overrides (spec 018, T003).
--
-- `settings` stores one row per key with a JSON value.
-- `source_overrides` stores per-source overrides of overridable keys.
-- Constitution §I: metadata stored in DB without requiring raw files.
-- Constitution §II: settings changes are auditable.

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL, -- JSON-encoded value
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_overrides (
    source_id  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL, -- JSON-encoded value
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source_id, key)
);
