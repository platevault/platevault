-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Mosaic run groups (spec 066 VSEL-FR-18/19, D-W38, D-W73). A run on a mosaic
-- subject is a group of panel runs: one `views` row per panel the user
-- confirmed, carrying `group_id` and `panel_id`, and no whole-mosaic run. The
-- group holds the shared setup; `views.profile_id` and
-- `views.calibration_policy` carry it per panel run. A group's Project,
-- subject and rig never change.

CREATE TABLE IF NOT EXISTS view_groups (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    subject_id TEXT NOT NULL,
    rig_id TEXT NOT NULL REFERENCES equipment (id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    profile_id TEXT,
    input_mode TEXT CHECK (
        input_mode IS NULL OR input_mode IN ('linked_view', 'direct_source', 'copy', 'clone')
    ),
    calibration_policy TEXT NOT NULL CHECK (calibration_policy IN ('automatic', 'manual')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id, subject_id) REFERENCES project_subjects (project_id, id),
    FOREIGN KEY (project_id, rig_id) REFERENCES project_rigs (project_id, equipment_id)
) STRICT;
CREATE INDEX IF NOT EXISTS view_groups_project ON view_groups (project_id);

CREATE TRIGGER IF NOT EXISTS view_groups_identity_fixed
BEFORE UPDATE OF project_id, subject_id, rig_id ON view_groups
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.rig_id IS NOT OLD.rig_id
BEGIN SELECT RAISE(ABORT, 'a run group''s project, subject and rig are fixed'); END;

-- Each panel run stays tied to its panel for good (VSEL-FR-18): discarding a
-- never-saved panel run's draft cannot remove the run from its group.
CREATE TRIGGER IF NOT EXISTS views_panel_run_kept
BEFORE DELETE ON views WHEN OLD.group_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a panel run belongs to its run group and is never removed'); END;

-- One panel decision per group session: by pointing with its evidence (model
-- JSON), assigned to one panel or flagged, or by the user. A flagged or
-- left-out session joins no panel run; a panel run's candidates are the
-- sessions assigned to its panel. `flag` keeps what pointing raised.
CREATE TABLE IF NOT EXISTS view_panel_assignments (
    group_id TEXT NOT NULL REFERENCES view_groups (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    grouping_revision INTEGER NOT NULL CHECK (grouping_revision >= 0),
    panel_id TEXT REFERENCES subject_panels (id),
    basis TEXT NOT NULL CHECK (basis IN ('pointing', 'user', 'left_out')),
    flag TEXT CHECK (
        flag IS NULL OR flag IN ('ambiguous', 'off_panel', 'no_pointing', 'fov_unknown')
    ),
    evidence TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (group_id, session_id),
    CHECK (basis <> 'pointing' OR ((panel_id IS NULL) = (flag IS NOT NULL))),
    CHECK (basis <> 'user' OR panel_id IS NOT NULL),
    CHECK (basis <> 'left_out' OR panel_id IS NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS view_panel_assignments_panel ON view_panel_assignments (panel_id)
    WHERE panel_id IS NOT NULL;
