-- Migration 0012: source view configuration singleton (spec 030, T009).
--
-- Stores the user's preferred source view linking strategy. Only concrete
-- filesystem strategies are supported: 'junctions', 'symlinks', 'hardlinks',
-- 'copy'. The previously considered 'manifest_only' and 'hybrid' strategies
-- were removed during the UI audit.

CREATE TABLE IF NOT EXISTS source_view_config (
    singleton_id TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    strategy     TEXT NOT NULL DEFAULT 'junctions' CHECK (strategy IN ('junctions', 'symlinks', 'hardlinks', 'copy')),
    updated_at   TEXT NOT NULL
);

-- Seed singleton with default strategy.
INSERT OR IGNORE INTO source_view_config (singleton_id, updated_at) VALUES
    ('default', '2026-05-26T00:00:00Z');
