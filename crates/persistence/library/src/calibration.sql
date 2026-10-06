-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Calibration inputs (spec 068): Tier 1 calibration plans, append-only decisions
-- bound to committed View revisions, master adoption reviews and operations, and
-- adopted masters. Raw sets, detected candidates, evaluations and handoff state
-- are computed on read and never stored. Structured values are shared-model JSON.

-- A View without a row reads revision 0 with the default kinds dark and flat.
CREATE TABLE IF NOT EXISTS calibration_plans (
    view_id TEXT PRIMARY KEY NOT NULL REFERENCES views (id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    required_kinds TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

-- A durable adoption review; it writes no file. The source is an indexed asset
-- or, once 070 lands, a RES output.
CREATE TABLE IF NOT EXISTS adoption_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    state TEXT NOT NULL CHECK (state IN ('open', 'adopted')),
    source_asset_id TEXT REFERENCES assets (id),
    source TEXT NOT NULL,
    classification TEXT NOT NULL,
    observed TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination_location_id TEXT NOT NULL REFERENCES locations (id),
    destination_path_key BLOB NOT NULL,
    created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS adoption_reviews_source ON adoption_reviews (source_asset_id)
    WHERE source_asset_id IS NOT NULL;

-- A master copied into a Calibration location and verified there. The source's
-- catalog corrections are not carried (R16).
CREATE TABLE IF NOT EXISTS adopted_masters (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    kind TEXT NOT NULL CHECK (kind IN ('bias', 'dark', 'flat')),
    location_id TEXT NOT NULL REFERENCES locations (id),
    path_key BLOB NOT NULL,
    fingerprint TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    classification TEXT NOT NULL,
    observed TEXT NOT NULL,
    review_id TEXT NOT NULL UNIQUE REFERENCES adoption_reviews (id),
    source_asset_id TEXT REFERENCES assets (id),
    provenance TEXT NOT NULL,
    adopted_at TEXT NOT NULL,
    UNIQUE (location_id, path_key)
) STRICT;
CREATE INDEX IF NOT EXISTS adopted_masters_source ON adopted_masters (source_asset_id)
    WHERE source_asset_id IS NOT NULL;

-- One confirmation of a review; each lifecycle phase commits before the next
-- file effect. At most one operation of a review runs at a time.
CREATE TABLE IF NOT EXISTS adoption_operations (
    id TEXT PRIMARY KEY NOT NULL,
    review_id TEXT NOT NULL REFERENCES adoption_reviews (id),
    state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed', 'interrupted')),
    phase TEXT NOT NULL CHECK (phase IN
        ('intent', 'temp_created', 'copied', 'installed', 'verified', 'registered')),
    temporary TEXT,
    installed TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    master_id TEXT REFERENCES adopted_masters (id),
    CHECK ((state = 'completed') = (master_id IS NOT NULL)),
    CHECK ((state = 'running') = (finished_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS adoption_operations_one_running
    ON adoption_operations (review_id) WHERE state = 'running';

-- Append-only: the latest row per View, light Session and kind is effective.
CREATE TABLE IF NOT EXISTS calibration_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT NOT NULL REFERENCES views (id),
    view_revision INTEGER NOT NULL,
    light_session_id TEXT NOT NULL REFERENCES sessions (id),
    grouping_revision INTEGER NOT NULL CHECK (grouping_revision >= 0),
    light_asset_ids TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bias', 'dark', 'flat')),
    resolution TEXT NOT NULL CHECK (resolution IN ('accepted', 'exception', 'withdrawn')),
    input TEXT,
    input_session_id TEXT REFERENCES sessions (id),
    input_master_id TEXT REFERENCES adopted_masters (id),
    inputs TEXT NOT NULL,
    criteria TEXT NOT NULL,
    reason TEXT,
    plan_revision INTEGER NOT NULL CHECK (plan_revision > 0),
    decided_at TEXT NOT NULL,
    FOREIGN KEY (view_id, view_revision) REFERENCES view_revisions (view_id, revision),
    CHECK ((resolution = 'withdrawn') = (input IS NULL)),
    CHECK ((resolution = 'exception') = (reason IS NOT NULL)),
    CHECK (input IS NULL OR (input_session_id IS NULL) != (input_master_id IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS calibration_decisions_requirement
    ON calibration_decisions (view_id, light_session_id, kind);

CREATE TRIGGER IF NOT EXISTS calibration_decisions_append_only_update
BEFORE UPDATE ON calibration_decisions
BEGIN SELECT RAISE(ABORT, 'calibration decisions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS calibration_decisions_append_only_delete
BEFORE DELETE ON calibration_decisions
BEGIN SELECT RAISE(ABORT, 'calibration decisions are append-only'); END;
