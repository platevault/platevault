-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only

-- The Targets list (spec 072 PLAN-TGT-FR-01/10). My targets is the ★
-- favourites plus every subject of an open Project; only the favourites are
-- stored here, the subjects come from the Project tables on read.
CREATE TABLE IF NOT EXISTS target_favourites (
    target_id TEXT PRIMARY KEY NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
) STRICT;

-- Saved presets: the Show mode, catalogues, built-in preset and sort as one
-- JSON document. Built-in presets are defined in code and never stored.
CREATE TABLE IF NOT EXISTS targets_presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    -- Case-folded name; unique, so two presets never share a name.
    name_key TEXT NOT NULL UNIQUE,
    filters TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;
