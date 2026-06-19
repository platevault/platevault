-- Migration 0031: Plan-item safety fields (spec 033, T016, US1).
--
-- Adds the fields required for:
--   - FR-001/002 path-resolution gate (resolved_pattern)
--   - FR-003 destructive-confirm signal independent of is_protected (D9)
--   - FR-005 per-item audit completeness
--   - FR-007/D7 approval-time staleness baseline (approved_mtime, approved_size_bytes
--     already existed from migration 0014; this migration adds the new fields)
--   - FR-016/017 source identity (source_id, category)
--
-- Constitution §II: every plan item must carry the information needed to enforce
-- root-escape, symlink, staleness, destructive-confirm, and protection gates.
--
-- SQLite does not support ALTER TABLE ... ADD COLUMN with a CHECK constraint, so
-- we add the columns without constraints. Application code enforces the contract.

-- Source identity (FR-016: items must carry real source_id for protection resolution).
ALTER TABLE plan_items ADD COLUMN source_id TEXT;

-- Classification category (FR-016: used by resolve_protection).
ALTER TABLE plan_items ADD COLUMN category TEXT;

-- Explicit destructive-confirm signal (FR-003, D9).
-- Derived from action type: 1 = requires confirmation (delete/trash), 0 = does not.
-- Independent of is_protected. Replaces the plan_apply.rs:199 inversion.
ALTER TABLE plan_items ADD COLUMN requires_destructive_confirm INTEGER NOT NULL DEFAULT 0;

-- Resolved naming pattern snapshot at approval time (spec 005 gap).
ALTER TABLE plan_items ADD COLUMN resolved_pattern TEXT;

-- Index for quick lookup of items by source (for protection resolution and reporting).
CREATE INDEX IF NOT EXISTS plan_items_source ON plan_items (source_id)
    WHERE source_id IS NOT NULL;
