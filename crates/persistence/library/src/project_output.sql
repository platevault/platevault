-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- A Project's `Output/` observations and the once-only offer of a generated
-- master found in its `Processing/` (spec 070 RES-FR-01/02/08/11, CAL-FR-06;
-- D-W93, D-W98). Every file in `Output/` is a Result: nothing is accepted and
-- nothing records which inputs produced it. Paths are native-path keys
-- relative to `Output/` or `Processing/`; `observation` is shared-model
-- `OutputObservation` JSON whose key fields the columns repeat.

CREATE TABLE IF NOT EXISTS project_outputs (
    project_id TEXT NOT NULL REFERENCES projects (id),
    path_key BLOB NOT NULL,
    observation TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('settling', 'settled', 'unreadable')),
    origin TEXT NOT NULL CHECK (origin IN ('observed', 'copied')),
    -- The panel group whose `Output/Panels/` folder holds the file.
    panel_group_id TEXT,
    -- The digest Copy to Output verified; the watcher never hashes.
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    first_seen_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path_key),
    CHECK (origin <> 'copied' OR sha256 IS NOT NULL),
    CHECK (json_extract(observation, '$.state') = state),
    CHECK (json_extract(observation, '$.origin') = origin),
    CHECK (json_extract(observation, '$.panelGroupId') IS panel_group_id),
    CHECK (json_extract(observation, '$.sha256') IS sha256)
) STRICT;

CREATE TRIGGER IF NOT EXISTS project_outputs_panel_insert
BEFORE INSERT ON project_outputs
WHEN NEW.panel_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_groups
    WHERE id = NEW.panel_group_id AND project_id = NEW.project_id AND panel = 1
)
BEGIN SELECT RAISE(ABORT, 'an Output file belongs only to a panel group of its Project'); END;

CREATE TRIGGER IF NOT EXISTS project_outputs_panel_update
BEFORE UPDATE OF panel_group_id ON project_outputs
WHEN NEW.panel_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_groups
    WHERE id = NEW.panel_group_id AND project_id = NEW.project_id AND panel = 1
)
BEGIN SELECT RAISE(ABORT, 'an Output file belongs only to a panel group of its Project'); END;

-- CAL's once-only offer (`ProcessingMasterOffer` JSON in `offer`): a digest
-- is offered once per Project, whatever path a rerun writes it to.
CREATE TABLE IF NOT EXISTS processing_master_offers (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id),
    path_key BLOB NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    kind TEXT NOT NULL CHECK (kind IN ('bias', 'dark', 'flat')),
    offer TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('offered', 'dismissed', 'adopted')),
    offered_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE (project_id, sha256),
    CHECK ((state = 'offered') = (decided_at IS NULL))
) STRICT;
