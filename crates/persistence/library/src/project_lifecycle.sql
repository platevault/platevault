-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- A Project's lifecycle, its one active operation, Wrap up and the Closed
-- snapshot (spec 065 PRJ-FR-14/25, 069 PREP-FR-19, 070 RES-FR-06/07, 071
-- STO-FR-13; D-W80, D-W97, D-W111, D-W112).
--
-- Close is Wrap up's last step: every step recorded (Clean up, Trash, then
-- Archive, each Finished or Skipped) and the snapshot taken, then the Project
-- reads Closing while its archive transfer runs, then Archived, or Closed.
-- A Project that is not open is locked: its row and every desired-state row
-- refuse edits. Whether a Closed Project may ever reopen is a provisional rule
-- the model's `ClosePolicy` alone decides, so this schema refuses only the
-- moves among the closing states that are never allowed.

CREATE TRIGGER IF NOT EXISTS projects_lifecycle_forward
BEFORE UPDATE OF lifecycle ON projects
WHEN NEW.lifecycle IS NOT OLD.lifecycle AND NEW.lifecycle <> 'open' AND NOT (
    (OLD.lifecycle = 'open' AND NEW.lifecycle IN ('closing', 'closed'))
    OR (OLD.lifecycle = 'closing' AND NEW.lifecycle IN ('closed', 'archived'))
)
BEGIN
    SELECT RAISE(ABORT, 'a Project closes forward: Open, Closing, then Closed or Archived');
END;

CREATE TRIGGER IF NOT EXISTS projects_close_after_wrap_up
BEFORE UPDATE OF lifecycle ON projects
WHEN OLD.lifecycle = 'open' AND NEW.lifecycle <> 'open'
    AND (SELECT count(*) FROM project_wrap_up_steps WHERE project_id = NEW.id) < 3
BEGIN SELECT RAISE(ABORT, 'a Project closes after every Wrap up step is recorded'); END;

CREATE TRIGGER IF NOT EXISTS projects_close_records_snapshot
BEFORE UPDATE OF lifecycle ON projects
WHEN OLD.lifecycle = 'open' AND NEW.lifecycle <> 'open'
    AND NOT EXISTS (SELECT 1 FROM project_snapshots WHERE project_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Close records the Project''s snapshot first'); END;

CREATE TRIGGER IF NOT EXISTS projects_closing_archives
BEFORE UPDATE OF lifecycle ON projects
WHEN OLD.lifecycle = 'open' AND NEW.lifecycle = 'closing' AND NOT EXISTS (
    SELECT 1 FROM project_wrap_up_steps
    WHERE project_id = NEW.id AND step = 'archive' AND outcome = 'finished'
)
BEGIN SELECT RAISE(ABORT, 'a Project reads Closing only while its archive transfer runs'); END;

-- Only the lifecycle and `updated_at` change once a Project is not open.
CREATE TRIGGER IF NOT EXISTS projects_locked
BEFORE UPDATE OF name, notes, revision, created_at, closed_at, view_mode,
    group_keyword, panel_keyword, profile_id, processing_parent ON projects
WHEN OLD.lifecycle <> 'open' AND NEW.lifecycle IS OLD.lifecycle
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

-- One PlateVault operation per Project at a time (PREP-FR-19): reserved in a
-- write transaction before any effect and settled once.
CREATE TABLE IF NOT EXISTS project_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    kind TEXT NOT NULL CHECK (
        kind IN ('apply', 'copy_to_output', 'clean_up', 'trash', 'archive')
    ),
    state TEXT NOT NULL CHECK (state IN ('active', 'settled')),
    reserved_at TEXT NOT NULL,
    settled_at TEXT,
    UNIQUE (project_id, id),
    CHECK ((state = 'settled') = (settled_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS project_operations_one_active
    ON project_operations (project_id) WHERE state = 'active';

CREATE TRIGGER IF NOT EXISTS project_operations_reserved_active
BEFORE INSERT ON project_operations
WHEN NEW.state <> 'active'
BEGIN SELECT RAISE(ABORT, 'an operation is reserved active'); END;

CREATE TRIGGER IF NOT EXISTS project_operations_admitted
BEFORE INSERT ON project_operations
WHEN NOT (
    SELECT lifecycle = 'open' OR (lifecycle = 'closing' AND NEW.kind = 'archive')
    FROM projects WHERE id = NEW.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'a Closed Project takes no operation; a Closing one only its archive');
END;

CREATE TRIGGER IF NOT EXISTS project_operations_settle_once
BEFORE UPDATE ON project_operations
WHEN OLD.state = 'settled' OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
    OR NEW.kind IS NOT OLD.kind OR NEW.reserved_at IS NOT OLD.reserved_at
BEGIN SELECT RAISE(ABORT, 'an operation settles once and keeps its identity'); END;

CREATE TRIGGER IF NOT EXISTS project_operations_kept
BEFORE DELETE ON project_operations
BEGIN SELECT RAISE(ABORT, 'an operation record is kept'); END;

-- The Closed snapshot (`ClosedSnapshot` JSON): taken while the Project is
-- still open, in Close's transaction, and immutable after. A Project never
-- applied freezes its desired basis with no generation.
CREATE TABLE IF NOT EXISTS project_snapshots (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects (id),
    applied_generation INTEGER CHECK (applied_generation IS NULL OR applied_generation > 0),
    snapshot TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    CHECK (json_extract(snapshot, '$.projectId') = project_id),
    CHECK (json_extract(snapshot, '$.appliedGeneration') IS applied_generation)
) STRICT;

CREATE TRIGGER IF NOT EXISTS project_snapshots_taken_open
BEFORE INSERT ON project_snapshots
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_snapshots_immutable_update
BEFORE UPDATE ON project_snapshots
BEGIN SELECT RAISE(ABORT, 'a Closed snapshot is immutable'); END;

CREATE TRIGGER IF NOT EXISTS project_snapshots_immutable_delete
BEFORE DELETE ON project_snapshots
BEGIN SELECT RAISE(ABORT, 'a Closed snapshot is immutable'); END;

-- Wrap up's recorded steps, in their fixed order. A later step is recorded
-- only after the one before it; reopening an earlier step removes the later
-- ones first. Nothing changes once the Project is not open.
CREATE TABLE IF NOT EXISTS project_wrap_up_steps (
    project_id TEXT NOT NULL REFERENCES projects (id),
    step TEXT NOT NULL CHECK (step IN ('clean_up', 'trash', 'archive')),
    outcome TEXT NOT NULL CHECK (outcome IN ('finished', 'skipped')),
    operation_id TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (project_id, step),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS project_wrap_up_steps_in_order
BEFORE INSERT ON project_wrap_up_steps
WHEN (NEW.step = 'trash' AND NOT EXISTS (
        SELECT 1 FROM project_wrap_up_steps WHERE project_id = NEW.project_id AND step = 'clean_up'
    ))
    OR (NEW.step = 'archive' AND NOT EXISTS (
        SELECT 1 FROM project_wrap_up_steps WHERE project_id = NEW.project_id AND step = 'trash'
    ))
BEGIN SELECT RAISE(ABORT, 'Wrap up runs Clean up, Trash, then Archive'); END;

CREATE TRIGGER IF NOT EXISTS project_wrap_up_steps_reopen_in_order
BEFORE DELETE ON project_wrap_up_steps
WHEN (OLD.step = 'clean_up' AND EXISTS (
        SELECT 1 FROM project_wrap_up_steps WHERE project_id = OLD.project_id AND step = 'trash'
    ))
    OR (OLD.step = 'trash' AND EXISTS (
        SELECT 1 FROM project_wrap_up_steps WHERE project_id = OLD.project_id AND step = 'archive'
    ))
BEGIN SELECT RAISE(ABORT, 'Wrap up runs Clean up, Trash, then Archive'); END;

-- ── The lock on a Project's desired state ──────────────────────────────────
-- Every row a Project owns refuses inserts, updates and deletes once the
-- Project is not open (PRJ-FR-25): Library and calibration changes, Apply
-- and edits never touch a Closed Project.

CREATE TRIGGER IF NOT EXISTS project_wrap_up_steps_locked_insert
BEFORE INSERT ON project_wrap_up_steps
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_wrap_up_steps_locked_update
BEFORE UPDATE ON project_wrap_up_steps
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_wrap_up_steps_locked_delete
BEFORE DELETE ON project_wrap_up_steps
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_subjects_locked_insert
BEFORE INSERT ON project_subjects
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_subjects_locked_update
BEFORE UPDATE ON project_subjects
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_subjects_locked_delete
BEFORE DELETE ON project_subjects
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_rigs_locked_insert
BEFORE INSERT ON project_rigs
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_rigs_locked_update
BEFORE UPDATE ON project_rigs
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_rigs_locked_delete
BEFORE DELETE ON project_rigs
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_goals_locked_insert
BEFORE INSERT ON project_goals
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_goals_locked_update
BEFORE UPDATE ON project_goals
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_goals_locked_delete
BEFORE DELETE ON project_goals
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_groups_locked_insert
BEFORE INSERT ON project_groups
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_groups_locked_update
BEFORE UPDATE ON project_groups
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_groups_locked_delete
BEFORE DELETE ON project_groups
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_sessions_locked_insert
BEFORE INSERT ON project_sessions
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_sessions_locked_update
BEFORE UPDATE ON project_sessions
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_sessions_locked_delete
BEFORE DELETE ON project_sessions
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_captures_locked_insert
BEFORE INSERT ON project_captures
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_captures_locked_update
BEFORE UPDATE ON project_captures
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_captures_locked_delete
BEFORE DELETE ON project_captures
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS project_capture_copies_locked_insert
BEFORE INSERT ON project_capture_copies
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
CREATE TRIGGER IF NOT EXISTS project_capture_copies_locked_delete
BEFORE DELETE ON project_capture_copies
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;
