-- Migration 0035: Protection defaults persistence (spec 033, T043, US4).
--
-- Adds the `protection_defaults` table for persisting global protection
-- defaults by scope and key (FR-018; fixes spec 016 T-003/T-005 — previously
-- these were loaded from `settings` but never written back on change).
--
-- Constitution §II: protected categories MUST gate cleanup plans. This table
-- persists the global-level, block_permanent_delete, and protected-categories
-- settings under scope="global" so that `set_global_protection_default` can
-- write them and `load_global_protection` can read them.
--
-- The `plan_items.source_id` column already exists from migration 0031.
-- This migration ensures it is populated for real generators (T044 wires
-- generators; no DDL change needed here — the column exists).

CREATE TABLE IF NOT EXISTS protection_defaults (
    scope      TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,  -- JSON-encoded value
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
);

-- Seed global defaults so that fresh installs have explicit rows.
-- These match the hard-coded fallback values already in the application.
INSERT OR IGNORE INTO protection_defaults (scope, key, value, updated_at)
VALUES
    ('global', 'defaultProtection',    '"protected"',            '1970-01-01T00:00:00Z'),
    ('global', 'blockPermanentDelete', 'true',                   '1970-01-01T00:00:00Z'),
    ('global', 'protectedCategories',  '["lights","masters","finals"]', '1970-01-01T00:00:00Z');
