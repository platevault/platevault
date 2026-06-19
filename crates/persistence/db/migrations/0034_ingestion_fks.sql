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

-- NOTE (spec 036 reconciliation): the FR-014 covering indices on the gen-2
-- target columns (acquisition_session.acq_target_id, projects.target_id) were
-- removed here — those columns were dropped when spec 036 retired the legacy
-- spec-013/023 target schema. Target↔session/project association now lives on
-- the spec-035 canonical_target model (projects.canonical_target_id).
