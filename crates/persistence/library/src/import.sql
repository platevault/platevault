-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Import (spec 071 STO-IMP-FR-01..06/08). A saved source is a folder the OS
-- has mounted, kept under a name for Import new. An import operation records
-- the preview the user approved: one item per source file with its settle
-- observation, reviewed evidence (fingerprint and SHA-256), header metadata,
-- route and phase. Items carry the storage journal item of their transfer, so
-- a resumed import decides from recorded identities, never from file names.
-- Paths are lossless native keys; structured evidence is JSON of the model.

CREATE TABLE IF NOT EXISTS import_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    path BLOB NOT NULL UNIQUE,
    last_imported_at TEXT,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS import_operations (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT REFERENCES import_sources (id),
    source_path BLOB NOT NULL,
    -- The source folder's identity as the preview observed it (JSON): another
    -- folder at the path, or an unmounted share's mount point, is not the source.
    source_identity TEXT NOT NULL,
    mode TEXT CHECK (mode IS NULL OR mode IN ('copy', 'move')),
    state TEXT NOT NULL CHECK (state IN ('previewed', 'running', 'interrupted', 'settled')),
    -- The location chosen per role where a role has several.
    choices TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    settled_at TEXT,
    CHECK ((state = 'previewed') = (mode IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS import_operations_source ON import_operations (source_id, created_at);

CREATE TABLE IF NOT EXISTS import_items (
    op_id TEXT NOT NULL REFERENCES import_operations (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    source_path BLOB NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    -- Header frame type (NULL: Unclassified) and the type the user set.
    classification TEXT,
    user_type TEXT,
    destination_location_id TEXT REFERENCES locations (id),
    destination_path BLOB,
    phase TEXT NOT NULL CHECK (phase IN (
        'ready', 'unclassified', 'settling', 'duplicate', 'blocked', 'excluded',
        'pending', 'landed', 'copied', 'moved', 'source_kept', 'failed', 'uncertain'
    )),
    -- Custody reason of a failed, kept or uncertain transfer.
    reason TEXT,
    -- The rest of the item and its evidence.
    detail TEXT NOT NULL,
    storage_op_id TEXT REFERENCES storage_operations (id),
    storage_seq INTEGER,
    PRIMARY KEY (op_id, seq),
    UNIQUE (op_id, source_path),
    CHECK ((storage_op_id IS NULL) = (storage_seq IS NULL))
) STRICT;

-- Import new: frames imported earlier from the same saved source, by digest.
CREATE INDEX IF NOT EXISTS import_items_sha256 ON import_items (sha256) WHERE sha256 IS NOT NULL;
