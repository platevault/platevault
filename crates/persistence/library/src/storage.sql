-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Storage custody journal (spec 071, STO-FR-04/05/07/08/12). One row per
-- reviewed operation and one per item. An item's phase is recorded before the
-- step it leads into can be observed on disk, so a resumed operation decides
-- from recorded identities and never from whether a file name is present.
-- `path` is a lossless native key; structured evidence is JSON of the model.

CREATE TABLE IF NOT EXISTS storage_operations (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('trash', 'copy', 'move')),
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'running', 'settled')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS storage_operations_open
    ON storage_operations (created_at) WHERE state <> 'settled';

CREATE TABLE IF NOT EXISTS storage_items (
    op_id TEXT NOT NULL REFERENCES storage_operations (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    path BLOB NOT NULL,
    -- Entry kind (file, or link with its target text) and no-follow fingerprint.
    identity TEXT NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    -- Retained originals and kept copies re-verified before the move.
    relied_on TEXT NOT NULL,
    destination TEXT,
    -- The partial copy a transfer wrote, by identity.
    written TEXT,
    phase TEXT NOT NULL CHECK (phase IN (
        'pending', 'writing', 'installed', 'destination_verified', 'retiring', 'settled'
    )),
    outcome TEXT CHECK (outcome IN (
        'trashed', 'copied', 'moved', 'source_kept', 'blocked', 'uncertain'
    )),
    reason TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (op_id, seq),
    CHECK ((phase = 'settled') = (outcome IS NOT NULL))
) STRICT;
