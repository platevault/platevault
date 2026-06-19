-- Migration 0043: add format + is_master_item to inbox_items
--
-- Spec 040 Phase 2a: masters are surfaced as individual inbox items so the UI
-- can distinguish stacked masters from sub-frame folders.
--
-- format         — file format for this item:
--                  'fits'  = FITS file(s) (.fits/.fit/.fts)
--                  'xisf'  = XISF file(s) (.xisf)
--                  'video' = video file(s) (.ser/.avi/.…)
--                  'mixed' = folder contains both FITS and XISF
--                  NULL    = unknown / legacy row (treated as 'fits')
--
-- is_master_item — 1 when this inbox_item row represents a single stacked
--                  calibration master file (relative_path = file path, not
--                  folder path). 0 for the normal folder-grouped case.
--
-- master_frame_type — base frame type string (e.g. 'dark', 'flat', 'bias')
--                  for master items; NULL for grouped sub-frame folders.
--
-- master_filter  — filter value from evidence if available; NULL otherwise.
-- master_exposure_s — exposure in seconds if available; NULL otherwise.

ALTER TABLE inbox_items
    ADD COLUMN format            TEXT;

ALTER TABLE inbox_items
    ADD COLUMN is_master_item    INTEGER NOT NULL DEFAULT 0
        CHECK (is_master_item IN (0, 1));

ALTER TABLE inbox_items
    ADD COLUMN master_frame_type TEXT;

ALTER TABLE inbox_items
    ADD COLUMN master_filter     TEXT;

ALTER TABLE inbox_items
    ADD COLUMN master_exposure_s REAL;
