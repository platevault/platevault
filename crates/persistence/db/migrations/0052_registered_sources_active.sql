-- Migration 0052: add `active` column to registered_sources (P6b — Data
-- Sources Disable/Enable).
--
-- Disabled roots are excluded from scan/ingest surfaces but their history
-- (sessions, plan items, file records, inbox items) stays fully intact — this
-- is a visibility flag, not a deletion (constitution §I: local-first custody;
-- constitution §II: reviewable mutation, not silent data loss).
--
-- SQLite allows ADD COLUMN with a NOT NULL DEFAULT; stored as INTEGER 0/1
-- (no CHECK constraint — SQLite's ADD COLUMN does not support CHECK, same
-- precedent as migration 0045's override_stale column). Application code
-- treats any non-zero value as active.

ALTER TABLE registered_sources
    ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
