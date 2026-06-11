-- Migration 0026: source_protection_state table (spec 016 US2-US4).
--
-- Constitution §I: protection metadata stored in DB; no raw files required.
-- Constitution §II: every protection override is auditable; resolver documented.
-- Constitution §IV: source kinds and default protection levels researched and
--                   recorded in the spec 016 data model.

-- Per-source protection override.
-- Absence of a row means the source inherits global defaults.
CREATE TABLE IF NOT EXISTS source_protection_state (
    source_id             TEXT PRIMARY KEY NOT NULL,
    level                 TEXT NOT NULL CHECK (level IN ('protected', 'normal', 'unprotected')),
    block_permanent_delete INTEGER,  -- NULL = inherit global; 1 = true; 0 = false
    categories            TEXT,     -- JSON array of strings, NULL = inherit global list
    updated_at            TEXT NOT NULL,
    updated_by            TEXT NOT NULL DEFAULT 'system'
);
