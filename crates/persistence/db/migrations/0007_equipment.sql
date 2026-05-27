-- Migration 0007: equipment tables (spec 030, T004).
--
-- Cameras, telescopes, optical trains, and filters used for acquisition
-- metadata and calibration matching. Predefined filters are seeded with
-- standard astrophotography narrowband, broadband, and dual-band types.
--
-- All ids are UUIDv4 TEXT (RFC 4122, lowercase hyphenated).
-- Timestamps are RFC 3339 UTC text.

-- ── Camera ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cameras (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    aliases       TEXT NOT NULL DEFAULT '[]',  -- JSON array of alternate names
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

-- ── Telescope ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS telescopes (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    aliases         TEXT NOT NULL DEFAULT '[]',  -- JSON array of alternate names
    focal_length_mm INTEGER,
    auto_detected   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

-- ── Optical train ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS optical_trains (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    telescope_id    TEXT REFERENCES telescopes(id),
    camera_id       TEXT REFERENCES cameras(id),
    focal_length_mm INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_optical_train_telescope ON optical_trains(telescope_id);
CREATE INDEX IF NOT EXISTS idx_optical_train_camera ON optical_trains(camera_id);

-- ── Filter ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS filters (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL UNIQUE,
    category      TEXT NOT NULL CHECK (category IN ('narrowband', 'broadband', 'dual_band', 'other', 'custom')),
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

-- ── Seed predefined filters ─────────────────────────────────────────────────
-- UUIDs are deterministic hex strings for reproducibility across environments.

INSERT OR IGNORE INTO filters (id, name, category, auto_detected, created_at) VALUES
    ('a0000000-0000-4000-8000-000000000001', 'Ha',        'narrowband', 0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000002', 'SII',       'narrowband', 0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000003', 'OIII',      'narrowband', 0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000004', 'NII',       'narrowband', 0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000005', 'L',         'broadband',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000006', 'R',         'broadband',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000007', 'G',         'broadband',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000008', 'B',         'broadband',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-000000000009', 'HO',        'dual_band',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-00000000000a', 'SO',        'dual_band',  0, '2026-05-26T00:00:00Z'),
    ('a0000000-0000-4000-8000-00000000000b', 'UV/IR Cut', 'other',      0, '2026-05-26T00:00:00Z');
