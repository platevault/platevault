-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Trash episodes of frames the storage custody moved to the OS Trash (LIB-FR-18,
-- D-W43). An episode names the storage operation that trashed the frame
-- and the SHA-256 that operation verified immediately before the move. A
-- rescan that finds the recorded path again closes the episode with
-- put_back_at; the row stays as history. At most one episode per asset is open.
CREATE TABLE IF NOT EXISTS asset_trash_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL REFERENCES assets (id),
    storage_operation_id TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    trashed_at TEXT NOT NULL,
    put_back_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS asset_trash_episodes_asset ON asset_trash_episodes (asset_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS asset_trash_episodes_open
    ON asset_trash_episodes (asset_id) WHERE put_back_at IS NULL;
