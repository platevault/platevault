-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Handoff profiles (spec 069 PREP-FR-01/02) with their capability evidence.
-- A Project names the profile its View opens in (`projects.profile_id`).

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
