-- Migration 0020: Inbox items, classifications, evidence, and plan links (spec 005).
--
-- Constitution §I: image files stay on disk; only metadata/paths stored here.
-- Constitution §II: per-file evidence records provide the audit trail for
--   every classification decision.
-- Constitution §V: classifications and evidence are reproducible projections;
--   InboxItem.state and InboxPlanLink are the durable, non-reproducible records.
--
-- Data-model references: data-model.md §InboxItem, §InboxClassification,
-- §InboxClassificationEvidence, §InboxPlanLink.

-- ── inbox_items ──────────────────────────────────────────────────────────────
-- One row per leaf folder that directly contains FITS files (R-Granularity-1).

CREATE TABLE IF NOT EXISTS inbox_items (
    id                  TEXT        NOT NULL PRIMARY KEY,
    root_id             TEXT        NOT NULL,           -- FK to library roots (spec 006)
    relative_path       TEXT        NOT NULL,           -- leaf folder relative to root
    file_count          INTEGER     NOT NULL DEFAULT 0, -- FITS files at scan time; NOT used for plan enumeration (A9)
    discovered_at       TEXT        NOT NULL,
    last_scanned_at     TEXT        NOT NULL,
    content_signature   TEXT,                           -- folder-level signature per R-Sig-1; null until first scan
    state               TEXT        NOT NULL DEFAULT 'pending_classification'
                            CHECK (state IN (
                                'pending_classification',
                                'classified',
                                'plan_open',
                                'resolved'
                            )),
    lane                TEXT        NOT NULL DEFAULT 'fits'
                            CHECK (lane IN ('fits', 'video'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_root_path
    ON inbox_items (root_id, relative_path);

-- ── inbox_classifications ────────────────────────────────────────────────────
-- Cached classification result per item; recomputable.

CREATE TABLE IF NOT EXISTS inbox_classifications (
    inbox_item_id           TEXT        NOT NULL PRIMARY KEY
                                REFERENCES inbox_items(id) ON DELETE CASCADE,
    result                  TEXT        NOT NULL
                                CHECK (result IN ('single_type', 'mixed', 'unclassified')),
    frame_type              TEXT                     -- non-null when result = 'single_type'
                                CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    computed_at             TEXT        NOT NULL,
    content_signature       TEXT        NOT NULL,    -- signature at compute time
    unclassified_file_count INTEGER     NOT NULL DEFAULT 0
);

-- ── inbox_classification_evidence ─────────────────────────────────────────────
-- Per-file evidence records. InboxConfirmUseCase MUST enumerate plan item
-- source paths from this table, NOT from inbox_items.file_count (Ref: A9).

CREATE TABLE IF NOT EXISTS inbox_classification_evidence (
    id                  TEXT        NOT NULL PRIMARY KEY,
    inbox_item_id       TEXT        NOT NULL
                            REFERENCES inbox_items(id) ON DELETE CASCADE,
    relative_file_path  TEXT        NOT NULL,        -- relative to inbox root; source path for plan items
    frame_type          TEXT                         -- null when unclassified=1 and manual_override IS NULL
                            CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    evidence_source     TEXT        NOT NULL DEFAULT 'none'
                            CHECK (evidence_source IN (
                                'imagetyp_header',
                                'xisf_property',
                                'manual_override',
                                'none'
                            )),
    raw_value           TEXT,                        -- original IMAGETYP/XISF property value for audit
    unclassified        INTEGER     NOT NULL DEFAULT 0  CHECK (unclassified IN (0,1)),
    manual_override     TEXT                         -- set by inbox.reclassify; overrides frame_type when non-null
                            CHECK (manual_override IN ('light','dark','bias','flat','dark_flat'))
);

CREATE INDEX IF NOT EXISTS inbox_evidence_item
    ON inbox_classification_evidence (inbox_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_evidence_item_path
    ON inbox_classification_evidence (inbox_item_id, relative_file_path);

-- ── inbox_classification_breakdown ───────────────────────────────────────────
-- Per-frame-type summary rows for the detail drawer. Derived from evidence but
-- stored for fast UI rendering.

CREATE TABLE IF NOT EXISTS inbox_classification_breakdown (
    id                  TEXT        NOT NULL PRIMARY KEY,
    inbox_item_id       TEXT        NOT NULL
                            REFERENCES inbox_items(id) ON DELETE CASCADE,
    kind                TEXT        NOT NULL
                            CHECK (kind IN ('light','dark','bias','flat','dark_flat')),
    count               INTEGER     NOT NULL DEFAULT 0,
    destination_preview TEXT,                        -- preview path from active pattern (spec 015)
    sample_files        TEXT        NOT NULL DEFAULT '[]'  -- JSON array of up to 10 filenames
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_breakdown_item_kind
    ON inbox_classification_breakdown (inbox_item_id, kind);

-- ── inbox_plan_links ─────────────────────────────────────────────────────────
-- Enforces "at most one open Plan per Inbox item" invariant (Ref: E1).
-- A row exists only while the plan is open. On plan apply/discard/fail/cancel,
-- this row is deleted and the inbox_items.state is updated.

CREATE TABLE IF NOT EXISTS inbox_plan_links (
    inbox_item_id   TEXT        NOT NULL PRIMARY KEY
                        REFERENCES inbox_items(id) ON DELETE CASCADE,
    plan_id         TEXT        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    linked_at       TEXT        NOT NULL
);

-- Partial unique index: only one open plan per inbox item.
-- The CHECK constraint on plans.state = open states is enforced at the
-- use-case layer; the partial index here is a defense-in-depth backstop.
-- SQLite partial indexes use WHERE clauses; we enforce uniqueness on
-- inbox_item_id (already PK) so we enforce at most one row per item.
-- The PK on inbox_plan_links(inbox_item_id) already enforces one link per item.

CREATE INDEX IF NOT EXISTS inbox_plan_links_plan
    ON inbox_plan_links (plan_id);
