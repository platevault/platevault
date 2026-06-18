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
-- TODO(T006): CREATE TABLE canonical_target  -- id (UUID v5), simbad_oid (UNIQUE when non-null),
--             primary_designation, object_type, ra_deg, dec_deg, source (seed|resolved|user-override), resolved_at.
-- TODO(T006): CREATE TABLE target_alias       -- target_id FK -> canonical_target, alias, normalized, kind (designation|common_name);
--             UNIQUE (target_id, normalized); index normalized for typeahead.
-- TODO(T006): CREATE TABLE resolver_settings   -- singleton: online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs.
-- TODO(T006): CREATE TABLE ingest_resolution   -- image_id FK, object_raw, state (pending|resolved|unresolved), target_id FK?, attempts.
