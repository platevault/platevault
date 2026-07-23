PRAGMA foreign_keys = ON;

-- ── Plate-solved WCS pointing (spec 052 P3, FR-012) ──────────────────────────
--
-- Distinct from the existing `ra_deg`/`dec_deg` (mount RA/DEC or sexagesimal
-- OBJCTRA/OBJCTDEC — medium confidence): these carry the plate-solved WCS
-- CRVAL1/CRVAL2 pointing (high confidence) when the file's CTYPE1/CTYPE2
-- headers are genuine equatorial WCS projections. Nullable/best-effort, like
-- every other extracted column on this table.
ALTER TABLE inbox_file_metadata ADD COLUMN wcs_ra_deg       REAL; -- CRVAL1, gated on CTYPE1/2
ALTER TABLE inbox_file_metadata ADD COLUMN wcs_dec_deg      REAL; -- CRVAL2, gated on CTYPE1/2
ALTER TABLE inbox_file_metadata ADD COLUMN wcs_rotation_deg REAL; -- CD matrix (preferred) or CROTA2
