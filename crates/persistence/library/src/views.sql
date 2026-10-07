-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Processing runs (spec 066, amended D-W1..D-W74): Tier 1 reviewed membership
-- in the clean library catalog. A run (View) lives in one Project on one
-- subject and one of the Project's rigs; its Project, subject, rig, run group
-- and panel never change after insert. A run holds immutable committed
-- revisions and at most one draft. A draft and its committed successor share
-- one `view_revisions` row: Save turns the draft row into revision n+1 in one
-- statement. Triggers refuse any change to a committed row or to the choices,
-- members and copies it owns. Summaries and candidate evidence are computed on
-- read and never stored.

CREATE TABLE IF NOT EXISTS views (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    subject_id TEXT NOT NULL,
    rig_id TEXT NOT NULL REFERENCES equipment (id),
    -- The mosaic run group a panel run belongs to, and its panel.
    group_id TEXT,
    panel_id TEXT,
    stage TEXT NOT NULL CHECK (
        stage IN ('select', 'review', 'calibrate', 'prepare', 'results', 'done', 'clean_up')
    ),
    completion TEXT NOT NULL CHECK (completion IN ('open', 'complete')),
    -- The stage Reopen returns a Complete run to.
    stage_before_complete TEXT CHECK (
        stage_before_complete IS NULL OR stage_before_complete IN
        ('select', 'review', 'calibrate', 'prepare', 'results', 'done', 'clean_up')
    ),
    -- Set while the run is in the Project's Trash; Restore clears it.
    trashed_at TEXT,
    profile_id TEXT,
    calibration_policy TEXT NOT NULL CHECK (calibration_policy IN ('automatic', 'manual')),
    -- The latest committed revision; 0 until the first Save.
    revision INTEGER NOT NULL CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id, subject_id) REFERENCES project_subjects (project_id, id),
    FOREIGN KEY (project_id, rig_id) REFERENCES project_rigs (project_id, equipment_id),
    FOREIGN KEY (subject_id, panel_id) REFERENCES subject_panels (subject_id, id),
    CHECK ((completion = 'complete') = (stage_before_complete IS NOT NULL)),
    CHECK (panel_id IS NULL OR group_id IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS views_project ON views (project_id);
CREATE INDEX IF NOT EXISTS views_subject ON views (subject_id);
CREATE INDEX IF NOT EXISTS views_rig ON views (rig_id);
CREATE INDEX IF NOT EXISTS views_group ON views (group_id) WHERE group_id IS NOT NULL;

-- A run's Project, subject, rig, run group and panel are fixed at creation
-- (D-W50): another subject or rig needs another run.
CREATE TRIGGER IF NOT EXISTS views_identity_fixed
BEFORE UPDATE OF project_id, subject_id, rig_id, group_id, panel_id ON views
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.rig_id IS NOT OLD.rig_id OR NEW.group_id IS NOT OLD.group_id
    OR NEW.panel_id IS NOT OLD.panel_id
BEGIN SELECT RAISE(ABORT, 'a run''s project, subject, rig, group and panel are fixed'); END;

-- Durable refresh reviews against a committed revision; `items` is the shared
-- model's JSON. A review is applied at most once.
CREATE TABLE IF NOT EXISTS view_refresh_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT NOT NULL REFERENCES views (id),
    base_revision INTEGER NOT NULL CHECK (base_revision > 0),
    criteria TEXT NOT NULL,
    items TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'applied')),
    created_at TEXT NOT NULL,
    applied_at TEXT,
    CHECK ((state = 'applied') = (applied_at IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS view_refresh_reviews_view ON view_refresh_reviews (view_id);

CREATE TABLE IF NOT EXISTS view_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    view_id TEXT NOT NULL REFERENCES views (id),
    state TEXT NOT NULL CHECK (state IN ('draft', 'committed')),
    -- The committed revision; null while the row is the draft.
    revision INTEGER CHECK (revision > 0),
    draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    criteria TEXT NOT NULL,
    refresh_review_id TEXT REFERENCES view_refresh_reviews (id),
    updated_at TEXT NOT NULL,
    committed_at TEXT,
    UNIQUE (view_id, revision),
    CHECK ((state = 'committed') = (revision IS NOT NULL)),
    CHECK ((state = 'committed') = (committed_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS view_revisions_one_draft ON view_revisions (view_id)
    WHERE state = 'draft';

-- Chosen and explicitly excluded sessions; reason and evidence are model JSON.
CREATE TABLE IF NOT EXISTS view_session_choices (
    revision_row INTEGER NOT NULL REFERENCES view_revisions (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    grouping_revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('selected', 'excluded')),
    reason TEXT NOT NULL,
    evidence TEXT,
    PRIMARY KEY (revision_row, session_id)
) STRICT;
CREATE INDEX IF NOT EXISTS view_session_choices_session ON view_session_choices (session_id);

-- One logical capture (D16) per member; the key is its smallest copy asset id
-- when chosen. The state is computed in the write transaction and then kept.
CREATE TABLE IF NOT EXISTS view_members (
    revision_row INTEGER NOT NULL REFERENCES view_revisions (id),
    member_key TEXT NOT NULL REFERENCES assets (id),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    state TEXT NOT NULL CHECK (state IN ('included', 'excluded')),
    reason TEXT NOT NULL,
    quality_when_chosen TEXT NOT NULL,
    added_in_revision INTEGER CHECK (added_in_revision > 0),
    PRIMARY KEY (revision_row, member_key)
) STRICT;

-- The review basis of each member: every recorded copy with its decision
-- revision and observation fingerprint when chosen.
CREATE TABLE IF NOT EXISTS view_member_copies (
    revision_row INTEGER NOT NULL,
    member_key TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    decision_revision INTEGER NOT NULL CHECK (decision_revision >= 0),
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (revision_row, member_key, asset_id),
    FOREIGN KEY (revision_row, member_key) REFERENCES view_members (revision_row, member_key)
) STRICT;
CREATE INDEX IF NOT EXISTS view_member_copies_asset ON view_member_copies (asset_id);

CREATE TRIGGER IF NOT EXISTS view_revisions_committed_update
BEFORE UPDATE ON view_revisions WHEN OLD.state = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_revisions_committed_delete
BEFORE DELETE ON view_revisions WHEN OLD.state = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_session_choices_committed_insert
BEFORE INSERT ON view_session_choices
WHEN (SELECT state FROM view_revisions WHERE id = NEW.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_session_choices_committed_update
BEFORE UPDATE ON view_session_choices
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_session_choices_committed_delete
BEFORE DELETE ON view_session_choices
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_members_committed_insert
BEFORE INSERT ON view_members
WHEN (SELECT state FROM view_revisions WHERE id = NEW.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_members_committed_update
BEFORE UPDATE ON view_members
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_members_committed_delete
BEFORE DELETE ON view_members
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_member_copies_committed_insert
BEFORE INSERT ON view_member_copies
WHEN (SELECT state FROM view_revisions WHERE id = NEW.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_member_copies_committed_update
BEFORE UPDATE ON view_member_copies
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;

CREATE TRIGGER IF NOT EXISTS view_member_copies_committed_delete
BEFORE DELETE ON view_member_copies
WHEN (SELECT state FROM view_revisions WHERE id = OLD.revision_row) = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed view revision is immutable'); END;
