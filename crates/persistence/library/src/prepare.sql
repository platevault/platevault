-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Application preparation (spec 069 PREP-FR-01..11, PREP-FR-14): handoff
-- profiles with their capability evidence, preparation revisions of a run,
-- each in its own new folder, the entries each revision created or passed
-- through with their source snapshots, and the Results folder every revision
-- of a run shares. Paths are native-path JSON. A revision's folder is never
-- recorded twice, and a run has at most one Running revision.

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('wbpp', 'siril', 'seti', 'generic')),
    executable TEXT,
    -- Launch arguments: a JSON array of strings.
    args TEXT NOT NULL,
    capability_evidence TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS preparation_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT NOT NULL REFERENCES views (id),
    n INTEGER NOT NULL CHECK (n > 0),
    membership_revision INTEGER NOT NULL CHECK (membership_revision > 0),
    profile_id TEXT NOT NULL REFERENCES profiles (id),
    mode TEXT NOT NULL CHECK (mode IN ('linked_view', 'direct_source', 'copy', 'clone')),
    link TEXT CHECK (link IS NULL OR link IN ('symlink', 'hardlink')),
    -- The parent chosen for this revision: the next review's default.
    output TEXT NOT NULL,
    folder TEXT NOT NULL UNIQUE,
    results_folder TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('running', 'prepared', 'partial', 'failed', 'canceled', 'paused')
    ),
    reason TEXT,
    -- The run group preparation (Prepare all) this revision belongs to.
    group_preparation_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE (view_id, n),
    CHECK ((mode = 'linked_view') = (link IS NOT NULL)),
    CHECK ((state = 'running') = (finished_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS preparation_revisions_running
    ON preparation_revisions (view_id) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS prepared_entries (
    prep_id TEXT NOT NULL REFERENCES preparation_revisions (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    -- The membership's logical capture; null for a calibration input.
    member_key TEXT,
    asset_id TEXT,
    master_id TEXT,
    input TEXT NOT NULL CHECK (input IN ('light', 'bias', 'dark', 'flat')),
    kind TEXT NOT NULL CHECK (
        kind IN ('symlink', 'hardlink', 'copy', 'clone', 'direct_source')
    ),
    path TEXT NOT NULL,
    source TEXT,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    -- The D19 basis JSON its snapshot must match, as Prepare planned it:
    -- the membership copy's or the calibration assignment's fingerprint.
    basis TEXT,
    -- The reviewed header change JSON an isolated patched Copy or Clone
    -- carries (PREP-FR-03); null for every other entry.
    header_changes TEXT,
    -- Entry evidence JSON of the source snapshot and of the written entry.
    source_evidence TEXT,
    source_sha256 TEXT,
    entry_identity TEXT,
    -- A copy's partial file, recorded by identity before any byte is written.
    written TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'prepared', 'blocked', 'drifted')),
    reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (prep_id, seq),
    CHECK ((state IN ('blocked', 'drifted')) = (reason IS NOT NULL)),
    CHECK (state <> 'prepared' OR source_sha256 IS NOT NULL)
) STRICT;

-- A run's Results folder (kind 'run'), a panel run's ('panel') or a run
-- group's assembled mosaic ('assembled'); every revision shares it.
CREATE TABLE IF NOT EXISTS results_folders (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT REFERENCES views (id),
    group_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('run', 'panel', 'assembled')),
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    CHECK ((view_id IS NULL) <> (group_id IS NULL)),
    CHECK ((kind = 'assembled') = (group_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS results_folders_view
    ON results_folders (view_id) WHERE view_id IS NOT NULL;
