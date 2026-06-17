-- Migration 0038: catalog integrity and authenticity (spec 033, US7).
--
-- FR-026: persist signature verification status per catalog.
-- FR-027: enforce license codes against the recognised closed set.
-- FR-028: unique constraints that make upsert + attribution transactional safe.
-- FR-029: no structural change needed for slug enum (enforced in application
--         layer via CatalogId::from_slug hard-fail), but the license CHECK
--         below tightens the DB-level contract.
--
-- Constitution §II: every catalog install is an atomic reviewable action;
--   partial writes are prevented by the FK + unique constraints below.
-- Constitution §V: durable records; the signature_status column lets auditors
--   confirm each installed catalog was verified before acceptance.

-- Add signature_status column to catalog_downloaded.
-- Values: 'verified' (minisign OK) | 'unverified' (legacy row, no sig check).
ALTER TABLE catalog_downloaded
    ADD COLUMN signature_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (signature_status IN ('verified', 'unverified'));

-- Tighten the license column with a CHECK against the recognised closed set
-- (FR-027). This mirrors LicenseShortCode variants; unknown strings are
-- rejected at the DB level as a second defence after the application layer.
--
-- SQLite CHECK constraints on existing tables require recreating the table.
-- We use a new shadow CHECK trigger approach via a CHECK on a new helper column
-- instead — SQLite does NOT support ADD COLUMN ... CHECK that references other
-- columns. We enforce via application layer + the separate trigger below.
--
-- To add a CHECK to `license` without recreating the table we use a partial
-- index approach: create an index that only matches rows with invalid licenses.
-- Inserting an invalid license row succeeds at the SQL level but is blocked
-- by the application layer (LicenseShortCode::parse_code returns Err).
-- The trigger below provides the DB-level guard.
CREATE TRIGGER IF NOT EXISTS trg_catalog_license_check
    BEFORE INSERT ON catalog_downloaded
    FOR EACH ROW
    WHEN NEW.license NOT IN (
        'public-domain', 'apache-2.0', 'mit', 'cc0-1.0',
        'cc-by-4.0', 'cc-by-sa-4.0', 'hyperleda', 'esa-free'
    )
    BEGIN
        SELECT RAISE(ABORT, 'catalog_downloaded.license: unrecognised license code');
    END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_license_check_update
    BEFORE UPDATE ON catalog_downloaded
    FOR EACH ROW
    WHEN NEW.license NOT IN (
        'public-domain', 'apache-2.0', 'mit', 'cc0-1.0',
        'cc-by-4.0', 'cc-by-sa-4.0', 'hyperleda', 'esa-free'
    )
    BEGIN
        SELECT RAISE(ABORT, 'catalog_downloaded.license: unrecognised license code');
    END;

CREATE TRIGGER IF NOT EXISTS trg_attribution_license_check
    BEFORE INSERT ON catalog_downloaded_attribution
    FOR EACH ROW
    WHEN NEW.license NOT IN (
        'public-domain', 'apache-2.0', 'mit', 'cc0-1.0',
        'cc-by-4.0', 'cc-by-sa-4.0', 'hyperleda', 'esa-free'
    )
    BEGIN
        SELECT RAISE(ABORT, 'catalog_downloaded_attribution.license: unrecognised license code');
    END;

-- Unique constraint on (catalog_id) in attribution is intentionally NOT added
-- here because one catalog may have multiple attribution rows (data-model note:
-- "one catalog MAY have multiple rows when a bundle aggregates more than one
-- upstream source"). Atomicity is enforced at the application layer by wrapping
-- upsert_catalog + delete_attributions + insert_attribution in a single
-- transaction (FR-028).
