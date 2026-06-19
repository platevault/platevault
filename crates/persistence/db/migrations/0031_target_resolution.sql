-- Migration 0031: SIMBAD target resolution (spec 035, T003 scaffold / T006 schema).
--
-- NOTE ON NUMBERING: spec 035 tasks.md (T003/T006/T035) refer to this migration
-- as `0017_target_resolution.sql`, but `0017` is already taken by the spec-013
-- `0017_targets.sql` migration (and is referenced by 0027). The next free
-- forward-migration number is `0031`; this file uses it. The append-only intent
-- is preserved: the prior `0016_catalogs.sql` migration is NOT edited or removed.
--
-- This forward migration supersedes the spec-014 catalog-download model. The
-- hosted-catalog pipeline (manifest fetch + download + signing) was abandoned in
-- favour of SIMBAD resolve-on-demand + a bundled seed + a local resolution
-- cache. The `0016_catalogs.sql` tables are therefore dropped here via
-- `DROP TABLE IF EXISTS` (forward-only; safe whether or not 0016 was applied),
-- and replaced with:
--   * canonical_target   — stable per-object identity + dedup key (simbad_oid).
--   * target_alias       — alternate designations / common names (typeahead).
--   * resolver_settings  — singleton online-resolver configuration.
--   * ingest_resolution  — async pending queue for FITS OBJECT resolution.
--
-- Constitution §I : resolution data is metadata only; no image files touched.
-- Constitution §II: ingest resolution carries explicit state (pending/resolved/
--                   unresolved) and never silently mis-assigns (exact match only).
-- Constitution §V : SQLite is the durable record; the bundled seed and SIMBAD
--                   responses are reproducible projections into this cache.

-- ── Supersede spec-014 catalog-download tables ────────────────────────────────
-- Drop the child (FK -> catalog_downloaded ON DELETE CASCADE) before the parent.
DROP TABLE IF EXISTS catalog_downloaded_attribution;
DROP TABLE IF EXISTS catalog_downloaded;

-- ── Resolution schema (implemented in T006, per data-model.md) ────────────────

-- ── canonical_target ──────────────────────────────────────────────────────────
-- Stable per-object identity (UUID v5 namespaced from the canonical designation,
-- spec 013 R6). `simbad_oid` is the dedup key (FR-007): unique when non-null,
-- null for seed/override-only entries until resolved online. Coordinates are
-- ICRS J2000 decimal degrees, never fabricated (FR-009).

CREATE TABLE IF NOT EXISTS canonical_target (
    id                  TEXT    NOT NULL PRIMARY KEY,     -- UUID v5
    simbad_oid          INTEGER,                          -- SIMBAD physical-object id; UNIQUE when non-null
    primary_designation TEXT    NOT NULL,                 -- canonical display designation
    object_type         TEXT    NOT NULL,                 -- closed ObjectType enum (snake_case)
    ra_deg              REAL    NOT NULL CHECK (ra_deg  >= 0   AND ra_deg  < 360),
    dec_deg             REAL    NOT NULL CHECK (dec_deg >= -90 AND dec_deg <= 90),
    source              TEXT    NOT NULL CHECK (source IN ('seed', 'resolved', 'user-override')),
    resolved_at         TEXT    NOT NULL                  -- RFC 3339 UTC
);

-- Dedup uniqueness applies only when an oid is present (seed/override rows may be null).
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_target_simbad_oid
    ON canonical_target(simbad_oid) WHERE simbad_oid IS NOT NULL;

-- ── target_alias ──────────────────────────────────────────────────────────────
-- Alternate designations / common names pointing at a canonical_target; the
-- typeahead match surface. `(target_id, normalized)` is unique; `normalized` is
-- indexed for instant prefix/typeahead lookup.

CREATE TABLE IF NOT EXISTS target_alias (
    id          TEXT NOT NULL PRIMARY KEY,                -- UUID
    target_id   TEXT NOT NULL REFERENCES canonical_target(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,                            -- display designation / NAME common name
    normalized  TEXT NOT NULL,                            -- normalized form for matching (spec 013)
    kind        TEXT NOT NULL CHECK (kind IN ('designation', 'common_name')),
    UNIQUE (target_id, normalized)
);

CREATE INDEX IF NOT EXISTS idx_target_alias_normalized
    ON target_alias(normalized);

-- ── resolver_settings ─────────────────────────────────────────────────────────
-- Singleton online-resolver configuration. The single row is enforced by the
-- CHECK on `id`. Default row seeded via INSERT OR IGNORE.

CREATE TABLE IF NOT EXISTS resolver_settings (
    id                   INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    online_enabled       INTEGER NOT NULL DEFAULT 1,      -- bool; online SIMBAD resolution (FR-015)
    simbad_endpoint      TEXT    NOT NULL DEFAULT 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
    debounce_ms          INTEGER NOT NULL DEFAULT 300,    -- interactive query debounce
    request_timeout_secs INTEGER NOT NULL DEFAULT 10      -- per-request timeout; degrade to seed+cache
);

INSERT OR IGNORE INTO resolver_settings (id) VALUES (1);

-- ── ingest_resolution ─────────────────────────────────────────────────────────
-- Async pending queue tracking resolution of FITS OBJECT values during ingest
-- (FR-013). `image_id` references the inventory record (`file_record`, the
-- spec-002 inventory entry). Matching is exact-normalized only (FR-008): a
-- non-matching/ambiguous value stays `unresolved` rather than being guessed.

CREATE TABLE IF NOT EXISTS ingest_resolution (
    id          TEXT    NOT NULL PRIMARY KEY,             -- UUID
    image_id    TEXT    NOT NULL REFERENCES file_record(id) ON DELETE CASCADE,
    object_raw  TEXT    NOT NULL,                         -- verbatim FITS OBJECT value
    state       TEXT    NOT NULL CHECK (state IN ('pending', 'resolved', 'unresolved')),
    target_id   TEXT    REFERENCES canonical_target(id),  -- set when resolved
    attempts    INTEGER NOT NULL DEFAULT 0
);

-- Pending-queue scan: the background resolver polls state='pending'.
CREATE INDEX IF NOT EXISTS idx_ingest_resolution_pending
    ON ingest_resolution(state) WHERE state = 'pending';
