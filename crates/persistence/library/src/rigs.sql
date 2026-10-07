-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only

-- Rig filter lists (spec 072 PLAN-EQ-FR-01). A rig is a saved `equipment`
-- row; its list is replaced whole in one transaction, so a failed save leaves
-- the previous list in effect. The list revision lives apart from the
-- equipment decision revision: editing filters never changes the rig record.
CREATE TABLE IF NOT EXISTS rig_filter_lists (
    equipment_id TEXT PRIMARY KEY NOT NULL REFERENCES equipment (id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rig_filters (
    id TEXT PRIMARY KEY NOT NULL,
    equipment_id TEXT NOT NULL REFERENCES rig_filter_lists (equipment_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    -- JSON array of the FITS FILTER values the filter matches.
    match_values TEXT NOT NULL,
    -- JSON array of the bands it passes, at least one.
    bands TEXT NOT NULL CHECK (json_array_length(bands) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (equipment_id, position)
) STRICT;
