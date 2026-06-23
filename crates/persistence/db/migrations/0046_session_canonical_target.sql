-- Migration 0046: acquisition_session → spec-035 canonical_target link (spec 035 US4 / FR-016).
--
-- Persists the resolved canonical target an ingested light frame's session
-- groups under, plus an observer-location marker for the observing-night key.
-- ADDITIVE + nullable, mirroring migration 0033 (projects.canonical_target_id):
--
--   * `canonical_target_id` — nullable FK → the spec-035 `canonical_target`
--     table (migration 0031). NULL until the FITS `OBJECT` value resolves
--     (cache hit inline, else back-filled by the background resolver drain).
--     COEXISTS with the legacy spec-013 `acquisition_session.target_id` column
--     (→ old `target` table, migration 0002); the legacy column is NOT touched
--     (R10 — different id-space; writing a spec-035 id there would FK-violate).
--   * `has_observer_location` — 0 when the observing-night boundary was computed
--     in UTC because the observer geographic location was unset (R11 degraded
--     mode); 1 once a real location is used. Default 0 (additive, NOT NULL).
--
-- SQLite supports a column-level FK reference in `ALTER TABLE ADD COLUMN` when
-- the column is nullable with no default (same pattern as 0027/0033). Existing
-- rows get NULL / 0; existing columns and data are untouched.
--
-- NOTE ON NUMBERING: append-only. 0045 is the latest prior migration; prior
-- migrations are not edited.

ALTER TABLE acquisition_session
    ADD COLUMN canonical_target_id TEXT REFERENCES canonical_target(id);

ALTER TABLE acquisition_session
    ADD COLUMN has_observer_location INTEGER NOT NULL DEFAULT 0;

-- Covering index for the Sessions read-path JOIN and the back-fill drain query
-- (both filter on a non-null canonical_target_id).
CREATE INDEX IF NOT EXISTS idx_acq_session_canonical_target
    ON acquisition_session(canonical_target_id)
    WHERE canonical_target_id IS NOT NULL;

-- R12(b): the ingest upsert groups frames by `session_key`. Idempotency is
-- enforced in the use case (`ingest_sessions::upsert_session` does a
-- SELECT-by-session_key then INSERT-or-append, set-deduping `frame_ids`), so a
-- DB UNIQUE constraint is NOT added here — pre-spec-035 rows may legitimately
-- share a placeholder key (e.g. legacy `'{}'` fixtures), which a UNIQUE index
-- would reject. A non-unique lookup index keeps the grouping SELECT fast.
CREATE INDEX IF NOT EXISTS idx_acq_session_session_key
    ON acquisition_session(session_key);
