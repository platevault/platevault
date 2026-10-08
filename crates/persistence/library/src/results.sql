-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Results (spec 070 RES-FR-01..05/08/10, CAL-FR-06): the files discovered in
-- a run's or run group's recorded Results folder (prepare.sql
-- `results_folders`), products the user attached from elsewhere, accepted
-- products used as inputs of another run, and the once-only offer of a
-- generated calibration master. Paths are native-path JSON; kinds,
-- attributions and fingerprints are shared-model JSON.

-- One file of an owner: Pending while still being written, a recognized
-- intermediate, an inspected candidate, an attached product or an accepted
-- one. `sha256` is the latest inspection's digest; acceptance records the
-- digest the bytes matched and keeps it while they drift. A discovered file
-- names the revision it came from: a run's preparation revision, or a run
-- group's Prepare all revision for its Assembled mosaic.
CREATE TABLE IF NOT EXISTS result_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT REFERENCES views (id),
    group_id TEXT REFERENCES view_groups (id),
    path TEXT NOT NULL UNIQUE,
    kind TEXT,
    availability TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('pending', 'candidate', 'intermediate', 'attached', 'accepted')
    ),
    association TEXT NOT NULL CHECK (association IN ('results_folder', 'user_linked')),
    prepared_revision_id TEXT REFERENCES preparation_revisions (id),
    group_preparation_id TEXT REFERENCES group_preparations (id),
    attribution TEXT NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    fingerprint TEXT,
    accepted_sha256 TEXT CHECK (accepted_sha256 IS NULL OR length(accepted_sha256) = 64),
    accepted_fingerprint TEXT,
    accepted_at TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((view_id IS NULL) <> (group_id IS NULL)),
    CHECK ((state = 'accepted') = (accepted_sha256 IS NOT NULL)),
    CHECK ((accepted_sha256 IS NULL) = (accepted_at IS NULL)),
    CHECK ((accepted_sha256 IS NULL) = (accepted_fingerprint IS NULL)),
    CHECK (state <> 'attached' OR association = 'user_linked'),
    CHECK (state NOT IN ('candidate', 'attached') OR sha256 IS NOT NULL),
    CHECK (state NOT IN ('pending', 'intermediate') OR sha256 IS NULL),
    CHECK (prepared_revision_id IS NULL OR view_id IS NOT NULL),
    CHECK (group_preparation_id IS NULL OR group_id IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS result_candidates_view ON result_candidates (view_id)
    WHERE view_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS result_candidates_group ON result_candidates (group_id)
    WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS result_candidates_prepared ON result_candidates (prepared_revision_id);
CREATE INDEX IF NOT EXISTS result_candidates_group_prepared
    ON result_candidates (group_preparation_id) WHERE group_preparation_id IS NOT NULL;

-- An accepted product used as an input of another run, with the digest it had
-- when it was added (RES-FR-05). It adds no members and no integration, and
-- it refuses Move run to Trash of the product's run (RES-FR-10).
CREATE TABLE IF NOT EXISTS view_product_inputs (
    view_id TEXT NOT NULL REFERENCES views (id),
    result_id TEXT NOT NULL REFERENCES result_candidates (id),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    added_at TEXT NOT NULL,
    PRIMARY KEY (view_id, result_id)
) STRICT;
CREATE INDEX IF NOT EXISTS view_product_inputs_result ON view_product_inputs (result_id);

-- CAL's once-only Add to calibration library offer of a generated master
-- found in a run's Results (CAL-FR-06), keyed by file and digest: changed
-- content is a new offer, and Dismiss declines only that file and digest.
CREATE TABLE IF NOT EXISTS master_offers (
    id TEXT PRIMARY KEY NOT NULL,
    result_id TEXT NOT NULL REFERENCES result_candidates (id),
    view_id TEXT NOT NULL REFERENCES views (id),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    classification TEXT NOT NULL,
    observed TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('offered', 'dismissed', 'adopted')),
    offered_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE (path, sha256),
    CHECK ((state = 'offered') = (decided_at IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS master_offers_result ON master_offers (result_id);
CREATE INDEX IF NOT EXISTS master_offers_view ON master_offers (view_id, state);
