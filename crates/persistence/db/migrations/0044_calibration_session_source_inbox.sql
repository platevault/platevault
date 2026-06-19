-- Migration 0044: add source_inbox_item_id to calibration_session (spec 040 US3).
--
-- Allows tracing a registered calibration master back to the inbox item that
-- triggered its registration via the master-confirm path (Path 1 in spec 040).
-- NULL for sessions created through earlier flows.

ALTER TABLE calibration_session
    ADD COLUMN source_inbox_item_id TEXT;
