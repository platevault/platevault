-- Migration 0008: cleanup policy and calibration tolerances (spec 030, T005).
--
-- cleanup_policy: per-data-type cleanup action preferences. One row per data
-- type. All default to 'keep' (safest default per Constitution §II).
--
-- calibration_tolerances: singleton row defining matching tolerances for
-- calibration frame reuse (temperature, exposure, aging, camera/gain/binning).

-- ── Cleanup policy ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cleanup_policy (
    data_type  TEXT PRIMARY KEY NOT NULL,
    action     TEXT NOT NULL DEFAULT 'keep' CHECK (action IN ('keep', 'archive', 'delete')),
    updated_at TEXT NOT NULL
);

-- Seed 15 data types with safe 'keep' defaults.
INSERT OR IGNORE INTO cleanup_policy (data_type, action, updated_at) VALUES
    ('calibrated_lights',       'keep', '2026-05-26T00:00:00Z'),
    ('registered_lights',       'keep', '2026-05-26T00:00:00Z'),
    ('drizzle_data',            'keep', '2026-05-26T00:00:00Z'),
    ('cosmetic_correction',     'keep', '2026-05-26T00:00:00Z'),
    ('debayered_frames',        'keep', '2026-05-26T00:00:00Z'),
    ('master_bias',             'keep', '2026-05-26T00:00:00Z'),
    ('master_dark',             'keep', '2026-05-26T00:00:00Z'),
    ('master_flat',             'keep', '2026-05-26T00:00:00Z'),
    ('master_light',            'keep', '2026-05-26T00:00:00Z'),
    ('processing_logs',         'keep', '2026-05-26T00:00:00Z'),
    ('sequence_files',          'keep', '2026-05-26T00:00:00Z'),
    ('light_subs_with_master',  'keep', '2026-05-26T00:00:00Z'),
    ('dark_subs_with_master',   'keep', '2026-05-26T00:00:00Z'),
    ('flat_subs_with_master',   'keep', '2026-05-26T00:00:00Z'),
    ('bias_subs_with_master',   'keep', '2026-05-26T00:00:00Z');

-- ── Calibration tolerances ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_tolerances (
    singleton_id            TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    temperature_tolerance_c REAL NOT NULL DEFAULT 5.0,
    exposure_tolerance_s    REAL NOT NULL DEFAULT 2.0,
    aging_limit_days        INTEGER NOT NULL DEFAULT 365,
    require_same_camera     INTEGER NOT NULL DEFAULT 1,
    require_same_gain       INTEGER NOT NULL DEFAULT 1,
    require_same_binning    INTEGER NOT NULL DEFAULT 1,
    updated_at              TEXT NOT NULL
);

-- Seed singleton with defaults.
INSERT OR IGNORE INTO calibration_tolerances (singleton_id, updated_at) VALUES
    ('default', '2026-05-26T00:00:00Z');
