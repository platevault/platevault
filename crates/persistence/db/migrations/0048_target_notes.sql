-- Migration 0048: target notes field (spec 023 US4).
--
-- Adds an editable `notes` column to `canonical_target` so users can attach
-- free-text observing notes to any canonical target.
--
-- ADDITIVE + nullable: the column has no default; existing rows receive NULL.
-- Consistent with the nullable pattern used in migration 0033 and 0046.
--
-- Constitution §I : metadata-only; no filesystem mutations.
-- Constitution §V : SQLite is the durable record; notes are persisted directly.

ALTER TABLE canonical_target ADD COLUMN notes TEXT;
