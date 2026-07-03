-- Migration 0048: Single-type sub-items at ingest (spec 041, iteration 2026-06-23).
--
-- Changes:
--   1. Create inbox_source_groups — one row per discovered leaf folder.
--   2. Rebuild inbox_items (table-rebuild: add source_group_id/group_key/
--      group_label/frame_type; replace UNIQUE(root_id, relative_path) with
--      UNIQUE(root_id, relative_path, group_key)).
--   3. Create inbox_file_overrides — generic per-file override table, replacing
--      the fixed override_filter/override_exposure_s/override_binning columns.
--   4. Rebuild inbox_classifications (table-rebuild: collapse result CHECK from
--      ('single_type','mixed','unclassified') to ('classified','unclassified')).
--   5. Extend inbox_file_metadata with additional extracted fields for grouping
--      (offset, set_temp_c, ccd_temp_c, pointing, rotation, optics, observer,
--      local-time, MJD fields) — all nullable.
--   6. Data-migrate existing inbox_classification_evidence override columns
--      (override_filter/override_exposure_s/override_binning/manual_override)
--      into inbox_file_overrides rows, then DROP those columns.
--
-- Constitution §I: image files remain on disk; only metadata/paths stored.
-- Constitution §II: per-file evidence and override records provide audit trail.
-- Constitution §V: DB is durable record; group derivation is reproducible.
--
-- NOTE ON NUMBERING: 0046 was taken by 0046_session_canonical_target.sql.
-- 0047 was assigned to 0047_target_constellation_magnitude.sql (fix #317,
-- resolving a duplicate-0046 collision from two independent PRs). The spec
-- data-model described this migration as "0047" before fix #317 landed on
-- origin/main; it is therefore numbered 0048 on this branch.
--
-- NOTE ON SESSION LIFECYCLE: the session review-state drop (T076, Phase 13)
-- is NOT part of this migration. It lands separately after Phase 12.

-- ── 1. inbox_source_groups ────────────────────────────────────────────────────
--
-- One row per discovered leaf folder; provides provenance for the N single-type
-- inbox_items that classify within it. Written at scan time; content_signature
-- and last_scanned_at refreshed on rescan; child_count updated by classify.
-- R-12: source group is the persistence anchor for overrides (file granularity).

CREATE TABLE IF NOT EXISTS inbox_source_groups (
    id                  TEXT        NOT NULL PRIMARY KEY,
    root_id             TEXT        NOT NULL,           -- FK to library root (Constitution §I)
    relative_path       TEXT        NOT NULL,           -- leaf folder relative to root
    discovered_at       TEXT        NOT NULL,
    last_scanned_at     TEXT        NOT NULL,
    content_signature   TEXT,                           -- folder-level signature (partial 65 KB read); lazy
    format              TEXT,                           -- dominant format: fits/xisf/video/mixed/NULL
    lane                TEXT,                           -- move-vs-catalogue (from source organization_state)
    child_count         INTEGER     NOT NULL DEFAULT 0, -- single-type sub-items from this group
    UNIQUE (root_id, relative_path)
);

CREATE INDEX IF NOT EXISTS inbox_source_groups_root
    ON inbox_source_groups (root_id);

-- ── 2. Rebuild inbox_items ────────────────────────────────────────────────────
--
-- SQLite cannot ALTER a UNIQUE index or remove columns, so we use the
-- table-rebuild pattern. The existing unique index was on (root_id,
-- relative_path); the new identity is (root_id, relative_path, group_key).
--
-- New columns added:
--   source_group_id  — FK to inbox_source_groups; NULL for legacy plan_open rows
--                      during migration (safe path per data-model RQ6).
--   group_key        — deterministic canonical serialisation of the R-9 identity
--                      tuple; '' (empty string sentinel) for pre-0047 rows to
--                      satisfy UNIQUE until they are reclassified.
--   group_label      — display label "(root) · <type> · <dims>"; NULL until classify.
--   frame_type       — authoritative per-item frame type; NULL until classified.
--
-- Columns preserved from 0020 + ADD COLUMN migrations 0042/0043:
--   id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
--   content_signature, state, lane (0020)
--   format, is_master_item, master_frame_type, master_filter,
--   master_exposure_s (0043)
--
-- Migration data strategy for existing rows:
--   - group_key = '' (empty sentinel — unique enough per (root_id,relative_path)
--     since the composite (root_id, relative_path, '') maps 1:1 with the old row).
--   - source_group_id = NULL (re-derivation happens on next classify after 0047).
--   - plan_open rows stay as single legacy sub-items per data-model RQ6.

PRAGMA foreign_keys = OFF;

CREATE TABLE inbox_items_new_047 (
    id                  TEXT        NOT NULL PRIMARY KEY,
    root_id             TEXT        NOT NULL,
    relative_path       TEXT        NOT NULL,
    source_group_id     TEXT        REFERENCES inbox_source_groups(id) ON DELETE SET NULL,
    group_key           TEXT        NOT NULL DEFAULT '',  -- empty sentinel for legacy rows
    group_label         TEXT,
    frame_type          TEXT
                            CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    file_count          INTEGER     NOT NULL DEFAULT 0,
    discovered_at       TEXT        NOT NULL,
    last_scanned_at     TEXT        NOT NULL,
    content_signature   TEXT,
    state               TEXT        NOT NULL DEFAULT 'pending_classification'
                            CHECK (state IN (
                                'pending_classification',
                                'classified',
                                'plan_open',
                                'resolved'
                            )),
    lane                TEXT        NOT NULL DEFAULT 'fits'
                            CHECK (lane IN ('fits', 'video')),
    -- columns from migration 0043
    format              TEXT,
    is_master_item      INTEGER     NOT NULL DEFAULT 0
                            CHECK (is_master_item IN (0, 1)),
    master_frame_type   TEXT,
    master_filter       TEXT,
    master_exposure_s   REAL,
    UNIQUE (root_id, relative_path, group_key)
);

INSERT INTO inbox_items_new_047 (
    id, root_id, relative_path, source_group_id, group_key, group_label, frame_type,
    file_count, discovered_at, last_scanned_at, content_signature,
    state, lane, format, is_master_item, master_frame_type, master_filter, master_exposure_s
)
SELECT
    id, root_id, relative_path, NULL, '', NULL, NULL,
    file_count, discovered_at, last_scanned_at, content_signature,
    state, lane, format, is_master_item, master_frame_type, master_filter, master_exposure_s
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new_047 RENAME TO inbox_items;

-- Recreate indexes that existed on inbox_items (from 0020).
-- The old unique index (root_id, relative_path) is replaced by the table-level
-- UNIQUE(root_id, relative_path, group_key) constraint above.
-- Keep a non-unique index on (root_id, relative_path) for fast path-based lookups.
CREATE INDEX IF NOT EXISTS inbox_items_root_path
    ON inbox_items (root_id, relative_path);

CREATE INDEX IF NOT EXISTS inbox_items_source_group
    ON inbox_items (source_group_id)
    WHERE source_group_id IS NOT NULL;

PRAGMA foreign_keys = ON;

-- ── 3. inbox_file_overrides ───────────────────────────────────────────────────
--
-- Generic per-file override table replacing the fixed override_* columns on
-- inbox_classification_evidence. Keyed at (source_group_id, relative_file_path,
-- property_key) so overrides survive sub-item re-partitioning (R-13).
-- Overrides are app-side index metadata only — never written to FITS/XISF
-- (Constitution §I).
--
-- property_key values from the R-13 registry:
--   filter, exposureS, binning, frameType, temperatureC, gain, target, ...

CREATE TABLE IF NOT EXISTS inbox_file_overrides (
    id                  TEXT        NOT NULL PRIMARY KEY,
    source_group_id     TEXT        NOT NULL
                            REFERENCES inbox_source_groups(id) ON DELETE CASCADE,
    relative_file_path  TEXT        NOT NULL,           -- file within the source group
    property_key        TEXT        NOT NULL,           -- from R-13 property registry
    value               TEXT        NOT NULL,           -- typed per registry; stored as text/JSON
    file_size_bytes     INTEGER,                        -- staleness identity (R-4)
    file_mtime          TEXT,                           -- staleness identity (R-4)
    override_stale      INTEGER     NOT NULL DEFAULT 0, -- 1 when file size/mtime changed
    set_at              TEXT        NOT NULL,
    UNIQUE (source_group_id, relative_file_path, property_key)
);

CREATE INDEX IF NOT EXISTS inbox_file_overrides_group
    ON inbox_file_overrides (source_group_id);

CREATE INDEX IF NOT EXISTS inbox_file_overrides_group_file
    ON inbox_file_overrides (source_group_id, relative_file_path);

-- ── 4. Rebuild inbox_classifications ─────────────────────────────────────────
--
-- Collapses result CHECK from ('single_type','mixed','unclassified') to
-- ('classified','unclassified'). Mixed folders now yield multiple single-type
-- items; there is no 'mixed' terminal result. 'single_type' is renamed to
-- 'classified' to align with the new per-sub-item semantics.
--
-- Data migration: existing 'single_type' rows → 'classified'.
--                 existing 'mixed' rows → 'unclassified' (conservative; these
--                 items will be reclassified into sub-items on next classify).

PRAGMA foreign_keys = OFF;

CREATE TABLE inbox_classifications_new_047 (
    inbox_item_id           TEXT        NOT NULL PRIMARY KEY
                                REFERENCES inbox_items(id) ON DELETE CASCADE,
    result                  TEXT        NOT NULL
                                CHECK (result IN ('classified', 'unclassified')),
    frame_type              TEXT
                                CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    computed_at             TEXT        NOT NULL,
    content_signature       TEXT        NOT NULL,
    unclassified_file_count INTEGER     NOT NULL DEFAULT 0
);

INSERT INTO inbox_classifications_new_047 (
    inbox_item_id, result, frame_type, computed_at,
    content_signature, unclassified_file_count
)
SELECT
    inbox_item_id,
    CASE result
        WHEN 'single_type' THEN 'classified'
        WHEN 'mixed'       THEN 'unclassified'
        ELSE result   -- 'unclassified' passes through
    END,
    -- frame_type is nulled for rows that were 'mixed' (now 'unclassified')
    CASE result WHEN 'mixed' THEN NULL ELSE frame_type END,
    computed_at,
    content_signature,
    unclassified_file_count
FROM inbox_classifications;

DROP TABLE inbox_classifications;
ALTER TABLE inbox_classifications_new_047 RENAME TO inbox_classifications;

PRAGMA foreign_keys = ON;

-- ── 5. Extend inbox_file_metadata ─────────────────────────────────────────────
--
-- Add the extended extracted fields required by the R-9 grouping recipe and
-- R-18 semantics. All nullable (best-effort extraction; missing dims do not block
-- ingestion — they produce unknown-bucket warnings per R-14).
-- SQLite allows ALTER TABLE ADD COLUMN with no DEFAULT when the column is nullable.

-- Sensor / grouping dims
ALTER TABLE inbox_file_metadata ADD COLUMN offset          INTEGER;  -- OFFSET / BLKLEVEL
ALTER TABLE inbox_file_metadata ADD COLUMN set_temp_c      REAL;     -- SET-TEMP (dark grouping default)
ALTER TABLE inbox_file_metadata ADD COLUMN ccd_temp_c      REAL;     -- CCD-TEMP → DET-TEMP (DWARF III)

-- Sky pointing (light grouping + R-17 target resolution)
ALTER TABLE inbox_file_metadata ADD COLUMN ra_deg          REAL;     -- RA (decimal) ← OBJCTRA (sexa→dec)
ALTER TABLE inbox_file_metadata ADD COLUMN dec_deg         REAL;     -- DEC (decimal) ← OBJCTDEC (sexa→dec)

-- Rotation (flat↔light match key, R-18)
ALTER TABLE inbox_file_metadata ADD COLUMN rotator_angle_deg REAL;   -- ROTATANG (= ROTATOR, mechanical)
ALTER TABLE inbox_file_metadata ADD COLUMN rotator_name    TEXT;     -- ROTNAME (informational)
ALTER TABLE inbox_file_metadata ADD COLUMN sky_rotation_deg REAL;    -- OBJCTROT (sky PA — NOT a flat key)

-- Optional grouping dim
ALTER TABLE inbox_file_metadata ADD COLUMN readout_mode    TEXT;     -- READOUTM (default grouping OFF)

-- Optics (FOV-aware target radius + optic-train composite)
ALTER TABLE inbox_file_metadata ADD COLUMN focal_length_mm REAL;     -- FOCALLEN; XISF FocalLength×1000
ALTER TABLE inbox_file_metadata ADD COLUMN pixel_size_um   REAL;     -- XPIXSZ / PIXSIZE; XISF PixelSize

-- Observer location (future grouping; UTC-fallback night binning prerequisite)
ALTER TABLE inbox_file_metadata ADD COLUMN observer_lat    REAL;     -- SITELAT → OBSGEO-B → LAT-OBS
ALTER TABLE inbox_file_metadata ADD COLUMN observer_long   REAL;     -- SITELONG → OBSGEO-L → LONG-OBS
ALTER TABLE inbox_file_metadata ADD COLUMN observer_elev   REAL;     -- SITEELEV → OBSGEO-H → ALT-OBS

-- Local time / observing night
ALTER TABLE inbox_file_metadata ADD COLUMN date_loc        TEXT;     -- DATE-LOC (local calendar date)
ALTER TABLE inbox_file_metadata ADD COLUMN date_end        TEXT;     -- DATE-END (dark-run span heuristic)

-- MJD timing (NINA 3.2+ preferred ordering/UTC math)
ALTER TABLE inbox_file_metadata ADD COLUMN mjd_avg         REAL;     -- MJD-AVG (midpoint, preferred)
ALTER TABLE inbox_file_metadata ADD COLUMN mjd_obs         REAL;     -- MJD-OBS (start, fallback)

-- ── 6. Migrate override columns → inbox_file_overrides ───────────────────────
--
-- Existing inbox_classification_evidence rows with non-null override_filter,
-- override_exposure_s, override_binning, or manual_override are migrated into
-- inbox_file_overrides rows.
--
-- Strategy:
--   a) We need source_group_id for each evidence row. At this point existing
--      inbox_items rows have source_group_id = NULL (no source groups exist yet
--      for pre-0047 data). We use inbox_items.id as the anchor and skip the
--      inbox_file_overrides insert if no source group can be found.
--      Per data-model RQ6, plan_open items are kept as-is (source_group_id NULL);
--      their overrides are migrated below using a temporary source group so that
--      the data is not lost (they will re-derive after plan close).
--
--   b) Staleness identity: file_size_bytes and file_mtime come from
--      inbox_file_metadata (same (inbox_item_id, relative_file_path) key).
--
--   c) set_at: we use the inbox_item's last_scanned_at as the best available
--      proxy for when the override was recorded (no override timestamp existed).
--
--   d) For each of the 4 override properties we insert a row when the value is
--      non-null. id is constructed as a deterministic composite to be idempotent.
--
-- NOTE: source groups are created at step 6a from existing inbox_items so that
-- the override FK can be satisfied. This is the re-derivation described in RQ6
-- steps 1 and 3.

-- 6a. Create inbox_source_groups rows from existing inbox_items.
--     Each distinct (root_id, relative_path) in inbox_items → one source group.
--     We use the inbox_item's own fields for the group columns where available.
--     plan_open items are included so their overrides can be migrated safely.

INSERT OR IGNORE INTO inbox_source_groups (
    id, root_id, relative_path, discovered_at, last_scanned_at,
    content_signature, format, lane, child_count
)
SELECT
    'sg-migrate-' || ii.id,  -- deterministic id: will be stable for legacy items
    ii.root_id,
    ii.relative_path,
    ii.discovered_at,
    ii.last_scanned_at,
    ii.content_signature,
    ii.format,
    ii.lane,
    1  -- each existing item counts as one child initially
FROM inbox_items ii;

-- 6b. Link existing inbox_items rows to their migrated source groups.

UPDATE inbox_items
    SET source_group_id = 'sg-migrate-' || id
    WHERE source_group_id IS NULL;

-- 6c. Migrate override_filter → property_key 'filter'

INSERT OR IGNORE INTO inbox_file_overrides (
    id, source_group_id, relative_file_path, property_key, value,
    file_size_bytes, file_mtime, override_stale, set_at
)
SELECT
    'ov-migrate-' || ice.id || '-filter',
    'sg-migrate-' || ice.inbox_item_id,
    ice.relative_file_path,
    'filter',
    ice.override_filter,
    ifm.file_size_bytes,
    ifm.file_mtime,
    ice.override_stale,
    ii.last_scanned_at
FROM inbox_classification_evidence ice
JOIN inbox_items ii ON ii.id = ice.inbox_item_id
LEFT JOIN inbox_file_metadata ifm
    ON ifm.inbox_item_id = ice.inbox_item_id
    AND ifm.relative_file_path = ice.relative_file_path
WHERE ice.override_filter IS NOT NULL;

-- 6d. Migrate override_exposure_s → property_key 'exposureS'

INSERT OR IGNORE INTO inbox_file_overrides (
    id, source_group_id, relative_file_path, property_key, value,
    file_size_bytes, file_mtime, override_stale, set_at
)
SELECT
    'ov-migrate-' || ice.id || '-exposureS',
    'sg-migrate-' || ice.inbox_item_id,
    ice.relative_file_path,
    'exposureS',
    CAST(ice.override_exposure_s AS TEXT),
    ifm.file_size_bytes,
    ifm.file_mtime,
    ice.override_stale,
    ii.last_scanned_at
FROM inbox_classification_evidence ice
JOIN inbox_items ii ON ii.id = ice.inbox_item_id
LEFT JOIN inbox_file_metadata ifm
    ON ifm.inbox_item_id = ice.inbox_item_id
    AND ifm.relative_file_path = ice.relative_file_path
WHERE ice.override_exposure_s IS NOT NULL;

-- 6e. Migrate override_binning → property_key 'binning'

INSERT OR IGNORE INTO inbox_file_overrides (
    id, source_group_id, relative_file_path, property_key, value,
    file_size_bytes, file_mtime, override_stale, set_at
)
SELECT
    'ov-migrate-' || ice.id || '-binning',
    'sg-migrate-' || ice.inbox_item_id,
    ice.relative_file_path,
    'binning',
    ice.override_binning,
    ifm.file_size_bytes,
    ifm.file_mtime,
    ice.override_stale,
    ii.last_scanned_at
FROM inbox_classification_evidence ice
JOIN inbox_items ii ON ii.id = ice.inbox_item_id
LEFT JOIN inbox_file_metadata ifm
    ON ifm.inbox_item_id = ice.inbox_item_id
    AND ifm.relative_file_path = ice.relative_file_path
WHERE ice.override_binning IS NOT NULL;

-- 6f. Migrate manual_override (frame type correction) → property_key 'frameType'

INSERT OR IGNORE INTO inbox_file_overrides (
    id, source_group_id, relative_file_path, property_key, value,
    file_size_bytes, file_mtime, override_stale, set_at
)
SELECT
    'ov-migrate-' || ice.id || '-frameType',
    'sg-migrate-' || ice.inbox_item_id,
    ice.relative_file_path,
    'frameType',
    ice.manual_override,
    ifm.file_size_bytes,
    ifm.file_mtime,
    ice.override_stale,
    ii.last_scanned_at
FROM inbox_classification_evidence ice
JOIN inbox_items ii ON ii.id = ice.inbox_item_id
LEFT JOIN inbox_file_metadata ifm
    ON ifm.inbox_item_id = ice.inbox_item_id
    AND ifm.relative_file_path = ice.relative_file_path
WHERE ice.manual_override IS NOT NULL;

-- 6g. Drop the migrated override columns from inbox_classification_evidence.
--     SQLite does not support DROP COLUMN before 3.35.0 (2021-03-12). We use
--     the table-rebuild pattern to remove the four columns. Preserve all other
--     columns: id, inbox_item_id, relative_file_path, frame_type,
--     evidence_source, raw_value, unclassified, manual_override (being dropped),
--     is_master (0042), master_detector (0042), override_filter (0045),
--     override_exposure_s (0045), override_binning (0045), override_stale (0045).
--
--     After rebuild the table has: id, inbox_item_id, relative_file_path,
--     frame_type, evidence_source, raw_value, unclassified, is_master,
--     master_detector, override_stale.
--
--     override_stale is kept: it now records whether the source file changed
--     since any override was applied (still valid; staleness check is per-file).

PRAGMA foreign_keys = OFF;

CREATE TABLE inbox_classification_evidence_new_047 (
    id                  TEXT        NOT NULL PRIMARY KEY,
    inbox_item_id       TEXT        NOT NULL
                            REFERENCES inbox_items(id) ON DELETE CASCADE,
    relative_file_path  TEXT        NOT NULL,
    frame_type          TEXT
                            CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    evidence_source     TEXT        NOT NULL DEFAULT 'none'
                            CHECK (evidence_source IN (
                                'imagetyp_header',
                                'xisf_property',
                                'manual_override',
                                'none'
                            )),
    raw_value           TEXT,
    unclassified        INTEGER     NOT NULL DEFAULT 0  CHECK (unclassified IN (0,1)),
    -- manual_override retained: the "correct classification" action still uses it
    -- until T068 (field-agnostic reclassify) lands. After T068, the frameType
    -- override in inbox_file_overrides supersedes this column.
    manual_override     TEXT
                            CHECK (manual_override IN ('light','dark','bias','flat','dark_flat')),
    -- from migration 0042
    is_master           INTEGER     NOT NULL DEFAULT 0  CHECK (is_master IN (0,1)),
    master_detector     TEXT,
    -- override_stale kept (per-file staleness flag used by UI)
    override_stale      INTEGER     NOT NULL DEFAULT 0
);

INSERT INTO inbox_classification_evidence_new_047 (
    id, inbox_item_id, relative_file_path, frame_type, evidence_source,
    raw_value, unclassified, manual_override, is_master, master_detector,
    override_stale
)
SELECT
    id, inbox_item_id, relative_file_path, frame_type, evidence_source,
    raw_value, unclassified, manual_override, is_master, master_detector,
    override_stale
FROM inbox_classification_evidence;

DROP TABLE inbox_classification_evidence;
ALTER TABLE inbox_classification_evidence_new_047
    RENAME TO inbox_classification_evidence;

-- Recreate indexes from migration 0020.
CREATE INDEX IF NOT EXISTS inbox_evidence_item
    ON inbox_classification_evidence (inbox_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_evidence_item_path
    ON inbox_classification_evidence (inbox_item_id, relative_file_path);

PRAGMA foreign_keys = ON;
