-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Archive and restore transfers of a Done Project's sessions (spec 071
-- STO-FR-06/07/08/13, D06, D-W69). A transfer is one reviewed approval; its
-- items are frame copies, each with its reviewed source snapshot, its
-- templated destination, the prepared entries that read it and the phase it
-- reached. The verified copy and the source retirement run through the
-- storage journal (storage.sql); `journal_seq` names the item there. A
-- repointed item moved the frame's catalog record to its destination copy,
-- so an asset's latest repointed item tells whether it shows Archived. Paths
-- are native-path JSON; evidence, references and holds are model JSON.

CREATE TABLE IF NOT EXISTS archive_transfers (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('archive', 'restore')),
    project_id TEXT NOT NULL REFERENCES projects (id),
    project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
    state TEXT NOT NULL CHECK (state IN ('reviewed', 'running', 'settled')),
    destinations TEXT NOT NULL,
    kept TEXT NOT NULL,
    expected_reclaim_bytes INTEGER NOT NULL CHECK (expected_reclaim_bytes >= 0),
    storage_op_id TEXT REFERENCES storage_operations (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (state = 'reviewed' OR storage_op_id IS NOT NULL OR state = 'settled')
) STRICT;

CREATE INDEX IF NOT EXISTS archive_transfers_running
    ON archive_transfers (project_id) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS archive_items (
    transfer_id TEXT NOT NULL REFERENCES archive_transfers (id),
    seq INTEGER NOT NULL CHECK (seq >= 0),
    session_id TEXT NOT NULL REFERENCES sessions (id),
    asset_id TEXT NOT NULL REFERENCES assets (id),
    source_location_id TEXT NOT NULL REFERENCES locations (id),
    source_path TEXT NOT NULL,
    destination_location_id TEXT NOT NULL REFERENCES locations (id),
    destination_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    -- The reviewed source snapshot; absent only for an item review held back.
    evidence TEXT,
    fallbacks TEXT NOT NULL,
    refs TEXT NOT NULL,
    hold TEXT,
    phase TEXT NOT NULL CHECK (phase IN (
        'pending', 'destination_verified', 'repairing', 'reference_updated', 'settled'
    )),
    outcome TEXT CHECK (outcome IN ('archived', 'source_retained', 'blocked', 'uncertain')),
    reason TEXT,
    journal_seq INTEGER CHECK (journal_seq IS NULL OR journal_seq >= 0),
    repointed_at TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (transfer_id, seq),
    CHECK ((phase = 'settled') = (outcome IS NOT NULL)),
    CHECK (hold IS NULL OR outcome = 'blocked'),
    CHECK (hold IS NOT NULL OR evidence IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS archive_items_repointed
    ON archive_items (asset_id, repointed_at) WHERE repointed_at IS NOT NULL;
