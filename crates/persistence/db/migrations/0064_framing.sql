PRAGMA foreign_keys = ON;

-- Migration 0064: Framing layer (spec 008 Q27, F-Framing-1).
--
-- Adds the co-registerable integration unit that sits between a project and
-- its light sessions: `project → framing → session → frames`. See
-- specs/008-project-create-onboard-edit/data-model.md §Framing.
--
--   * `framing` — one row per suggested/user-adjusted grouping of light
--     sessions sharing target + optic-train + pointing + rotation within a
--     tolerance. All geometry columns are NOT NULL: a framing cannot exist
--     without a representative pointing/rotation (F-Framing-2 computes it).
--   * `framing_session` — membership join. `session_id` is UNIQUE: a light
--     session belongs to at most one framing (data-model.md Invariants).
--   * `projects.is_mosaic` — mosaic-mode flag (FR-017), default false,
--     backward-compatible with existing rows.
--   * Durable session-level clustering key: nullable `pointing_ra_deg`,
--     `pointing_dec_deg`, `rotation_deg`, `optic_train_key` columns on
--     `acquisition_session`. **Nullable is intentional** (Q16 null
--     semantics) — legacy rows keep NULL geometry and are excluded from
--     clustering until backfilled via rescan (Q28); NEVER default to 0.
--     Populated at confirm time by a later node (F-Framing-2/5/10); this
--     migration only adds the columns.
--
-- This node (F-Framing-1) adds schema + repository plumbing only. Clustering
-- (F-Framing-2), the merge/split/reassign use cases (F-Framing-3), and the
-- Q20/Q10 per-framing projections (F-Framing-7) are later nodes.

CREATE TABLE IF NOT EXISTS framing (
    id                      TEXT NOT NULL PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Nullable: FR-018 forbids OBJECT/panel-name attribution; a framing may
    -- exist before target resolution completes.
    target_id               TEXT REFERENCES canonical_target(id),
    -- Optic-train identity (Q12/Q17 grouping key).
    optic_train_key         TEXT NOT NULL,
    -- Representative FOV-relative pointing (circular-mean of members, R11a).
    pointing_ra_deg         REAL NOT NULL,
    pointing_dec_deg        REAL NOT NULL,
    rotation_deg            REAL NOT NULL,
    -- Snapshot of the tunable tolerance the clustering pass used (FR-014).
    -- `tolerance_pointing` is unit-agnostic (FOV-relative fraction, or the
    -- absolute-degree no-FOV fallback per research R11a); never an exact key.
    tolerance_pointing      REAL NOT NULL,
    tolerance_rotation_deg  REAL NOT NULL,
    -- 'suggested' | 'user_adjusted' (FR-015). Re-derivation MUST NEVER modify
    -- a 'user_adjusted' framing.
    clustering              TEXT NOT NULL DEFAULT 'suggested'
                                 CHECK (clustering IN ('suggested', 'user_adjusted')),
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_framing_project ON framing(project_id);
CREATE INDEX IF NOT EXISTS idx_framing_target  ON framing(target_id)
    WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS framing_session (
    framing_id  TEXT NOT NULL REFERENCES framing(id) ON DELETE CASCADE,
    -- UNIQUE: a light session belongs to at most one framing.
    session_id  TEXT NOT NULL UNIQUE REFERENCES acquisition_session(id) ON DELETE CASCADE,
    added_at    TEXT NOT NULL,
    PRIMARY KEY (framing_id, session_id)
);

-- ── project.is_mosaic (FR-017) ──────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN is_mosaic INTEGER NOT NULL DEFAULT 0;

-- ── acquisition_session durable clustering key (session-level geometry) ────
ALTER TABLE acquisition_session ADD COLUMN pointing_ra_deg  REAL;
ALTER TABLE acquisition_session ADD COLUMN pointing_dec_deg REAL;
ALTER TABLE acquisition_session ADD COLUMN rotation_deg     REAL;
ALTER TABLE acquisition_session ADD COLUMN optic_train_key  TEXT;

CREATE INDEX IF NOT EXISTS idx_acq_session_optic_train_key
    ON acquisition_session(optic_train_key)
    WHERE optic_train_key IS NOT NULL;
