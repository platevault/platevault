-- Migration 0079: camera sensor geometry (optical-train field of view).
--
-- Adds the three operands an optical train needs to report a field of view.
-- Focal length already lives on `optical_trains` (0007); pixel size and sensor
-- dimensions existed only on `inbox_file_metadata` (0045/0049) — per ingested
-- file, never per registered camera — so a registered train could not compute
-- a FOV at all.
--
--   pixel_size_um     REAL     Physical pixel pitch in micrometres. Square
--                              pixels are assumed on both axes, matching the
--                              existing `sessions::fov_diagonal_deg` contract.
--   sensor_width_px   INTEGER  Sensor dimensions in pixels (unbinned), the
--   sensor_height_px  INTEGER  same quantities FITS records as NAXIS1/NAXIS2.
--
-- All three are NULLABLE with no default. Every existing camera row predates
-- this migration and has no geometry to backfill; a camera without geometry
-- MUST keep working and MUST report an absent FOV rather than a fabricated
-- one. `NOT NULL DEFAULT 0` would manufacture a degenerate zero-sized sensor
-- that silently yields a 0-degree FOV, which is exactly the failure mode this
-- column set exists to avoid (same reasoning as 0064's nullable pointing
-- geometry: "NEVER default to 0").
--
-- The CHECK constraints reject non-positive values at the storage boundary so
-- a degenerate value cannot reach the FOV computation even if a caller skips
-- form validation. NULL stays legal — unknown is not the same as invalid.

ALTER TABLE cameras ADD COLUMN pixel_size_um REAL
    CHECK (pixel_size_um IS NULL OR pixel_size_um > 0);
ALTER TABLE cameras ADD COLUMN sensor_width_px INTEGER
    CHECK (sensor_width_px IS NULL OR sensor_width_px > 0);
ALTER TABLE cameras ADD COLUMN sensor_height_px INTEGER
    CHECK (sensor_height_px IS NULL OR sensor_height_px > 0);
