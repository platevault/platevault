-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Frame review (spec 067): measurement runs, cached measurement records and
-- reviewed or confirmed SubframeSelector imports, appended to the clean
-- library catalog. These rows reference assets and never change an asset,
-- digest, quality, session, association, correction, View or Project row.
-- Runs and records are re-derivable (Tier 2); a confirmed import is a user
-- decision (Tier 1).

CREATE TABLE IF NOT EXISTS measurement_runs (
    id TEXT PRIMARY KEY NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    method_name TEXT NOT NULL,
    method_version INTEGER NOT NULL CHECK (method_version > 0),
    state TEXT NOT NULL
        CHECK (state IN ('running', 'completed', 'canceled', 'interrupted', 'failed')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    requested INTEGER NOT NULL CHECK (requested >= 0),
    already_cached INTEGER NOT NULL CHECK (already_cached >= 0),
    measured INTEGER NOT NULL DEFAULT 0 CHECK (measured >= 0),
    failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
    unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable >= 0),
    started_at TEXT NOT NULL,
    finished_at TEXT
) STRICT;

-- At most one Running run per catalog.
CREATE UNIQUE INDEX IF NOT EXISTS measurement_runs_one_running
    ON measurement_runs (state) WHERE state = 'running';

-- The requested assets in queue order; a frame is settled once its record,
-- failed outcome or issue is committed.
CREATE TABLE IF NOT EXISTS measurement_run_queue (
    run_id TEXT NOT NULL REFERENCES measurement_runs (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    position INTEGER NOT NULL,
    settled INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0, 1)),
    PRIMARY KEY (run_id, asset_id)
) STRICT;

CREATE INDEX IF NOT EXISTS measurement_run_queue_open
    ON measurement_run_queue (asset_id) WHERE settled = 0;

CREATE TABLE IF NOT EXISTS measurement_run_issues (
    run_id TEXT NOT NULL REFERENCES measurement_runs (id),
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    PRIMARY KEY (run_id, position)
) STRICT;

-- The latest record per asset and method name replaces the previous one.
CREATE TABLE IF NOT EXISTS measurement_records (
    id TEXT PRIMARY KEY NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    run_id TEXT NOT NULL REFERENCES measurement_runs (id),
    method_name TEXT NOT NULL,
    method_version INTEGER NOT NULL CHECK (method_version > 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('measured', 'failed')),
    content_sha256 TEXT,
    record TEXT NOT NULL,
    measured_at TEXT NOT NULL,
    UNIQUE (asset_id, method_name)
) STRICT;

CREATE TABLE IF NOT EXISTS measurement_imports (
    id TEXT PRIMARY KEY NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    format TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'confirmed')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    source TEXT NOT NULL,
    module_version TEXT,
    psf_type TEXT,
    preamble TEXT NOT NULL,
    layout TEXT NOT NULL,
    scope TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    confirmed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS measurement_import_columns (
    import_id TEXT NOT NULL REFERENCES measurement_imports (id),
    position INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (import_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS measurement_import_rows (
    import_id TEXT NOT NULL REFERENCES measurement_imports (id),
    line INTEGER NOT NULL,
    match_state TEXT NOT NULL,
    asset_id TEXT REFERENCES assets (id),
    body TEXT NOT NULL,
    PRIMARY KEY (import_id, line)
) STRICT;

-- The fingerprint and digest each scope asset was reviewed against.
CREATE TABLE IF NOT EXISTS measurement_import_bases (
    import_id TEXT NOT NULL REFERENCES measurement_imports (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    basis TEXT NOT NULL,
    PRIMARY KEY (import_id, asset_id)
) STRICT;

-- Confirmed values of mapped columns; kept apart from built-in records.
CREATE TABLE IF NOT EXISTS measurement_import_values (
    import_id TEXT NOT NULL REFERENCES measurement_imports (id),
    line INTEGER NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    body TEXT NOT NULL,
    PRIMARY KEY (import_id, line, position)
) STRICT;

CREATE INDEX IF NOT EXISTS measurement_import_values_asset
    ON measurement_import_values (asset_id);
