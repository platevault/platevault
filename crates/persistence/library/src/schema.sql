-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Clean PlateVault library catalog (spec 064). No legacy schema is imported.
-- Paths are lossless native keys: one encoding byte (0 unix bytes, 1 UTF-16LE)
-- followed by the payload. Structured evidence is JSON of the shared model.

CREATE TABLE IF NOT EXISTS catalog_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value INTEGER NOT NULL
) STRICT;

INSERT OR IGNORE INTO catalog_meta (key, value) VALUES ('schema_version', 2);
INSERT OR IGNORE INTO catalog_meta (key, value) VALUES ('grouping_revision', 0);
INSERT OR IGNORE INTO catalog_meta (key, value) VALUES ('scan_sequence', 0);
INSERT OR IGNORE INTO catalog_meta (key, value) VALUES ('target_generation', 0);

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    path_key BLOB NOT NULL,
    role TEXT NOT NULL,
    identity TEXT NOT NULL,
    volume_filesystem TEXT NOT NULL,
    volume_stable_id TEXT NOT NULL,
    decision_revision INTEGER NOT NULL CHECK (decision_revision > 0),
    availability TEXT NOT NULL,
    last_observed_at TEXT,
    unavailable_reason TEXT,
    unavailable_at TEXT,
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS locations_volume ON locations (volume_filesystem, volume_stable_id);

CREATE TABLE IF NOT EXISTS scan_operations (
    id TEXT PRIMARY KEY NOT NULL,
    location_id TEXT NOT NULL REFERENCES locations (id),
    scope_key BLOB NOT NULL,
    state TEXT NOT NULL,
    root_identity TEXT NOT NULL,
    location_revision INTEGER NOT NULL,
    progress TEXT NOT NULL,
    complete_scopes TEXT NOT NULL,
    incomplete_scopes TEXT NOT NULL,
    identity_verified INTEGER NOT NULL CHECK (identity_verified IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    -- Set once the operation's first readable pass marked decided assets pending.
    verification_armed INTEGER NOT NULL DEFAULT 0 CHECK (verification_armed IN (0, 1)),
    sequence INTEGER NOT NULL UNIQUE,
    started_at TEXT NOT NULL,
    finished_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS scan_operations_location ON scan_operations (location_id, sequence);

CREATE UNIQUE INDEX IF NOT EXISTS scan_operations_one_running
    ON scan_operations (location_id) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS scan_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL REFERENCES scan_operations (id),
    path_key BLOB NOT NULL,
    reason TEXT NOT NULL,
    availability TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS scan_issues_operation ON scan_issues (operation_id, id);

CREATE TABLE IF NOT EXISTS session_lineage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correction_id TEXT NOT NULL,
    cause TEXT NOT NULL CHECK (cause IN ('correction', 'scan')),
    grouping_revision INTEGER NOT NULL,
    predecessors TEXT NOT NULL,
    successors TEXT NOT NULL,
    moved_assets TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    capture_key TEXT NOT NULL,
    grouping_revision INTEGER NOT NULL,
    decision_revision INTEGER NOT NULL,
    provisional TEXT NOT NULL,
    date_basis TEXT,
    superseded_by INTEGER REFERENCES session_lineage (id),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS sessions_current_key ON sessions (capture_key) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS lineage_sessions (
    lineage_id INTEGER NOT NULL REFERENCES session_lineage (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
    PRIMARY KEY (lineage_id, session_id, role)
) STRICT;

CREATE INDEX IF NOT EXISTS lineage_sessions_session ON lineage_sessions (session_id);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    location_id TEXT NOT NULL REFERENCES locations (id),
    path_key BLOB NOT NULL,
    fingerprint TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_ns TEXT NOT NULL,
    format TEXT NOT NULL,
    availability TEXT NOT NULL,
    observed TEXT NOT NULL,
    effective TEXT NOT NULL,
    observation_revision INTEGER NOT NULL CHECK (observation_revision > 0),
    decision_revision INTEGER NOT NULL CHECK (decision_revision >= 0),
    quality TEXT NOT NULL,
    quality_basis TEXT,
    -- A decided asset whose rehash in the latest readable scan has not finished.
    verification_pending INTEGER NOT NULL DEFAULT 0 CHECK (verification_pending IN (0, 1)),
    last_observed_at TEXT NOT NULL,
    last_operation_id TEXT REFERENCES scan_operations (id),
    session_id TEXT REFERENCES sessions (id),
    UNIQUE (location_id, path_key)
) STRICT;

CREATE INDEX IF NOT EXISTS assets_session ON assets (session_id);
CREATE INDEX IF NOT EXISTS assets_size_mtime ON assets (location_id, size_bytes, modified_ns);

CREATE TABLE IF NOT EXISTS session_members (
    session_id TEXT NOT NULL REFERENCES sessions (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    PRIMARY KEY (session_id, asset_id)
) STRICT;

CREATE INDEX IF NOT EXISTS session_members_asset ON session_members (asset_id);

-- Original header evidence per observation sequence; never rewritten.
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    operation_id TEXT NOT NULL REFERENCES scan_operations (id),
    sequence INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    format TEXT NOT NULL,
    metadata TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (asset_id, sequence)
) STRICT;

-- Manual catalog corrections; the latest row per (asset, field) is effective.
CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correction_id TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    field TEXT NOT NULL CHECK (field <> 'raw'),
    value TEXT NOT NULL,
    decision_revision INTEGER NOT NULL,
    observation_basis TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS corrections_asset ON corrections (asset_id, field, id);

-- Durable reviewed correction plans; confirmation is single-use and re-validates.
CREATE TABLE IF NOT EXISTS correction_previews (
    id TEXT PRIMARY KEY NOT NULL,
    expected TEXT NOT NULL,
    corrections TEXT NOT NULL,
    proposal TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed')),
    correction_id TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS quality_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    quality TEXT NOT NULL,
    basis TEXT,
    decision_revision INTEGER NOT NULL,
    decided_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY NOT NULL,
    designation TEXT NOT NULL CHECK (length(trim(designation)) > 0),
    common_name TEXT,
    object_type TEXT NOT NULL,
    ra_deg REAL,
    dec_deg REAL,
    frame TEXT,
    provenance TEXT NOT NULL,
    provider_id TEXT,
    decision_revision INTEGER NOT NULL CHECK (decision_revision > 0),
    updated_at TEXT NOT NULL,
    CHECK ((ra_deg IS NULL) = (dec_deg IS NULL) AND (ra_deg IS NULL) = (frame IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS targets_dec ON targets (dec_deg);

CREATE TABLE IF NOT EXISTS target_aliases (
    target_id TEXT NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
    normalized TEXT NOT NULL CHECK (length(normalized) > 0),
    text TEXT NOT NULL,
    kind TEXT NOT NULL,
    provenance TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (target_id, normalized)
) STRICT;

CREATE INDEX IF NOT EXISTS target_aliases_key ON target_aliases (normalized);

CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    camera TEXT,
    telescope TEXT,
    focal_length_mm REAL,
    pixel_size_um REAL,
    state TEXT NOT NULL,
    provenance TEXT NOT NULL,
    decision_revision INTEGER NOT NULL CHECK (decision_revision > 0),
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS associations (
    session_id TEXT NOT NULL REFERENCES sessions (id),
    kind TEXT NOT NULL CHECK (kind IN ('target', 'equipment')),
    target_id TEXT REFERENCES targets (id),
    equipment_id TEXT REFERENCES equipment (id),
    state TEXT NOT NULL,
    evidence TEXT NOT NULL,
    provenance TEXT NOT NULL,
    observation_basis TEXT NOT NULL,
    decision_revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, kind),
    CHECK (kind = 'target' OR target_id IS NULL),
    CHECK (kind = 'equipment' OR equipment_id IS NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS associations_target ON associations (target_id) WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS remap_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    location_id TEXT NOT NULL REFERENCES locations (id),
    expected_revision INTEGER NOT NULL,
    proposed_root BLOB NOT NULL,
    proposed_identity TEXT NOT NULL,
    items TEXT NOT NULL,
    blocked TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'applied')),
    created_at TEXT NOT NULL,
    applied_at TEXT
) STRICT;
