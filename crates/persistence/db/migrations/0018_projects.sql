-- Migration 0018: Projects (spec 008)
--
-- Introduces the `projects` table (identity, lifecycle, tool, path, notes,
-- channel drift flag, timestamps) and two child tables:
--   `project_sources`  — Inventory session links with snapshot fields.
--   `project_channels` — Inferred and manual channel labels.
--
-- Constitution I: path stored as library-root-relative; library_root_id is
-- a forward reference to the roots table (not enforced here; FK deferred to
-- spec 006 migration that formally creates the roots table).
--
-- Constitution V: this migration is the durable source of truth; generated
-- manifests and source views are reproducible projections (owned by other
-- specs).

CREATE TABLE IF NOT EXISTS projects (
    id                  TEXT        NOT NULL PRIMARY KEY,
    name                TEXT        NOT NULL,
    -- "PixInsight" | "Siril" | "Planetary Suite"
    tool                TEXT        NOT NULL,
    -- lifecycle states per spec 009 / domain_core::lifecycle::project::ProjectState
    lifecycle           TEXT        NOT NULL DEFAULT 'setup_incomplete',
    -- library-root-relative path (Constitution I: roots modelled separately)
    path                TEXT        NOT NULL,
    notes               TEXT,
    -- channel drift flag: set to 1 when sources are added after last channel review
    channel_drift       INTEGER     NOT NULL DEFAULT 0,
    created_at          TEXT        NOT NULL,
    updated_at          TEXT        NOT NULL,

    UNIQUE(name),
    UNIQUE(path)
);

CREATE TABLE IF NOT EXISTS project_sources (
    -- stable row identifier (UUID string)
    id                  TEXT        NOT NULL PRIMARY KEY,
    project_id          TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- hard reference to the Inventory/AcquisitionSession row
    inventory_session_id TEXT       NOT NULL,
    -- snapshot fields copied from the Inventory row at link time
    name_snapshot       TEXT        NOT NULL DEFAULT '',
    frames_snapshot     INTEGER     NOT NULL DEFAULT 0,
    filter_snapshot     TEXT        NOT NULL DEFAULT '',
    exposure_snapshot   TEXT        NOT NULL DEFAULT '',
    linked_at           TEXT        NOT NULL,

    UNIQUE(project_id, inventory_session_id)
);

CREATE TABLE IF NOT EXISTS project_channels (
    project_id          TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label               TEXT        NOT NULL,
    -- "inferred" | "manual"
    source              TEXT        NOT NULL DEFAULT 'inferred',
    added_at            TEXT        NOT NULL,

    PRIMARY KEY (project_id, label)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle ON projects(lifecycle);
CREATE INDEX IF NOT EXISTS idx_projects_tool      ON projects(tool);
CREATE INDEX IF NOT EXISTS idx_project_sources_project_id ON project_sources(project_id);
