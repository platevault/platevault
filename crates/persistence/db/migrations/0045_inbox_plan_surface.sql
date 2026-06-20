-- Migration 0045: inbox plan-surface schema additions (spec 041, phase 2).
--
-- Changes:
--   1. Add organization_state column to registered_sources.
--   2. Backfill existing rows (inbox → unorganized, all others → organized).
--   3. Create inbox_file_metadata table (per-file extracted metadata store).
--   4. Add non-type override columns to inbox_classification_evidence.
--   5. Expand plan_items.action CHECK to include 'catalogue' (table rebuild).
--
-- Constitution §I: backfill sets existing non-inbox sources to 'organized' —
-- the safe custody-preserving default (existing libraries are already organized).
-- Constitution §II: catalogue action keeps every confirmation in the
-- reviewable-plan/audit pipeline even when no FS mutation occurs.

-- ── 1. Add organization_state to registered_sources ──────────────────────────
--
-- SQLite allows ADD COLUMN with a NOT NULL DEFAULT so we can add it in one step.
-- The default 'unorganized' covers the ADD; step 2 corrects non-inbox rows.

ALTER TABLE registered_sources
    ADD COLUMN organization_state TEXT NOT NULL DEFAULT 'unorganized'
        CHECK (organization_state IN ('organized', 'unorganized'));

-- ── 2. Backfill: non-inbox sources → organized ────────────────────────────────

UPDATE registered_sources
    SET organization_state = 'organized'
    WHERE kind != 'inbox';

-- ── 3. inbox_file_metadata ────────────────────────────────────────────────────
--
-- Stores per-file image-header metadata extracted during classify/reclassify.
-- Keyed by (inbox_item_id, relative_file_path), 1:1 with
-- inbox_classification_evidence (same path key). Written alongside the
-- evidence row; read by the detail panel and destination resolution.
--
-- identity columns (R-4): file_size_bytes + file_mtime drive override staleness.
-- override_stale is surfaced from inbox_classification_evidence; it is not
-- stored here (it lives on the evidence row alongside the override values).

CREATE TABLE IF NOT EXISTS inbox_file_metadata (
    id                   TEXT PRIMARY KEY NOT NULL,
    inbox_item_id        TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
    relative_file_path   TEXT NOT NULL,
    -- extracted image-header fields (all nullable — not all file types carry all fields)
    filter               TEXT,
    exposure_s           REAL,
    gain                 TEXT,
    binning_x            INTEGER,
    binning_y            INTEGER,
    temperature_c        REAL,
    object               TEXT,
    date_obs             TEXT,
    instrume             TEXT,
    telescop             TEXT,
    naxis1               INTEGER,
    naxis2               INTEGER,
    stack_count          INTEGER,
    -- cheap per-file identity for override staleness (R-4; no full-content hash)
    file_size_bytes      INTEGER,
    file_mtime           TEXT,
    UNIQUE (inbox_item_id, relative_file_path)
);

CREATE INDEX IF NOT EXISTS inbox_file_metadata_item
    ON inbox_file_metadata (inbox_item_id);

-- ── 4. Non-type override columns on inbox_classification_evidence ─────────────
--
-- SQLite does not support ADD COLUMN with a CHECK constraint; application code
-- enforces the allowed values (same pattern as migration 0039 for plan_items).
-- override_binning stores a human-readable string such as "2x2".
-- override_stale=1 when the file at the same path has a different size/mtime
-- than when the override was recorded (R-4).

ALTER TABLE inbox_classification_evidence
    ADD COLUMN override_filter   TEXT;

ALTER TABLE inbox_classification_evidence
    ADD COLUMN override_exposure_s REAL;

ALTER TABLE inbox_classification_evidence
    ADD COLUMN override_binning  TEXT;

ALTER TABLE inbox_classification_evidence
    ADD COLUMN override_stale    INTEGER NOT NULL DEFAULT 0;

-- ── 5. Expand plan_items.action CHECK to include 'catalogue' ─────────────────
--
-- SQLite cannot ALTER a CHECK constraint, so we use the table-rebuild pattern.
-- Preserve ALL columns, constraints, and indexes from migration 0029 +
-- columns added by migrations 0039 (source_id, category,
-- requires_destructive_confirm, resolved_pattern), 0015 (item_stale),
-- and 0041 (destructive_confirmed).
-- The only change is adding 'catalogue' to the action CHECK list.

PRAGMA foreign_keys = OFF;

CREATE TABLE plan_items_new_045 (
    id                          TEXT PRIMARY KEY NOT NULL,
    plan_id                     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    item_index                  INTEGER NOT NULL,
    name                        TEXT NOT NULL,
    action                      TEXT NOT NULL CHECK (action IN (
                                    'move', 'archive', 'delete', 'link', 'write',
                                    'mkdir', 'write_manifest', 'catalogue'
                                )),
    from_root_id                TEXT,
    from_relative_path          TEXT NOT NULL DEFAULT '',
    to_root_id                  TEXT,
    to_relative_path            TEXT NOT NULL DEFAULT '',
    reason                      TEXT NOT NULL DEFAULT '',
    protection                  TEXT NOT NULL DEFAULT 'normal'
                                    CHECK (protection IN ('normal', 'protected')),
    linked_entity               TEXT,
    item_state                  TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (item_state IN (
                                        'pending', 'applying', 'succeeded',
                                        'failed', 'skipped', 'cancelled'
                                    )),
    failure_reason              TEXT,
    provenance                  TEXT,
    approved_mtime              TEXT,
    approved_size_bytes         INTEGER,
    archive_path                TEXT,
    created_at                  TEXT NOT NULL,
    -- added by migration 0015
    item_stale                  INTEGER NOT NULL DEFAULT 0,
    -- added by migration 0039
    source_id                   TEXT,
    category                    TEXT,
    requires_destructive_confirm INTEGER NOT NULL DEFAULT 0,
    resolved_pattern            TEXT,
    -- added by migration 0041
    destructive_confirmed       INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plan_items_new_045 SELECT
    id, plan_id, item_index, name, action,
    from_root_id, from_relative_path, to_root_id, to_relative_path,
    reason, protection, linked_entity, item_state, failure_reason,
    provenance, approved_mtime, approved_size_bytes, archive_path, created_at,
    item_stale, source_id, category, requires_destructive_confirm, resolved_pattern,
    destructive_confirmed
FROM plan_items;

DROP TABLE plan_items;
ALTER TABLE plan_items_new_045 RENAME TO plan_items;

-- Recreate indexes that existed on plan_items (from 0019/0039).
CREATE INDEX IF NOT EXISTS plan_items_plan   ON plan_items (plan_id, item_index ASC);
CREATE INDEX IF NOT EXISTS plan_items_source ON plan_items (source_id)
    WHERE source_id IS NOT NULL;

PRAGMA foreign_keys = ON;
