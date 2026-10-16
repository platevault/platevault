-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- A Project's applied state: the one rebuilt View, entry names, the Apply
-- journal and what `View (previous)/` still holds (spec 069 PREP-FR-06/09,
-- PREP-FR-16/19, 066 VSEL-FR-14/20/21, 071 STO-FR-10; D-W98 to D-W100, D-W110,
-- D-W113, D-W114). Manifests are internal CAS generations of one View, never
-- `(rev N)` folders: at most one building, one installed (`View/`) and one
-- previous (`View (previous)/`) per Project, and once built a manifest's
-- entries never change. Entry paths are native-path keys relative to `View/`
-- and leftover paths relative to the Project folder; structured values are
-- shared-model JSON whose key fields the columns repeat and must agree with.

CREATE TABLE IF NOT EXISTS view_manifests (
    project_id TEXT NOT NULL REFERENCES projects (id),
    generation INTEGER NOT NULL CHECK (generation > 0),
    state TEXT NOT NULL CHECK (
        state IN ('building', 'installed', 'previous', 'retired', 'discarded')
    ),
    -- The Apply that built it.
    operation_id TEXT NOT NULL,
    -- The Project revision the build used.
    desired_revision INTEGER NOT NULL CHECK (desired_revision > 0),
    mode TEXT NOT NULL CHECK (mode IN ('symlinks', 'copies')),
    -- `ProjectBasis` JSON: what the build placed it from.
    basis TEXT NOT NULL,
    created_at TEXT NOT NULL,
    installed_at TEXT,
    PRIMARY KEY (project_id, generation),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id),
    CHECK (json_extract(basis, '$.mode') = mode),
    CHECK ((state IN ('installed', 'previous', 'retired')) = (installed_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS view_manifests_one_building
    ON view_manifests (project_id) WHERE state = 'building';
CREATE UNIQUE INDEX IF NOT EXISTS view_manifests_one_installed
    ON view_manifests (project_id) WHERE state = 'installed';
CREATE UNIQUE INDEX IF NOT EXISTS view_manifests_one_previous
    ON view_manifests (project_id) WHERE state = 'previous';

CREATE TRIGGER IF NOT EXISTS view_manifests_built_by_apply
BEFORE INSERT ON view_manifests
WHEN NEW.state <> 'building' OR NOT EXISTS (
    SELECT 1 FROM project_operations
    WHERE id = NEW.operation_id AND project_id = NEW.project_id AND kind = 'apply'
        AND state = 'active'
)
BEGIN SELECT RAISE(ABORT, 'a View is built by the Project''s active Apply'); END;

CREATE TRIGGER IF NOT EXISTS view_manifests_generation_grows
BEFORE INSERT ON view_manifests
WHEN NEW.generation
    <= (SELECT coalesce(max(generation), 0) FROM view_manifests WHERE project_id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'a View generation only grows'); END;

CREATE TRIGGER IF NOT EXISTS view_manifests_fixed
BEFORE UPDATE OF project_id, generation, operation_id, desired_revision, mode, basis, created_at
    ON view_manifests
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.generation IS NOT OLD.generation
    OR NEW.operation_id IS NOT OLD.operation_id OR NEW.desired_revision IS NOT OLD.desired_revision
    OR NEW.mode IS NOT OLD.mode OR NEW.basis IS NOT OLD.basis OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'a View manifest is fixed once built'); END;

CREATE TRIGGER IF NOT EXISTS view_manifests_state
BEFORE UPDATE OF state, installed_at ON view_manifests
WHEN (NEW.state IS NOT OLD.state AND NOT (
        (OLD.state = 'building' AND NEW.state IN ('installed', 'discarded'))
        OR (OLD.state = 'installed' AND NEW.state IN ('previous', 'retired'))
        OR (OLD.state = 'previous' AND NEW.state = 'retired')
    ))
    OR (OLD.installed_at IS NOT NULL AND NEW.installed_at IS NOT OLD.installed_at)
BEGIN
    SELECT RAISE(ABORT, 'a View state moves building, installed, previous, then retired');
END;

CREATE TRIGGER IF NOT EXISTS view_manifests_locked
BEFORE UPDATE ON view_manifests
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

CREATE TRIGGER IF NOT EXISTS view_manifests_kept
BEFORE DELETE ON view_manifests
WHEN OLD.state IN ('building', 'installed', 'previous')
    OR (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'only a retired or discarded View record is removed'); END;

-- One placed entry (`ManifestEntry` JSON). A light names its capture and the
-- copy placed; a calibration entry its raw frame or master version. Nothing
-- is a hard link: each Copies entry is its own file (D-W81, 063 FR-005).
CREATE TABLE IF NOT EXISTS view_manifest_entries (
    project_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 0),
    path_key BLOB NOT NULL,
    input TEXT NOT NULL CHECK (input IN ('light', 'flat', 'dark', 'bias')),
    placement TEXT NOT NULL CHECK (placement IN ('symlink', 'copy', 'clone')),
    capture_key TEXT,
    asset_id TEXT REFERENCES assets (id),
    master_id TEXT REFERENCES adopted_masters (id),
    group_id TEXT,
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
    entry TEXT NOT NULL,
    PRIMARY KEY (project_id, generation, seq),
    UNIQUE (project_id, generation, path_key),
    FOREIGN KEY (project_id, generation) REFERENCES view_manifests (project_id, generation),
    CHECK ((asset_id IS NULL) <> (master_id IS NULL)),
    CHECK ((input = 'light') = (capture_key IS NOT NULL)),
    CHECK (input <> 'light' OR asset_id IS NOT NULL),
    CHECK (json_extract(entry, '$.seq') = seq),
    CHECK (json_extract(entry, '$.sourceSha256') = source_sha256),
    CHECK (json_extract(entry, '$.placement.kind') = placement)
) STRICT;
-- Archive's repointing and the calibration library's Hide and Move to Trash
-- find the Views that place a source.
CREATE INDEX IF NOT EXISTS view_manifest_entries_asset
    ON view_manifest_entries (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS view_manifest_entries_master
    ON view_manifest_entries (master_id) WHERE master_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS view_manifest_entries_built_insert
BEFORE INSERT ON view_manifest_entries
WHEN (SELECT state FROM view_manifests
    WHERE project_id = NEW.project_id AND generation = NEW.generation) IS NOT 'building'
BEGIN SELECT RAISE(ABORT, 'a View''s entries are fixed once built'); END;

CREATE TRIGGER IF NOT EXISTS view_manifest_entries_built_update
BEFORE UPDATE ON view_manifest_entries
WHEN (SELECT state FROM view_manifests
    WHERE project_id = OLD.project_id AND generation = OLD.generation) IS NOT 'building'
BEGIN SELECT RAISE(ABORT, 'a View''s entries are fixed once built'); END;

CREATE TRIGGER IF NOT EXISTS view_manifest_entries_built_delete
BEFORE DELETE ON view_manifest_entries
WHEN (SELECT state FROM view_manifests
    WHERE project_id = OLD.project_id AND generation = OLD.generation)
    IN ('installed', 'previous')
BEGIN SELECT RAISE(ABORT, 'a View''s entries are fixed once built'); END;

-- Symlinks mode places only links; Copies mode copies and clones.
CREATE TRIGGER IF NOT EXISTS view_manifest_entries_mode
BEFORE INSERT ON view_manifest_entries
WHEN ((SELECT mode FROM view_manifests
    WHERE project_id = NEW.project_id AND generation = NEW.generation) = 'symlinks')
    <> (NEW.placement = 'symlink')
BEGIN SELECT RAISE(ABORT, 'Symlinks mode places only links, and Copies mode none'); END;

-- An input's entry basename, fixed for life (PREP-FR-19, D-W114): a newcomer
-- whose name clashes takes a suffix, and the existing entry keeps its name.
CREATE TABLE IF NOT EXISTS project_entry_names (
    project_id TEXT NOT NULL REFERENCES projects (id),
    input TEXT NOT NULL CHECK (input IN ('capture', 'calibration_frame', 'master')),
    input_id TEXT NOT NULL,
    basename TEXT NOT NULL CHECK (
        length(basename) > 0 AND basename NOT IN ('.', '..')
        AND instr(basename, '/') = 0 AND instr(basename, char(92)) = 0
    ),
    reserved_at TEXT NOT NULL,
    PRIMARY KEY (project_id, input, input_id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS project_entry_names_fixed_update
BEFORE UPDATE ON project_entry_names
BEGIN SELECT RAISE(ABORT, 'an entry name is fixed for life'); END;

CREATE TRIGGER IF NOT EXISTS project_entry_names_fixed_delete
BEFORE DELETE ON project_entry_names
BEGIN SELECT RAISE(ABORT, 'an entry name is fixed for life'); END;

CREATE TRIGGER IF NOT EXISTS project_entry_names_locked
BEFORE INSERT ON project_entry_names
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project is locked'); END;

-- One Apply's durable journal (`ApplyJournal`): the phase is recorded before
-- each effect, moves only forward, and settles once with the outcome that is
-- true from where it settled. `expected` is `ExpectedTree` JSON.
CREATE TABLE IF NOT EXISTS apply_operations (
    operation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN (
        'reserved', 'sources_verified', 'building', 'build_verified', 'waiting_for_release',
        'old_moved', 'new_installed', 'manifest_committed', 'foreign_transferred',
        'retiring_previous', 'settled'
    )),
    settled_from TEXT CHECK (settled_from IS NULL OR settled_from IN (
        'reserved', 'sources_verified', 'building', 'build_verified', 'waiting_for_release',
        'old_moved', 'new_installed', 'manifest_committed', 'foreign_transferred',
        'retiring_previous'
    )),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('applied', 'failed', 'canceled')),
    expected TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id),
    FOREIGN KEY (project_id, generation) REFERENCES view_manifests (project_id, generation),
    CHECK ((phase = 'settled') = (outcome IS NOT NULL)),
    CHECK ((phase = 'settled') = (settled_from IS NOT NULL)),
    CHECK (outcome IS NOT 'applied'
        OR settled_from IN ('manifest_committed', 'foreign_transferred', 'retiring_previous')),
    CHECK (outcome NOT IN ('failed', 'canceled') OR settled_from IN (
        'reserved', 'sources_verified', 'building', 'build_verified', 'waiting_for_release',
        'old_moved'
    ))
) STRICT;

CREATE TRIGGER IF NOT EXISTS apply_operations_of_an_apply
BEFORE INSERT ON apply_operations
WHEN (SELECT kind FROM project_operations WHERE id = NEW.operation_id) IS NOT 'apply'
    OR NEW.phase <> 'reserved'
BEGIN SELECT RAISE(ABORT, 'an Apply journal starts Reserved for an Apply operation'); END;

CREATE TRIGGER IF NOT EXISTS apply_operations_forward
BEFORE UPDATE ON apply_operations
WHEN OLD.phase = 'settled' OR NEW.operation_id IS NOT OLD.operation_id
    OR NEW.project_id IS NOT OLD.project_id OR NEW.generation IS NOT OLD.generation
    OR (
        CASE NEW.phase
            WHEN 'reserved' THEN 0 WHEN 'sources_verified' THEN 1 WHEN 'building' THEN 2
            WHEN 'build_verified' THEN 3 WHEN 'waiting_for_release' THEN 4
            WHEN 'old_moved' THEN 5 WHEN 'new_installed' THEN 6
            WHEN 'manifest_committed' THEN 7 WHEN 'foreign_transferred' THEN 8
            WHEN 'retiring_previous' THEN 9 ELSE 10
        END
    ) < (
        CASE OLD.phase
            WHEN 'reserved' THEN 0 WHEN 'sources_verified' THEN 1 WHEN 'building' THEN 2
            WHEN 'build_verified' THEN 3 WHEN 'waiting_for_release' THEN 4
            WHEN 'old_moved' THEN 5 WHEN 'new_installed' THEN 6
            WHEN 'manifest_committed' THEN 7 WHEN 'foreign_transferred' THEN 8
            WHEN 'retiring_previous' THEN 9 ELSE 10
        END
    )
BEGIN SELECT RAISE(ABORT, 'an Apply moves forward through its phases and settles once'); END;

-- An Apply's Project operation settles only after its journal has.
CREATE TRIGGER IF NOT EXISTS project_operations_apply_settled
BEFORE UPDATE OF state ON project_operations
WHEN NEW.state = 'settled' AND OLD.kind = 'apply' AND EXISTS (
    SELECT 1 FROM apply_operations WHERE operation_id = OLD.id AND phase <> 'settled'
)
BEGIN SELECT RAISE(ABORT, 'an Apply settles its journal first'); END;

-- The files PlateVault didn't place, as the Apply sheet listed them with the
-- user's tick (VSEL-FR-20); `evidence` is `EntryEvidence` JSON. Only a ticked
-- file moves, after the swap.
CREATE TABLE IF NOT EXISTS apply_foreign_items (
    operation_id TEXT NOT NULL REFERENCES apply_operations (operation_id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    path_key BLOB NOT NULL,
    evidence TEXT NOT NULL,
    ticked INTEGER NOT NULL CHECK (ticked IN (0, 1)),
    state TEXT NOT NULL CHECK (state IN ('pending', 'moved', 'stayed', 'failed')),
    reason TEXT,
    PRIMARY KEY (operation_id, seq),
    UNIQUE (operation_id, path_key),
    CHECK (state <> 'moved' OR ticked = 1),
    CHECK ((state = 'failed') = (reason IS NOT NULL))
) STRICT;

-- What an Apply left behind (STO-FR-10): changed or unverifiable copies,
-- unticked files and links that failed the no-follow check, today in
-- `View (previous)/`. Apply waits until the user has reviewed each (D-W110),
-- and a kept file is not asked about again (decision record §9). Paths are
-- relative to the Project folder: where kept files go when the next outgoing
-- View arrives is still open with the owner.
CREATE TABLE IF NOT EXISTS view_previous_items (
    project_id TEXT NOT NULL REFERENCES projects (id),
    path_key BLOB NOT NULL,
    reason TEXT NOT NULL CHECK (
        reason IN ('changed_copy', 'unverified_copy', 'unticked_file', 'unverified_link')
    ),
    evidence TEXT NOT NULL,
    review TEXT NOT NULL CHECK (review IN ('pending', 'kept', 'moved', 'trashed')),
    operation_id TEXT,
    recorded_at TEXT NOT NULL,
    reviewed_at TEXT,
    PRIMARY KEY (project_id, path_key),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id),
    CHECK ((review = 'pending') = (reviewed_at IS NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS view_previous_items_reviewed_once
BEFORE UPDATE OF review ON view_previous_items
WHEN OLD.review <> 'pending' AND NEW.review IS NOT OLD.review
    AND NOT (OLD.review = 'kept' AND NEW.review IN ('moved', 'trashed'))
BEGIN SELECT RAISE(ABORT, 'a reviewed leftover is not asked about again'); END;

CREATE TRIGGER IF NOT EXISTS project_operations_previous_reviewed
BEFORE INSERT ON project_operations
WHEN NEW.kind = 'apply' AND EXISTS (
    SELECT 1 FROM view_previous_items WHERE project_id = NEW.project_id AND review = 'pending'
)
BEGIN
    SELECT RAISE(ABORT, 'Apply waits until every file left in View (previous)/ is reviewed');
END;

-- A Closed snapshot freezes the last View that was installed, or none when
-- the Project was never applied.
CREATE TRIGGER IF NOT EXISTS project_snapshots_applied_view
BEFORE INSERT ON project_snapshots
WHEN NEW.applied_generation IS NOT (
    SELECT max(generation) FROM view_manifests
    WHERE project_id = NEW.project_id AND installed_at IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'a Closed snapshot freezes the last applied View, or none if never applied');
END;
