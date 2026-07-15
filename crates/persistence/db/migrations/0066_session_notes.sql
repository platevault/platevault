-- Migration 0066: session notes field (#773).
--
-- Adds an editable `notes` column to both session tables the inventory
-- projection unifies (`acquisition_session` / `calibration_session`) so
-- post-hoc notes editing works for any inventory row, mirroring migration
-- 0048's `canonical_target.notes` column.
--
-- ADDITIVE + nullable: no default; existing rows receive NULL.
--
-- Constitution §I: metadata-only; no filesystem mutations.
-- Constitution §V: SQLite is the durable record; notes are persisted directly.

ALTER TABLE acquisition_session ADD COLUMN notes TEXT;
ALTER TABLE calibration_session ADD COLUMN notes TEXT;
