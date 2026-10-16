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

-- A Closed Project's Output step is read-only (RES-FR-07): its observations,
-- Kinds and Channels stay as they were when it closed.
CREATE TRIGGER IF NOT EXISTS project_outputs_open_insert
BEFORE INSERT ON project_outputs
WHEN (SELECT lifecycle FROM projects WHERE id = NEW.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project''s Output is read-only'); END;

CREATE TRIGGER IF NOT EXISTS project_outputs_open_update
BEFORE UPDATE ON project_outputs
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
    OR NEW.project_id IS NOT OLD.project_id OR NEW.path_key IS NOT OLD.path_key
BEGIN SELECT RAISE(ABORT, 'a Closed Project''s Output is read-only'); END;

CREATE TRIGGER IF NOT EXISTS project_outputs_open_delete
BEFORE DELETE ON project_outputs
WHEN (SELECT lifecycle FROM projects WHERE id = OLD.project_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a Closed Project''s Output is read-only'); END;

-- A Copy to Output in flight (RES-FR-02): the Project's `copy_to_output`
-- operation, the storage journal operation that copies the file, and the
-- `OutputObservation` JSON it lists once the copy verifies. The row goes when
-- the copy settles, so nothing durable links a Result to its source.
CREATE TABLE IF NOT EXISTS output_copies (
    operation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    storage_operation_id TEXT NOT NULL UNIQUE REFERENCES storage_operations (id),
    path_key BLOB NOT NULL,
    observation TEXT NOT NULL,
    UNIQUE (project_id, path_key),
    FOREIGN KEY (project_id, operation_id) REFERENCES project_operations (project_id, id),
    CHECK (json_extract(observation, '$.origin') = 'copied'),
    CHECK (json_extract(observation, '$.sha256') IS NOT NULL)
) STRICT;

CREATE TRIGGER IF NOT EXISTS output_copies_reserved
BEFORE INSERT ON output_copies
WHEN NOT EXISTS (
    SELECT 1 FROM project_operations
    WHERE id = NEW.operation_id AND project_id = NEW.project_id AND kind = 'copy_to_output'
        AND state = 'active'
)
BEGIN SELECT RAISE(ABORT, 'a Copy to Output runs under the Project''s active copy operation'); END;

-- A Copy to Output's operation settles only after its copy has.
CREATE TRIGGER IF NOT EXISTS project_operations_copy_settled
BEFORE UPDATE OF state ON project_operations
WHEN NEW.state = 'settled' AND OLD.kind = 'copy_to_output' AND EXISTS (
    SELECT 1 FROM output_copies WHERE operation_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'a Copy to Output settles its copy first'); END;

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
