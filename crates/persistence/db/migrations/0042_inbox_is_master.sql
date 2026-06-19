-- Migration 0042: add is_master + master_detector to inbox_classification_evidence
--
-- Spec 040 (calibration master detection) introduces a per-file flag that
-- distinguishes stacked masters from raw sub-frames.
--
-- is_master        — 0 = sub-frame, 1 = detected calibration master.
-- master_detector  — provenance string from the detector (e.g. "siril",
--                    "pixinsight"). NULL when is_master = 0.

ALTER TABLE inbox_classification_evidence
    ADD COLUMN is_master       INTEGER NOT NULL DEFAULT 0
        CHECK (is_master IN (0, 1));

ALTER TABLE inbox_classification_evidence
    ADD COLUMN master_detector TEXT;
