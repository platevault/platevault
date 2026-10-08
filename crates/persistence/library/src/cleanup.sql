-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Run Clean up and Empty Trash (spec 071 STO-FR-01..05/10/17, RES-FR-10):
-- each recorded review of a run's removal, the storage journal operation
-- (storage.sql) that moves its entries, every item it names, and the folders
-- Empty Trash moves once they are empty. A review is replaced, never edited:
-- recording another review of the run withdraws one that never started. Rows
-- keep the run's id and name without a foreign key, because Empty Trash
-- removes the run record and its summary still names every item it left
-- behind. Paths are native-path JSON; reasons and roles are model JSON.

CREATE TABLE IF NOT EXISTS run_cleanups (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('clean_up', 'empty_trash')),
    view_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_name TEXT NOT NULL,
    results_ticked INTEGER NOT NULL CHECK (results_ticked IN (0, 1)),
    -- The Trash operation moving the recorded entries; none when none moves.
    op_id TEXT UNIQUE REFERENCES storage_operations (id),
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'running', 'settled')),
    created_at TEXT NOT NULL,
    settled_at TEXT,
    run_removed_at TEXT,
    CHECK (kind = 'empty_trash' OR (results_ticked = 0 AND run_removed_at IS NULL)),
    CHECK ((state = 'settled') = (settled_at IS NOT NULL)),
    CHECK (run_removed_at IS NULL OR state = 'settled')
) STRICT;
CREATE INDEX IF NOT EXISTS run_cleanups_view ON run_cleanups (view_id);
CREATE UNIQUE INDEX IF NOT EXISTS run_cleanups_one_running
    ON run_cleanups (view_id) WHERE state = 'running';

-- One listed item: moved by storage item `storage_seq` of the operation, or
-- left in place since review for `staying`. A prepared role names its entry.
CREATE TABLE IF NOT EXISTS run_cleanup_items (
    cleanup_id TEXT NOT NULL REFERENCES run_cleanups (id),
    n INTEGER NOT NULL CHECK (n >= 0),
    path TEXT NOT NULL,
    role TEXT NOT NULL CHECK (
        role IN ('symlink', 'hardlink', 'copy', 'clone', 'unprepared', 'result')
    ),
    prep_id TEXT,
    entry_seq INTEGER CHECK (entry_seq IS NULL OR entry_seq >= 0),
    storage_seq INTEGER CHECK (storage_seq IS NULL OR storage_seq >= 0),
    staying TEXT,
    PRIMARY KEY (cleanup_id, n),
    CHECK ((storage_seq IS NULL) <> (staying IS NULL)),
    CHECK ((prep_id IS NULL) = (entry_seq IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS run_cleanup_items_entry
    ON run_cleanup_items (prep_id, entry_seq) WHERE prep_id IS NOT NULL;

-- An Empty Trash folder: a prepared folder, or the Results folder when
-- ticked. It goes to the OS Trash only once nothing but empty folders remains
-- in it. Its identity is recorded at review and `retiring` before the move,
-- so a resumed folder is decided by identity, never by its name. A folder
-- that cannot go keeps `reason`; one kept only for entries that stay, which
-- are named themselves, keeps none.
CREATE TABLE IF NOT EXISTS run_cleanup_folders (
    cleanup_id TEXT NOT NULL REFERENCES run_cleanups (id),
    n INTEGER NOT NULL CHECK (n >= 0),
    path TEXT NOT NULL,
    role TEXT NOT NULL,
    identity TEXT,
    phase TEXT NOT NULL CHECK (phase IN ('pending', 'retiring', 'settled')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('trashed', 'blocked', 'uncertain')),
    reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (cleanup_id, n),
    CHECK ((phase = 'settled') = (outcome IS NOT NULL)),
    CHECK (phase = 'settled' OR identity IS NOT NULL)
) STRICT;

-- Restore is refused once Empty Trash has started removing the run: its
-- files are leaving and its record goes next (STO-FR-17).
CREATE TRIGGER IF NOT EXISTS views_restore_refused_while_emptied
BEFORE UPDATE OF trashed_at ON views
WHEN OLD.trashed_at IS NOT NULL AND NEW.trashed_at IS NULL
    AND EXISTS (
        SELECT 1 FROM run_cleanups
        WHERE view_id = OLD.id AND kind = 'empty_trash' AND state = 'running'
    )
BEGIN SELECT RAISE(ABORT, 'Empty Trash is removing this run; it cannot be restored'); END;
