-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Calibration decisions of a processing run (spec 068, amended D-W5, D-W37,
-- D-W55): the run's Tier 1 calibration plan, append-only decisions keyed by
-- light group and kind and bound to a committed membership revision, and the
-- drift observations of adopted masters made at assignment. The run's policy
-- is `views.calibration_policy`. Requirements, states, readiness and the
-- handoff are computed on read and never stored. Structured values are
-- shared-model JSON.

-- A run without a row reads revision 0 with the default kinds dark and flat.
-- Every decision, policy change and kind change moves the revision by one.
CREATE TABLE IF NOT EXISTS calibration_plans (
    view_id TEXT PRIMARY KEY NOT NULL REFERENCES views (id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    required_kinds TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

-- Append-only: the latest row per run, light group and kind is effective. An
-- input-bound row records every file it binds with the SHA-256 hashed for it.
CREATE TABLE IF NOT EXISTS calibration_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    view_id TEXT NOT NULL REFERENCES views (id),
    view_revision INTEGER NOT NULL,
    light_group TEXT NOT NULL,
    light_session_ids TEXT NOT NULL,
    light_asset_ids TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bias', 'dark', 'flat')),
    resolution TEXT NOT NULL CHECK (resolution IN
        ('automatic', 'accepted', 'exception', 'excluded', 'withdrawn')),
    input TEXT,
    input_session_id TEXT REFERENCES sessions (id),
    input_master_id TEXT REFERENCES adopted_masters (id),
    inputs TEXT NOT NULL,
    criteria TEXT NOT NULL,
    reason TEXT,
    plan_revision INTEGER NOT NULL CHECK (plan_revision > 0),
    decided_at TEXT NOT NULL,
    FOREIGN KEY (view_id, view_revision) REFERENCES view_revisions (view_id, revision),
    CHECK ((resolution IN ('automatic', 'accepted', 'exception')) = (input IS NOT NULL)),
    CHECK ((input IS NULL) OR json_array_length(inputs) > 0),
    CHECK (resolution != 'exception' OR reason IS NOT NULL),
    CHECK (input IS NULL OR (input_session_id IS NULL) != (input_master_id IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS calibration_decisions_requirement
    ON calibration_decisions (view_id, light_group, kind);

CREATE TRIGGER IF NOT EXISTS calibration_decisions_append_only_update
BEFORE UPDATE ON calibration_decisions
BEGIN SELECT RAISE(ABORT, 'calibration decisions are append-only'); END;

-- Only Empty Trash removes a run's decisions, with its record (views.sql
-- `run_record_removals`).
CREATE TRIGGER IF NOT EXISTS calibration_decisions_append_only_delete
BEFORE DELETE ON calibration_decisions
WHEN NOT EXISTS (SELECT 1 FROM run_record_removals WHERE view_id = OLD.view_id)
BEGIN SELECT RAISE(ABORT, 'calibration decisions are append-only'); END;

-- An adopted master whose library copy last hashed, at assignment, against
-- something other than its adoption record (CAL-AC-10). The row stays until
-- an assignment hashes the adopted bytes again; reads never hash.
CREATE TABLE IF NOT EXISTS calibration_master_drift (
    master_id TEXT PRIMARY KEY NOT NULL REFERENCES adopted_masters (id),
    detail TEXT NOT NULL,
    observed_at TEXT NOT NULL
) STRICT;
