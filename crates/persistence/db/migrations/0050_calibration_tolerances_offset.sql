-- Migration 0050: add require_same_offset to calibration_tolerances (spec 043 P8).
--
-- The matching engine's `MatchingRuleConfig.require_same_offset` hard-rule
-- flag (crates/calibration/core/src/ranking.rs) has existed since the
-- original spec 007 implementation, but the singleton `calibration_tolerances`
-- table (migration 0008) never gained a column for it, and no repository or
-- command code read/wrote this table at all — the Tauri
-- `calibration.tolerances.get`/`update` commands were pure in-memory stubs.
-- This migration adds the missing column so the Offset "match required"
-- toggle (apps/desktop/src/features/settings/CalibrationMatching.tsx) can
-- persist for real. Defaults to 1 (true) to match
-- `MatchingRuleConfig::default().require_same_offset`, preserving current
-- matching behaviour for existing libraries.

ALTER TABLE calibration_tolerances
    ADD COLUMN require_same_offset INTEGER NOT NULL DEFAULT 1;
