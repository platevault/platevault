-- Migration 0025: processing_artifacts + classification_overrides (spec 012, T001)
--
-- Records output files observed under a project's output folder.
-- The app NEVER writes to observed files; observation is read-only (constitution III).
-- `tool_launch_id` is set by the attribution pass (spec 012 T022/T022b).
-- `completed_at` on `tool_launches` is updated by spec 012's attribution pass.
--
-- ArtifactKind:        intermediate | master | final
-- ArtifactState:       present | missing | user_resolved_missing
-- ClassificationSource: rule | manual_override | fallback

CREATE TABLE IF NOT EXISTS processing_artifacts (
    id                         TEXT    NOT NULL PRIMARY KEY,  -- UUID (C4)
    project_id                 TEXT    NOT NULL,
    tool_launch_id             TEXT    NULL      REFERENCES tool_launches(id),
    path                       TEXT    NOT NULL,              -- project-relative
    kind                       TEXT    NOT NULL CHECK (kind IN ('intermediate','master','final')),
    tool                       TEXT    NOT NULL,              -- workflow-profile tool id
    detected_at                TEXT    NOT NULL,              -- RFC-3339; app-clock (R-AppClock)
    last_seen_at               TEXT    NOT NULL,              -- updated on every reconciliation pass
    state                      TEXT    NOT NULL DEFAULT 'present'
                                       CHECK (state IN ('present','missing','user_resolved_missing')),
    classification_confidence  REAL    NOT NULL CHECK (classification_confidence >= 0.0 AND classification_confidence <= 1.0),
    classification_source      TEXT    NOT NULL CHECK (classification_source IN ('rule','manual_override','fallback')),
    size_bytes                 INTEGER NOT NULL,
    file_mtime                 TEXT    NOT NULL,              -- stored; NOT used for attribution
    content_hash               TEXT    NULL,                  -- hex SHA-256; updated in-place on rerun (A8)
    UNIQUE (project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project
    ON processing_artifacts (project_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_state
    ON processing_artifacts (state);

CREATE TABLE IF NOT EXISTS classification_overrides (
    artifact_id  TEXT NOT NULL PRIMARY KEY REFERENCES processing_artifacts(id),
    kind         TEXT NOT NULL CHECK (kind IN ('intermediate','master','final')),
    created_at   TEXT NOT NULL,
    reason       TEXT NULL
);

-- Update tool_launches.completed_at via the attribution pass (spec 012 T022c).
-- The column already exists as NULL from migration 0024; no schema change needed.
