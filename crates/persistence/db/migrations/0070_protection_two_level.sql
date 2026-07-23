-- Migration 0070: collapse source protection to a 2-level model (issue #506).
--
-- Product decision (2026-07-17): the 3-level model (protected / normal /
-- unprotected) is simplified to 2 levels (protected / unprotected). The
-- "normal" level added a confusing third state that duplicated what an
-- ABSENT override row already means (inherit the global default) without
-- adding real capability. Per-source protection control lives only in
-- Settings (not the first-run wizard).
--
-- Constitution §V (durable records): this migration is purely additive/
-- remapping — every existing row survives with its value normalised to the
-- new 2-value vocabulary. No row is deleted.
--
-- SQLite has no ALTER COLUMN / DROP CONSTRAINT, so the CHECK change on
-- source_protection_state requires a table rebuild (mirrors migration 0053).

PRAGMA foreign_keys = OFF;

CREATE TABLE source_protection_state_0070 (
    source_id             TEXT PRIMARY KEY NOT NULL,
    level                 TEXT NOT NULL CHECK (level IN ('protected', 'unprotected')),
    block_permanent_delete INTEGER,
    categories            TEXT,
    updated_at            TEXT NOT NULL,
    updated_by            TEXT NOT NULL DEFAULT 'system'
);

INSERT INTO source_protection_state_0070
SELECT
    source_id,
    CASE WHEN level = 'protected' THEN 'protected' ELSE 'unprotected' END,
    block_permanent_delete,
    categories,
    updated_at,
    updated_by
FROM source_protection_state;

DROP TABLE source_protection_state;
ALTER TABLE source_protection_state_0070 RENAME TO source_protection_state;

PRAGMA foreign_keys = ON;

-- `protection_defaults` (migration 0035) and the legacy `settings`/
-- `source_overrides` key-value tables (migration 0013) have no CHECK
-- constraint — remap their stored 'normal' JSON values in place.
UPDATE protection_defaults
SET value = '"unprotected"'
WHERE scope = 'global' AND key = 'defaultProtection' AND value = '"normal"';

UPDATE settings
SET value = '"unprotected"'
WHERE key = 'defaultProtection' AND value = '"normal"';

UPDATE source_overrides
SET value = '"unprotected"'
WHERE key = 'defaultProtection' AND value = '"normal"';
