-- Migration 0024: tool_launches table (spec 011, T003)
--
-- Records each attempt to launch a processing tool for a project.
-- `completed_at` is reserved for spec 012 (Processing Artifact Observation)
-- and is always NULL in v1 writes.
--
-- `outcome` values: spawned | spawn_failed | tool_not_configured | executable_not_found
-- `args_hash` = BLAKE3(canonicalized_executable_path || rendered_argv) — see data-model.md
CREATE TABLE IF NOT EXISTS tool_launches (
    id           TEXT    NOT NULL PRIMARY KEY,  -- UUID
    project_id   TEXT    NOT NULL,
    tool_id      TEXT    NOT NULL,              -- matches ToolProfile.id
    launched_at  TEXT    NOT NULL,              -- RFC-3339
    pid          INTEGER,                       -- OS PID; NULL when not surfaced before detach
    working_dir  TEXT,                          -- resolved cwd passed to the child
    args_hash    TEXT,                          -- BLAKE3 hex; NULL when failure before render
    outcome      TEXT    NOT NULL DEFAULT 'spawned',
    completed_at TEXT,                          -- reserved for spec 012; always NULL in v1
    audit_id     TEXT    NOT NULL               -- back-reference to events/audit table
);

CREATE INDEX IF NOT EXISTS tool_launches_project_launched
    ON tool_launches (project_id, launched_at DESC);
