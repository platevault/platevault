-- Migration 0021: add root_id FK to acquisition_session and calibration_session (spec 006).
--
-- Inventory is a projection over library_root + sessions. To group sessions
-- by their source root, both session tables need a root_id reference.
--
-- The column is nullable with NULL meaning "root unknown / pre-migration row".
-- New sessions created by the inbox confirm pipeline (spec 005+) MUST supply
-- the root_id. Existing test/fixture rows silently retain NULL.
--
-- Constitution §I: roots are modelled separately from session paths so that
-- remapped roots can be recovered without rewriting session history.

ALTER TABLE acquisition_session ADD COLUMN root_id TEXT REFERENCES library_root(id);
ALTER TABLE calibration_session  ADD COLUMN root_id TEXT REFERENCES library_root(id);

CREATE INDEX IF NOT EXISTS idx_acq_session_root ON acquisition_session(root_id);
CREATE INDEX IF NOT EXISTS idx_cal_session_root ON calibration_session(root_id);
