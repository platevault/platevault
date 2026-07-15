-- Migration 0066: camera sensor-type dimension (spec 044 iteration
-- 2026-07-15, FR-035/T045).
--
-- Adds exactly two additive nullable columns to `cameras` (0007) -- no wider
-- equipment-model redesign:
--
--   sensor_type  TEXT  'mono' | 'osc'; NULL = unknown. Unknown MUST behave
--                      as mono/per-filter downstream (FR-038), so the change
--                      never regresses existing rows.
--   passband     TEXT  JSON array of narrowband bands (e.g. '["Ha","OIII"]')
--                      for an OSC dual/tri-band filter; NULL = plain color
--                      camera ('rgb' default, FR-035). Only meaningful when
--                      sensor_type = 'osc'.

ALTER TABLE cameras ADD COLUMN sensor_type TEXT;
ALTER TABLE cameras ADD COLUMN passband TEXT;
