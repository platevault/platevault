-- Migration 0016: catalog registry (spec 014, T002).
--
-- `catalog_downloaded` stores one row per installed downloaded catalog.
-- `catalog_downloaded_attribution` stores one or more attribution rows per
-- catalog (one catalog MAY have multiple rows when a bundle aggregates more
-- than one upstream source).
--
-- Constitution §I: catalog files are app-owned resources; metadata stored in
-- DB without requiring raw user image files.
-- Constitution §II: catalog updates are atomic swaps; swap is recorded in the
-- audit log.
-- Constitution §V: durable records in SQLite; downloaded catalog files are
-- reproducible projections from the manifest.
--
-- Note: `catalog_user*` tables are deliberately omitted (A2 — user-added
-- catalogs deferred to v1.x). The `origin` column is constrained to
-- 'downloaded' in v1; 'built_in' is reserved for forward-compat.

CREATE TABLE IF NOT EXISTS catalog_downloaded (
    id           TEXT PRIMARY KEY NOT NULL,   -- stable slug, e.g. 'messier'
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    license      TEXT NOT NULL,               -- LicenseShortCode string
    source_url   TEXT NOT NULL,
    last_updated TEXT NOT NULL,               -- RFC 3339 UTC
    entry_count  INTEGER                      -- optional; may be NULL
);

CREATE TABLE IF NOT EXISTS catalog_downloaded_attribution (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id            TEXT    NOT NULL REFERENCES catalog_downloaded(id) ON DELETE CASCADE,
    license               TEXT    NOT NULL,   -- LicenseShortCode string
    text                  TEXT    NOT NULL,   -- verbatim notice text; never empty
    link                  TEXT    NOT NULL,   -- stable source URL
    accessed_on           TEXT,               -- ISO 8601 date; optional
    author                TEXT,               -- required for cc-by-* / cc-by-sa-*
    title                 TEXT,               -- required for cc-by-* / cc-by-sa-*
    license_uri           TEXT,               -- required for cc-by-* / cc-by-sa-*
    modifications_notice  TEXT                -- optional; describes project modifications
);

CREATE INDEX IF NOT EXISTS idx_catalog_downloaded_attribution_catalog_id
    ON catalog_downloaded_attribution(catalog_id);
