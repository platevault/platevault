-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only

-- Projects (spec 065): the processing unit (D-W93). A Project write changes
-- only these tables and its inputs (project_inputs.sql). Suggestions are
-- derived on read from confirmed Target and rig associations over
-- `live_assets` and are never stored, and progress is computed on read. A
-- Project has no capture-site column.
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    notes TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- F4 (D-W94, D-W97): Open until Wrap up closes it, Closing while Close's
    -- archive transfer runs, then Closed or Archived and locked for good
    -- (project_lifecycle.sql). `revision` is the desired-state revision every
    -- edit advances and an Apply sheet records.
    lifecycle TEXT NOT NULL DEFAULT 'open'
        CHECK (lifecycle IN ('open', 'closing', 'closed', 'archived')),
    closed_at TEXT,
    -- The View step's settings (VSEL-FR-16, PREP-FR-06, PRJ-FR-28): input
    -- mode, this Project's keyword names (NULL: the Settings defaults), the
    -- application, and the chosen processing location as native-path JSON
    -- (NULL until chosen: there is no assumed root).
    view_mode TEXT NOT NULL DEFAULT 'symlinks' CHECK (view_mode IN ('symlinks', 'copies')),
    group_keyword TEXT,
    panel_keyword TEXT,
    profile_id TEXT REFERENCES profiles (id),
    processing_parent TEXT,
    CHECK ((lifecycle = 'open') = (closed_at IS NULL)),
    CHECK ((group_keyword IS NULL) = (panel_keyword IS NULL))
) STRICT;

-- A subject is a saved Target, which identifies the subject within its
-- Project; `name` is an optional label. A mosaic's panels are the Project's
-- panel groups (project_inputs.sql).
CREATE TABLE IF NOT EXISTS project_subjects (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    target_id TEXT NOT NULL REFERENCES targets (id),
    name TEXT CHECK (name IS NULL OR length(trim(name)) > 0),
    position INTEGER NOT NULL,
    UNIQUE (project_id, target_id),
    UNIQUE (project_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_subjects_target ON project_subjects (target_id);

-- The rigs (saved equipment) taking part, in order.
CREATE TABLE IF NOT EXISTS project_rigs (
    project_id TEXT NOT NULL REFERENCES projects (id),
    equipment_id TEXT NOT NULL REFERENCES equipment (id),
    position INTEGER NOT NULL,
    PRIMARY KEY (project_id, equipment_id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_rigs_equipment ON project_rigs (equipment_id);

-- Goals per subject and channel, or per mosaic panel group. A NULL channel is
-- the channel of frames that record no FILTER. A quality bar names one
-- criterion (JSON) and applies to every goal of its subject or panel group.
CREATE TABLE IF NOT EXISTS project_goals (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    subject_id TEXT NOT NULL,
    -- A goal of a mosaic panel group (PRJ-FR-03, PRJ-FR-29); groups, not
    -- names, scope panel goals (project_inputs.sql).
    group_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('integration', 'frame_count', 'quality_bar')),
    channel TEXT CHECK (channel IS NULL OR length(trim(channel)) > 0),
    goal_seconds INTEGER CHECK (goal_seconds IS NULL OR goal_seconds > 0),
    goal_frames INTEGER CHECK (goal_frames IS NULL OR goal_frames > 0),
    criterion TEXT,
    position INTEGER NOT NULL,
    FOREIGN KEY (project_id, subject_id) REFERENCES project_subjects (project_id, id),
    FOREIGN KEY (project_id, group_id) REFERENCES project_groups (project_id, id),
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

-- The goals of a removed subject, kept hidden (D-W128, PRJ-FR-02): each
-- `project_goals` row moves here with its id when its subject is removed, by
-- its subject's Target. No read counts or shows them. When the Target is a
-- subject again they move back with their ids, except a panel goal whose
-- group is gone or no longer a panel, which is dropped then.
CREATE TABLE IF NOT EXISTS project_hidden_goals (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    target_id TEXT NOT NULL REFERENCES targets (id),
    group_id TEXT,
    kind TEXT NOT NULL,
    channel TEXT,
    goal_seconds INTEGER,
    goal_frames INTEGER,
    criterion TEXT,
    position INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS project_hidden_goals_target
    ON project_hidden_goals (project_id, target_id, position);
