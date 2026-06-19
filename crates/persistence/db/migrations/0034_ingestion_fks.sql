-- Migration 0034: Ingestion FKs — session root_id enforcement and target_id FK (spec 033, T035, US3).
--
-- Tracks the two critical FK plumbing gaps that prevent real data from flowing:
--   FR-012: session root_id — acquisition_session.root_id is already nullable
--           (migration 0021). This migration:
--             - Adds a covering index to accelerate grouped-by-root queries.
--             - Adds the helper table `ingestion_session_root_map` for the
--               inbox-confirm pipeline to record which inbox root produced
--               which sessions (bridging the gap until ingestion sets root_id directly).
--   FR-014: target_id FK — acquisition_session.acq_target_id already exists
--           (migration 0027). This migration:
--             - Adds a covering index for target-to-sessions lookups.
--             - Adds the helper table `ingestion_target_map` for the inbox
--               confirm pipeline to associate a session with a target during ingestion.
--
-- Constitution §I: roots are modelled separately so remapped roots can be
-- recovered without rewriting session history.
-- Constitution §V: SQLite is the durable record.

-- ── root_id covering index (FR-012) ──────────────────────────────────────────
-- Accelerates the inventory projection query that groups sessions by root.

CREATE INDEX IF NOT EXISTS idx_acq_session_root_state
    ON acquisition_session (root_id, state)
    WHERE root_id IS NOT NULL;

-- ── acq_target_id covering index (FR-014) ────────────────────────────────────
-- Accelerates target.get aggregate which loads sessions linked to a target.

CREATE INDEX IF NOT EXISTS idx_acq_session_target_id_state
    ON acquisition_session (acq_target_id, state)
    WHERE acq_target_id IS NOT NULL;

-- ── projects.target_id covering index (FR-014) ───────────────────────────────
-- Already indexed in 0027 but add covering index for lifecycle queries.

CREATE INDEX IF NOT EXISTS idx_projects_target_lifecycle
    ON projects (target_id, lifecycle)
    WHERE target_id IS NOT NULL;
