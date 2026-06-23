-- Migration 0047: Add constellation and magnitude to canonical_target.
-- (Renamed from 0046 to resolve a duplicate-version collision; see PR #317.)
--
-- These fields were absent from the original schema (migration 0031).
-- Both are nullable:
--   - `constellation` — IAU 3-letter abbreviation (e.g. 'And', 'Ori'); populated
--     at resolution time from SIMBAD or seed data when available.
--   - `magnitude` — visual/V-band magnitude; may be absent for diffuse objects.
--
-- Constitution §I : metadata only; no image files touched.
-- Constitution §V : SQLite is the durable record; existing rows retain NULL until
--                   the resolver updates them.

ALTER TABLE canonical_target ADD COLUMN constellation TEXT;
ALTER TABLE canonical_target ADD COLUMN magnitude     REAL;
