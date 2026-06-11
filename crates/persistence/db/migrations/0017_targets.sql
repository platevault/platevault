-- Migration 0017: target identity and catalog lookup tables (spec 013).
--
-- `targets`              — canonical target identity (one row per physical object).
-- `target_catalog_refs`  — one row per catalog entry that refers to this target.
-- `catalog_equivalences` — asserts cross-catalog identity; seeded from manifest
--                          sidecar at first catalog install (T010-eq).
--
-- Constitution §I : target records are app-owned metadata; image files are never
--                   touched by this layer.
-- Constitution §V : SQLite is the durable record; in-memory index is a
--                   reproducible projection rebuilt from these tables.
--
-- Notes:
--   • `targets.id` is a UUIDv5 derived from the canonical designation per R6.
--   • `catalog_equivalences.(catalog_id, designation)` is UNIQUE so upserts are
--     idempotent across incremental catalog installs (R5).
--   • `target_catalog_refs.(catalog_id, designation)` is UNIQUE per the
--     data-model.md invariant.
--   • `catalog_equivalences.is_primary` has a partial-unique index so exactly
--     one row per `canonical_target_id` carries `is_primary = 1` (SQLite uses
--     integers for booleans).

-- ── targets ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS targets (
    id                  TEXT    PRIMARY KEY NOT NULL,   -- UUIDv5
    primary_designation TEXT    NOT NULL,               -- e.g. "M 101"
    created_at          TEXT    NOT NULL               -- RFC 3339 UTC
);

-- ── target_catalog_refs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS target_catalog_refs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id       TEXT    NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    catalog_id      TEXT    NOT NULL,   -- closed-enum slug, e.g. "messier"
    catalog_display TEXT    NOT NULL,   -- human name, e.g. "Messier"
    designation     TEXT    NOT NULL,   -- catalog-local designation, e.g. "M101"
    UNIQUE (catalog_id, designation)
);

CREATE INDEX IF NOT EXISTS idx_target_catalog_refs_target_id
    ON target_catalog_refs(target_id);

-- ── catalog_equivalences ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_equivalences (
    id                  TEXT    PRIMARY KEY NOT NULL,   -- UUID
    canonical_target_id TEXT    NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    catalog_id          TEXT    NOT NULL,
    designation         TEXT    NOT NULL,
    is_primary          INTEGER NOT NULL DEFAULT 0,     -- 1 = true
    created_at          TEXT    NOT NULL,               -- RFC 3339 UTC
    UNIQUE (catalog_id, designation)
);

-- Partial unique index: exactly one primary row per target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_equivalences_one_primary
    ON catalog_equivalences(canonical_target_id)
    WHERE is_primary = 1;

CREATE INDEX IF NOT EXISTS idx_catalog_equivalences_target_id
    ON catalog_equivalences(canonical_target_id);
