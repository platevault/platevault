-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only

-- Projects (spec 065): the required container for processing runs. A Project
-- write changes only these tables. Candidates are derived on read from confirmed
-- Target and rig associations over `live_assets` and are never stored, and
-- progress is computed on read. A Project has no capture-site column.
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    notes TEXT,
    state TEXT NOT NULL CHECK (state IN ('open', 'done')),
    done_at TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((state = 'done') = (done_at IS NOT NULL))
) STRICT;

-- A subject is a saved Target, or a mosaic of that Target with panels. The
-- Target identifies the subject within its Project; `name` is an optional label.
CREATE TABLE IF NOT EXISTS project_subjects (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    target_id TEXT NOT NULL REFERENCES targets (id),
    mosaic INTEGER NOT NULL CHECK (mosaic IN (0, 1)),
    name TEXT CHECK (name IS NULL OR length(trim(name)) > 0),
    position INTEGER NOT NULL,
    UNIQUE (project_id, target_id),
    UNIQUE (project_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_subjects_target ON project_subjects (target_id);

-- Mosaic panels by ICRS centre and rotation; a NULL rotation is unknown, never
-- zero. The number is the panel's "Panel N" and keeps its identity across edits.
CREATE TABLE IF NOT EXISTS subject_panels (
    id TEXT PRIMARY KEY NOT NULL,
    subject_id TEXT NOT NULL REFERENCES project_subjects (id),
    number INTEGER NOT NULL CHECK (number > 0),
    ra_deg REAL NOT NULL CHECK (ra_deg >= 0 AND ra_deg < 360),
    dec_deg REAL NOT NULL CHECK (dec_deg >= -90 AND dec_deg <= 90),
    rotation_deg REAL CHECK (rotation_deg IS NULL OR (rotation_deg >= 0 AND rotation_deg < 360)),
    UNIQUE (subject_id, number),
    UNIQUE (subject_id, id)
) STRICT;

-- The rigs (saved equipment) taking part, in order.
CREATE TABLE IF NOT EXISTS project_rigs (
    project_id TEXT NOT NULL REFERENCES projects (id),
    equipment_id TEXT NOT NULL REFERENCES equipment (id),
    position INTEGER NOT NULL,
    PRIMARY KEY (project_id, equipment_id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_rigs_equipment ON project_rigs (equipment_id);

-- Goals per subject and channel, or per panel of a mosaic subject. A NULL
-- channel is the channel of frames that record no FILTER. A quality bar names
-- one criterion (JSON) and applies to every goal of its subject or panel.
CREATE TABLE IF NOT EXISTS project_goals (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    subject_id TEXT NOT NULL,
    panel_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('integration', 'frame_count', 'quality_bar')),
    channel TEXT CHECK (channel IS NULL OR length(trim(channel)) > 0),
    goal_seconds INTEGER CHECK (goal_seconds IS NULL OR goal_seconds > 0),
    goal_frames INTEGER CHECK (goal_frames IS NULL OR goal_frames > 0),
    criterion TEXT,
    position INTEGER NOT NULL,
    FOREIGN KEY (project_id, subject_id) REFERENCES project_subjects (project_id, id),
    FOREIGN KEY (subject_id, panel_id) REFERENCES subject_panels (subject_id, id),
    CHECK ((kind = 'integration') = (goal_seconds IS NOT NULL)),
    CHECK ((kind = 'frame_count') = (goal_frames IS NOT NULL)),
    CHECK ((kind = 'quality_bar') = (criterion IS NOT NULL)),
    CHECK (kind <> 'quality_bar' OR channel IS NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS project_goals_project ON project_goals (project_id, position);

-- User goal templates; the built-in ones live in code. Applying a template
-- copies its values into a Project, so a later edit changes no Project.
CREATE TABLE IF NOT EXISTS goal_templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    goals TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
) STRICT;

-- Append-only Project-only reject decisions. Each (Project, asset) pair counts
-- its own revisions, so a mark checks only that asset's latest decision and
-- never the Project revision. The latest row is effective; a withdrawal is a
-- later row with `rejected` 0. Library quality is never written here.
CREATE TABLE IF NOT EXISTS project_rejections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    rejected INTEGER NOT NULL CHECK (rejected IN (0, 1)),
    fingerprint TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    UNIQUE (project_id, asset_id, revision)
) STRICT;
CREATE INDEX IF NOT EXISTS project_rejections_asset ON project_rejections (asset_id);
