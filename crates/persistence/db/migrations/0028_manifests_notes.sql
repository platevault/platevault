-- Migration 0028: manifests + project_notes (spec 024)
--
-- `manifests`: one row per auto-generated project manifest snapshot.
-- `project_notes`: one row per project, one-note-per-project invariant.
--
-- Constitution I:  manifest path is project-relative; absolute resolution uses
--                  the library-root abstraction from feature 001.
-- Constitution II: manifest files are never overwritten; a new row = new file.
-- Constitution V:  SQLite rows are the durable index; files are projections.
--
-- ManifestReason: created | source_change | lifecycle_transition |
--                 cleanup_applied | workflow_run

CREATE TABLE IF NOT EXISTS manifests (
    id          TEXT    NOT NULL PRIMARY KEY,   -- UUID (C4)
    project_id  TEXT    NOT NULL REFERENCES projects(id),
    reason      TEXT    NOT NULL CHECK (reason IN (
                    'created','source_change','lifecycle_transition',
                    'cleanup_applied','workflow_run'
                )),
    timestamp   TEXT    NOT NULL,               -- RFC-3339 UTC
    path        TEXT    NOT NULL,               -- project-relative, e.g. notes/manifest-…md
    version     INTEGER NOT NULL DEFAULT 1,     -- front-matter schema version
    body_json   TEXT    NOT NULL DEFAULT '{}'   -- JSON serialisation of ManifestBody
);

CREATE INDEX IF NOT EXISTS idx_manifests_project_ts
    ON manifests (project_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS project_notes (
    id          TEXT    NOT NULL PRIMARY KEY,   -- UUID (C4)
    project_id  TEXT    NOT NULL UNIQUE REFERENCES projects(id),
    updated_at  TEXT    NOT NULL,               -- RFC-3339 UTC
    content     TEXT    NOT NULL DEFAULT ''     -- ≤16 384 UTF-8 bytes enforced in app layer
);
