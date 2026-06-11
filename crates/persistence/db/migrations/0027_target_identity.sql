-- Migration 0027: target identity extensions for spec 023.
--
-- Adds:
--   `target_aliases`                  — user-editable alias rows with normalized form.
--   `targets.notes`                   — per-target free-text note (max 16 KB).
--   `targets.updated_at`              — bumped on any field change.
--   `acquisition_session.target_id`   — nullable FK to spec 013 `targets` table.
--   `projects.target_id`              — nullable FK to spec 013 `targets` table.
--   `project_sources.target_id`       — nullable FK for per-source target association.
--
-- The existing `acquisition_session.target_id` column from migration 0002
-- references the old legacy `target` table.  This migration adds a new
-- `acq_target_id` column pointing at spec 013 `targets`. The legacy column
-- is kept to avoid breaking existing data; new code uses `acq_target_id`.
--
-- Constitution §I : target identity is metadata only; no image files are touched.
-- Constitution §V : SQLite is the durable record; `target_aliases` is canonical.

-- ── targets column additions ─────────────────────────────────────────────────

ALTER TABLE targets ADD COLUMN notes       TEXT;
ALTER TABLE targets ADD COLUMN updated_at  TEXT;

-- ── target_aliases ────────────────────────────────────────────────────────────
-- Stores each alias in both display form (user casing) and normalized form
-- (for uniqueness checks and Cmd+K search).

CREATE TABLE IF NOT EXISTS target_aliases (
    id               TEXT     PRIMARY KEY NOT NULL,  -- UUID
    target_id        TEXT     NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    alias_display    TEXT     NOT NULL,               -- user casing preserved for display
    alias_normalized TEXT     NOT NULL,               -- casefolded, whitespace-collapsed
    created_at       TEXT     NOT NULL,               -- RFC 3339 UTC

    -- Uniqueness of normalized form is global: the same alias cannot appear on
    -- two different targets.
    UNIQUE (alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_target_aliases_target_id
    ON target_aliases(target_id);

-- ── acquisition_session: new spec-023 target FK ───────────────────────────────
-- The spec 013 `targets` table (migration 0017) is the authoritative target
-- store. The legacy `target_id` column in `acquisition_session` references
-- the old `target` table and is retained for backward compatibility.
-- New code uses `acq_target_id` to reference spec 013 targets.

ALTER TABLE acquisition_session ADD COLUMN acq_target_id TEXT REFERENCES targets(id);

CREATE INDEX IF NOT EXISTS idx_acq_session_acq_target_id
    ON acquisition_session(acq_target_id);

-- ── projects: target FK ───────────────────────────────────────────────────────

ALTER TABLE projects ADD COLUMN target_id TEXT REFERENCES targets(id);

CREATE INDEX IF NOT EXISTS idx_projects_target_id
    ON projects(target_id);

-- ── project_sources: target FK ────────────────────────────────────────────────

ALTER TABLE project_sources ADD COLUMN target_id TEXT REFERENCES targets(id);

CREATE INDEX IF NOT EXISTS idx_project_sources_target_id
    ON project_sources(target_id);
