-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- The OS Trash moves of a Done Project's Done / Archive sheet (spec 071
-- STO-FR-14/15/16, LIB-FR-18, D-W43, D-W70, D-W74). One row per approved
-- move that reached the storage journal, keyed by its journal operation, and
-- one per journal item naming the frame, intermediate or copy the approval
-- named. `recorded_at` is set once the catalog took the item's Trashed
-- outcome, so a resumed move records what an interruption left unrecorded.

CREATE TABLE IF NOT EXISTS trash_moves (
    op_id TEXT PRIMARY KEY NOT NULL REFERENCES storage_operations (id),
    project_id TEXT NOT NULL REFERENCES projects (id),
    offer TEXT NOT NULL CHECK (offer IN ('rejected_frames', 'intermediates', 'duplicate_copies')),
    project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
    -- Approved items refused before anything moved: model JSON.
    refused TEXT NOT NULL,
    created_at TEXT NOT NULL,
    settled_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS trash_moves_open
    ON trash_moves (project_id, offer) WHERE settled_at IS NULL;

CREATE TABLE IF NOT EXISTS trash_move_items (
    op_id TEXT NOT NULL REFERENCES trash_moves (op_id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    item_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets (id),
    result_id TEXT REFERENCES result_candidates (id),
    -- The Complete runs whose fixed membership lists a rejected frame (D-W52).
    complete_view_ids TEXT NOT NULL,
    recorded_at TEXT,
    PRIMARY KEY (op_id, seq),
    CHECK ((asset_id IS NULL) <> (result_id IS NULL))
) STRICT;
