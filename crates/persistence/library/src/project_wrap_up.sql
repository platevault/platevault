-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Wrap up's own records (spec 065 PRJ-FR-14/15/25, 071 STO-FR-01/04/06/13 to
-- STO-FR-16; D-W43, D-W80, D-W97, D-W111): the View entries Clean up removed,
-- the files a Trash step moved, the files an archive moves and the kept-View
-- links it repointed. The file work itself runs through the storage journal
-- (storage.sql); each row here names its journal item by `seq`. Paths are
-- native-path keys relative to the location the row names; structured values
-- are shared-model JSON.

-- A View entry Clean up removed (STO-FR-01/04), by its manifest seq: a Closed
-- Project's kept View is its last installed manifest less these. Recorded
-- only by the Project's own Clean up while it is open, and kept.
CREATE TABLE IF NOT EXISTS view_entry_removals (
    project_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    operation_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('deleted', 'trashed')),
    removed_at TEXT NOT NULL,
    PRIMARY KEY (project_id, generation, seq),
    FOREIGN KEY (project_id, generation, seq)
        REFERENCES view_manifest_entries (project_id, generation, seq),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS view_entry_removals_by_clean_up
BEFORE INSERT ON view_entry_removals
WHEN NOT EXISTS (
    SELECT 1 FROM project_operations
    WHERE id = NEW.operation_id AND project_id = NEW.project_id AND kind = 'clean_up'
        AND state = 'active'
)
BEGIN SELECT RAISE(ABORT, 'only the Project''s running Clean up removes a View entry'); END;

CREATE TRIGGER IF NOT EXISTS view_entry_removals_kept_update
BEFORE UPDATE ON view_entry_removals
BEGIN SELECT RAISE(ABORT, 'a removal record is kept'); END;
CREATE TRIGGER IF NOT EXISTS view_entry_removals_kept_delete
BEFORE DELETE ON view_entry_removals
BEGIN SELECT RAISE(ABORT, 'a removal record is kept'); END;

-- One item a Trash step moves (PRJ-FR-15, STO-FR-14 to STO-FR-16): the row it
-- came from, the frame or copy it names, and whether the catalog took its
-- Trashed outcome. Only a ticked row is ever recorded here (D-W43).
CREATE TABLE IF NOT EXISTS wrap_up_trash_items (
    storage_operation_id TEXT NOT NULL REFERENCES storage_operations (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    project_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    trash_group TEXT NOT NULL CHECK (
        trash_group IN ('rejected_frames', 'processing_files', 'duplicate_copies')
    ),
    -- The frame's capture key or the duplicate copy's asset id.
    item_id TEXT,
    -- The library copy it moves; a Processing file is none.
    asset_id TEXT REFERENCES assets (id),
    recorded_at TEXT,
    PRIMARY KEY (storage_operation_id, seq),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id),
    CHECK ((trash_group = 'processing_files') = (asset_id IS NULL)),
    CHECK ((trash_group = 'processing_files') = (item_id IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS wrap_up_trash_items_operation
    ON wrap_up_trash_items (operation_id);

CREATE TRIGGER IF NOT EXISTS wrap_up_trash_items_by_trash
BEFORE INSERT ON wrap_up_trash_items
WHEN NOT EXISTS (
    SELECT 1 FROM project_operations
    WHERE id = NEW.operation_id AND project_id = NEW.project_id AND kind = 'trash'
        AND state = 'active'
)
BEGIN SELECT RAISE(ABORT, 'only the Project''s running Trash step records a move'); END;

-- One file an archive moves (STO-FR-06/07/13): its session, where it goes,
-- the kept-View links that read it (`KeptViewLink` JSON), and whether the
-- catalog record moved to the verified archive copy. Wrap up's archive names
-- its Project operation; Sessions > Archive has none.
CREATE TABLE IF NOT EXISTS archive_moves (
    storage_operation_id TEXT NOT NULL REFERENCES storage_operations (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    project_id TEXT,
    project_operation_id TEXT,
    session_id TEXT NOT NULL REFERENCES sessions (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    from_location_id TEXT NOT NULL REFERENCES locations (id),
    from_path BLOB NOT NULL,
    -- The record's observation the review read; the record moves only from it.
    from_fingerprint TEXT NOT NULL,
    to_location_id TEXT NOT NULL REFERENCES locations (id),
    to_path BLOB NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    links TEXT NOT NULL,
    repointed_at TEXT,
    outcome TEXT CHECK (outcome IN ('archived', 'source_retained', 'blocked', 'uncertain')),
    reason TEXT,
    PRIMARY KEY (storage_operation_id, seq),
    FOREIGN KEY (project_id, project_operation_id) REFERENCES project_operations (project_id, id),
    CHECK ((project_id IS NULL) = (project_operation_id IS NULL)),
    CHECK (outcome IS NOT 'archived' OR repointed_at IS NOT NULL),
    CHECK ((outcome IN ('blocked', 'uncertain', 'source_retained')) <= (reason IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS archive_moves_project_operation
    ON archive_moves (project_operation_id) WHERE project_operation_id IS NOT NULL;
-- The moves whose record left its source and whose original waits there to
-- be retired: new-capture discovery reads them per source location
-- (`Catalog::location_recorded_paths`). Settled rows, which are kept, stay out.
CREATE INDEX IF NOT EXISTS archive_moves_in_flight
    ON archive_moves (from_location_id) WHERE repointed_at IS NOT NULL AND outcome IS NULL;

CREATE TRIGGER IF NOT EXISTS archive_moves_settle_once
BEFORE UPDATE ON archive_moves
WHEN OLD.outcome IS NOT NULL
    OR NEW.storage_operation_id IS NOT OLD.storage_operation_id OR NEW.seq IS NOT OLD.seq
    OR NEW.asset_id IS NOT OLD.asset_id OR NEW.to_path IS NOT OLD.to_path
    OR (OLD.repointed_at IS NOT NULL AND NEW.repointed_at IS NOT OLD.repointed_at)
BEGIN SELECT RAISE(ABORT, 'an archive move settles once and keeps its identity'); END;

-- A kept-View link an archive repointed (D-W111, STO-FR-06): recorded beside
-- the frozen manifest, so a Closed Project's sessions, goals, snapshot and
-- Wrap up record stay unchanged. The entry's latest repoint names the target
-- it now reads, with the SHA-256 the transfer verified, and the link's own
-- identity, which a later no-follow check expects.
CREATE TABLE IF NOT EXISTS view_entry_repoints (
    project_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    storage_operation_id TEXT NOT NULL REFERENCES storage_operations (id),
    target_location_id TEXT NOT NULL REFERENCES locations (id),
    target_path BLOB NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    link_identity TEXT NOT NULL,
    repointed_at TEXT NOT NULL,
    PRIMARY KEY (project_id, generation, seq, storage_operation_id),
    FOREIGN KEY (project_id, generation, seq)
        REFERENCES view_manifest_entries (project_id, generation, seq)
) STRICT;

CREATE TRIGGER IF NOT EXISTS view_entry_repoints_kept_view
BEFORE INSERT ON view_entry_repoints
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS 'open'
BEGIN SELECT RAISE(ABORT, 'only a Closed Project''s kept View is repointed'); END;

CREATE TRIGGER IF NOT EXISTS view_entry_repoints_kept_update
BEFORE UPDATE ON view_entry_repoints
BEGIN SELECT RAISE(ABORT, 'a repoint record is kept'); END;
CREATE TRIGGER IF NOT EXISTS view_entry_repoints_kept_delete
BEFORE DELETE ON view_entry_repoints
BEGIN SELECT RAISE(ABORT, 'a repoint record is kept'); END;
