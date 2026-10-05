-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Optional Projects (spec 065): Tier 1 user decisions appended to the clean
-- library catalog. A Project writes only these tables; progress is computed on
-- read and never stored. A Project has no capture-site column and no lifecycle.

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    notes TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

-- Confirmed framing: the saved Target and its snapshot at the confirmed revision.
CREATE TABLE IF NOT EXISTS project_targets (
    project_id TEXT NOT NULL REFERENCES projects (id),
    target_id TEXT NOT NULL REFERENCES targets (id),
    position INTEGER NOT NULL,
    confirmed_revision INTEGER NOT NULL CHECK (confirmed_revision > 0),
    designation TEXT NOT NULL,
    ra_deg REAL,
    dec_deg REAL,
    frame TEXT,
    provenance TEXT NOT NULL,
    PRIMARY KEY (project_id, target_id),
    CHECK ((ra_deg IS NULL) = (dec_deg IS NULL) AND (ra_deg IS NULL) = (frame IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS project_targets_target ON project_targets (target_id);

-- Explicit mosaic panels; a null orientation is unknown, never zero. Names are
-- unique within a Project by input validation, which replaces the whole set.
CREATE TABLE IF NOT EXISTS project_panels (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    position INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    ra_deg REAL NOT NULL CHECK (ra_deg >= 0 AND ra_deg < 360),
    dec_deg REAL NOT NULL CHECK (dec_deg >= -90 AND dec_deg <= 90),
    width_deg REAL NOT NULL CHECK (width_deg > 0 AND width_deg <= 180),
    height_deg REAL NOT NULL CHECK (height_deg > 0 AND height_deg <= 180),
    position_angle_deg REAL
        CHECK (position_angle_deg IS NULL OR (position_angle_deg >= 0 AND position_angle_deg < 360)),
    UNIQUE (project_id, id)
) STRICT;

-- Equipment View selection preselects; saving it changes no association.
CREATE TABLE IF NOT EXISTS project_equipment (
    project_id TEXT NOT NULL REFERENCES projects (id),
    equipment_id TEXT NOT NULL REFERENCES equipment (id),
    position INTEGER NOT NULL,
    PRIMARY KEY (project_id, equipment_id)
) STRICT;

-- Ordered checklist; `criterion` is the shared model's JSON of the item kind.
CREATE TABLE IF NOT EXISTS project_checklist (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    criterion TEXT NOT NULL,
    equipment_id TEXT REFERENCES equipment (id),
    CHECK ((kind = 'equipment') = (equipment_id IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS project_checklist_project ON project_checklist (project_id, position);

-- Explicit session links, each optionally assigned to one panel of its Project.
CREATE TABLE IF NOT EXISTS project_session_links (
    project_id TEXT NOT NULL REFERENCES projects (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    panel_id TEXT,
    grouping_revision INTEGER NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (project_id, session_id),
    FOREIGN KEY (project_id, panel_id) REFERENCES project_panels (project_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_session_links_session ON project_session_links (session_id);

-- Append-only Project rejection decisions; the latest row per Project and asset
-- is effective. A withdrawal is a later row with `rejected` 0.
CREATE TABLE IF NOT EXISTS project_rejections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    rejected INTEGER NOT NULL CHECK (rejected IN (0, 1)),
    fingerprint TEXT NOT NULL,
    project_revision INTEGER NOT NULL CHECK (project_revision > 0),
    decided_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS project_rejections_decision
    ON project_rejections (project_id, asset_id, id);
CREATE INDEX IF NOT EXISTS project_rejections_asset ON project_rejections (asset_id);
