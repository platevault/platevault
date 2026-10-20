-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- A Project's desired state (spec 065 PRJ-FR-05/08/09/27 to PRJ-FR-31, 066
-- VSEL-FR-12/15/16; D-W94 to D-W96, D-W105, D-W107). A Project holds whole
-- sessions the user added, each in one group of one rig, and for each session
-- the exact logical captures (D16) and copies it held when added, so a
-- regroup, an availability change or an association edit never replaces a
-- chosen frame. Each capture and copy is allocated once per Project. There
-- are no membership revisions: these rows are the desired state and the
-- installed View manifest (project_view.sql) the applied state. Structured
-- values are shared-model JSON.
--
-- The admission rule (`platevault_model::admit_session`) holds here too: only
-- a current session that is Ready at its current grouping revision, on the
-- group's rig, with every calibration kind pinned or declined joins, at the
-- basis it was admitted on. Persistence checks it first and names every
-- blocker; these triggers refuse whatever slips past.

CREATE TABLE IF NOT EXISTS project_groups (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    rig_id TEXT NOT NULL REFERENCES equipment (id),
    name TEXT NOT NULL CHECK (length(name) > 0 AND name = trim(name)),
    -- The name's comparison key (trimmed, NFC, lowercase): two groups of a
    -- Project never share a name, so never silently a folder.
    name_key TEXT NOT NULL CHECK (length(name_key) > 0),
    panel INTEGER NOT NULL CHECK (panel IN (0, 1)),
    origin TEXT NOT NULL CHECK (origin IN ('framing', 'user')),
    optics TEXT NOT NULL,
    -- NULL reads "Framing unknown".
    framing TEXT,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (project_id, id),
    UNIQUE (project_id, name_key)
) STRICT;
CREATE INDEX IF NOT EXISTS project_groups_project ON project_groups (project_id, position);

CREATE TRIGGER IF NOT EXISTS project_groups_identity_fixed
BEFORE UPDATE OF id, project_id, rig_id ON project_groups
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.rig_id IS NOT OLD.rig_id
BEGIN SELECT RAISE(ABORT, 'a group''s Project and rig are fixed'); END;

CREATE TABLE IF NOT EXISTS project_sessions (
    project_id TEXT NOT NULL REFERENCES projects (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    group_id TEXT NOT NULL,
    placement TEXT NOT NULL CHECK (placement IN ('framing', 'user', 'framing_unknown')),
    -- The confirmed Target the session joined on: its goals keep counting it
    -- after the Library re-confirms it as a Target the Project lacks
    -- (PRJ-AC-26).
    target_id TEXT NOT NULL REFERENCES targets (id),
    -- The admission basis (`AdmissionBasis`).
    grouping_revision INTEGER NOT NULL CHECK (grouping_revision >= 0),
    calibration_generation INTEGER NOT NULL CHECK (calibration_generation > 0),
    added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, session_id),
    FOREIGN KEY (project_id, group_id) REFERENCES project_groups (project_id, id)
) STRICT;
-- Fan-out of Library changes to the open Projects holding a session, and
-- Archive's "held by another Project".
CREATE INDEX IF NOT EXISTS project_sessions_session ON project_sessions (session_id);
CREATE INDEX IF NOT EXISTS project_sessions_group ON project_sessions (project_id, group_id);

CREATE TRIGGER IF NOT EXISTS project_sessions_admit_current
BEFORE INSERT ON project_sessions
WHEN (SELECT superseded_by FROM sessions WHERE id = NEW.session_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a superseded session never joins a Project; add its successor'); END;

-- The Target counts as confirmed when the user confirmed it or it is
-- associated by agreeing evidence: Suggested with an agreeing alias, qualified
-- geometry and no conflict (D-W124). This restates the Rust rule
-- `platevault_model::counts_as_confirmed`; f4_schema.rs checks they agree.
CREATE TRIGGER IF NOT EXISTS project_sessions_admit_ready
BEFORE INSERT ON project_sessions
WHEN NOT EXISTS (
    SELECT 1 FROM associations a WHERE a.session_id = NEW.session_id AND a.kind = 'target'
        AND a.target_id IS NOT NULL
        AND (a.state = 'confirmed' OR (a.state = 'suggested'
            AND EXISTS (
                SELECT 1 FROM json_each(a.evidence) e
                WHERE json_extract(e.value, '$.kind') = 'alias'
                    AND json_extract(e.value, '$.agrees') = 1
            ) AND EXISTS (
                SELECT 1 FROM json_each(a.evidence) e
                WHERE json_extract(e.value, '$.kind') IN ('coordinates', 'footprint')
                    AND json_extract(e.value, '$.qualified') = 1
            ) AND NOT EXISTS (
                SELECT 1 FROM json_each(a.evidence) e
                WHERE json_extract(e.value, '$.kind') = 'conflict'
            )))
) OR NOT EXISTS (
    SELECT 1 FROM associations WHERE session_id = NEW.session_id AND kind = 'equipment'
        AND state = 'confirmed'
) OR NOT EXISTS (
    SELECT 1 FROM session_reviews r JOIN sessions s ON s.id = r.session_id
    WHERE r.session_id = NEW.session_id AND r.grouping_revision = s.grouping_revision
)
BEGIN SELECT RAISE(ABORT, 'only a Ready session joins a Project'); END;

CREATE TRIGGER IF NOT EXISTS project_sessions_admit_rig
BEFORE INSERT ON project_sessions
WHEN EXISTS (
    SELECT 1 FROM associations WHERE session_id = NEW.session_id AND kind = 'equipment'
        AND state = 'confirmed'
) AND NOT EXISTS (
    SELECT 1 FROM associations a JOIN project_groups g ON g.rig_id = a.equipment_id
    WHERE a.session_id = NEW.session_id AND a.kind = 'equipment' AND a.state = 'confirmed'
        AND g.id = NEW.group_id
)
BEGIN SELECT RAISE(ABORT, 'a session joins a group on its own rig'); END;

CREATE TRIGGER IF NOT EXISTS project_sessions_admit_settled
BEFORE INSERT ON project_sessions
WHEN (
    SELECT count(*) FROM session_calibration_kinds
    WHERE session_id = NEW.session_id AND state IN ('pinned', 'declined')
) < 3
BEGIN SELECT RAISE(ABORT, 'only a session with settled calibration joins a Project'); END;

CREATE TRIGGER IF NOT EXISTS project_sessions_admit_basis
BEFORE INSERT ON project_sessions
WHEN NEW.grouping_revision IS NOT (SELECT grouping_revision FROM sessions WHERE id = NEW.session_id)
    OR NEW.calibration_generation
        IS NOT (SELECT generation FROM session_calibration WHERE session_id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'the admission basis is stale; review the session again'); END;

CREATE TRIGGER IF NOT EXISTS project_sessions_identity_fixed
BEFORE UPDATE OF project_id, session_id, target_id ON project_sessions
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.session_id IS NOT OLD.session_id
    OR NEW.target_id IS NOT OLD.target_id
BEGIN SELECT RAISE(ABORT, 'a held session''s Project, identity and joined Target are fixed'); END;

-- Moving a session keeps it on its rig: groups follow rigs (PRJ-FR-31).
CREATE TRIGGER IF NOT EXISTS project_sessions_move_keeps_rig
BEFORE UPDATE OF group_id ON project_sessions
WHEN (SELECT rig_id FROM project_groups WHERE id = NEW.group_id)
    IS NOT (SELECT rig_id FROM project_groups WHERE id = OLD.group_id)
BEGIN SELECT RAISE(ABORT, 'a session moves only between groups of its rig'); END;

-- One row per logical capture the Project holds, keyed by its smallest copy
-- asset id when chosen; `quality_when_added` is `ApplicableQuality` JSON. A
-- later Library rejection is not written here: it reads as a pending
-- removal from the Library.
CREATE TABLE IF NOT EXISTS project_captures (
    project_id TEXT NOT NULL,
    capture_key TEXT NOT NULL REFERENCES assets (id),
    session_id TEXT NOT NULL,
    inclusion TEXT NOT NULL CHECK (inclusion IN ('included', 'excluded')),
    basis TEXT NOT NULL CHECK (basis IN ('usable', 'explicit', 'unusable', 'user')),
    quality_when_added TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, capture_key),
    FOREIGN KEY (project_id, session_id)
        REFERENCES project_sessions (project_id, session_id) ON DELETE CASCADE,
    CHECK ((inclusion = 'included') = (basis IN ('usable', 'explicit')))
) STRICT;
CREATE INDEX IF NOT EXISTS project_captures_session ON project_captures (project_id, session_id);

CREATE TRIGGER IF NOT EXISTS project_captures_identity_fixed
BEFORE UPDATE OF project_id, capture_key, session_id ON project_captures
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.capture_key IS NOT OLD.capture_key
    OR NEW.session_id IS NOT OLD.session_id
BEGIN SELECT RAISE(ABORT, 'a held capture''s identity is fixed'); END;

-- Every copy of a held capture with its decision revision and observation
-- fingerprint when chosen (D19). A copy belongs to one capture per Project,
-- and the key is never larger than any of its copies.
CREATE TABLE IF NOT EXISTS project_capture_copies (
    project_id TEXT NOT NULL,
    capture_key TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    decision_revision INTEGER NOT NULL CHECK (decision_revision >= 0),
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (project_id, asset_id),
    FOREIGN KEY (project_id, capture_key)
        REFERENCES project_captures (project_id, capture_key) ON DELETE CASCADE,
    CHECK (capture_key <= asset_id)
) STRICT;
CREATE INDEX IF NOT EXISTS project_capture_copies_capture
    ON project_capture_copies (project_id, capture_key);
CREATE INDEX IF NOT EXISTS project_capture_copies_asset ON project_capture_copies (asset_id);

CREATE TRIGGER IF NOT EXISTS project_capture_copies_fixed
BEFORE UPDATE ON project_capture_copies
BEGIN SELECT RAISE(ABORT, 'a copy basis is fixed when chosen'); END;

-- Goals of a group belong to mosaic panel groups, and a panel group with
-- goals stays a panel until they are removed.
CREATE TRIGGER IF NOT EXISTS project_goals_panel_group
BEFORE INSERT ON project_goals
WHEN NEW.group_id IS NOT NULL
    AND (SELECT panel FROM project_groups WHERE id = NEW.group_id) IS NOT 1
BEGIN SELECT RAISE(ABORT, 'a group goal belongs to a mosaic panel group'); END;

CREATE TRIGGER IF NOT EXISTS project_goals_panel_group_update
BEFORE UPDATE OF group_id ON project_goals
WHEN NEW.group_id IS NOT NULL
    AND (SELECT panel FROM project_groups WHERE id = NEW.group_id) IS NOT 1
BEGIN SELECT RAISE(ABORT, 'a group goal belongs to a mosaic panel group'); END;

CREATE TRIGGER IF NOT EXISTS project_groups_panel_goals
BEFORE UPDATE OF panel ON project_groups
WHEN NEW.panel = 0 AND EXISTS (SELECT 1 FROM project_goals WHERE group_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'a panel group with goals stays a panel'); END;
