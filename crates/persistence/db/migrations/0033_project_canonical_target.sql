-- Migration 0033: project → spec-035 canonical_target association (spec 035 US1 #2).
--
-- Persists the canonical target a user selects in the project-creation
-- TargetSearch. ADDITIVE + nullable: a new `projects.canonical_target_id`
-- column referencing the spec-035 `canonical_target` table (migration 0031).
--
-- This COEXISTS with the legacy spec-013 `projects.target_id` column (added in
-- migration 0027, → old `targets` table); the legacy column is NOT touched or
-- removed. Reconciling the two target models is a separate future decision.
--
-- NOTE ON NUMBERING: the next free forward-migration number is 0033 (0031 is the
-- spec-035 resolution schema; 0032 is unused). Append-only: prior migrations are
-- not edited.
--
-- SQLite supports a column-level FK reference in `ALTER TABLE ADD COLUMN` when
-- the column is nullable with no default (same pattern migration 0027 used for
-- `projects.target_id`). Existing rows get NULL; existing columns/data untouched.

ALTER TABLE projects ADD COLUMN canonical_target_id TEXT REFERENCES canonical_target(id);

CREATE INDEX IF NOT EXISTS idx_projects_canonical_target_id
    ON projects(canonical_target_id);
