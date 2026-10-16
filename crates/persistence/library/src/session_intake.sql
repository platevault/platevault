-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Session intake and calibration pins (spec 064 LIB-FR-17, LIB-FR-20 to
-- LIB-FR-26; 068 CAL-FR-19 to CAL-FR-23; D-W78, D-W101 to D-W106, D-W113).
--
-- Finish review is recorded per session at the grouping revision it covered;
-- a regroup that adds frames to the session leaves it Needs review again, and
-- reopening review deletes the row. A light session's calibration record
-- holds every kind (bias, dark, flat), each unresolved, suggested, pinned to
-- a raw set or a master version, or declined (No). Pins are shared-model
-- `PinState` JSON; the input columns repeat the target for foreign keys and
-- reference queries and must agree with it. Every change advances the
-- session's calibration generation, which writers compare (CAS) so a stale
-- matching job or review never overwrites a pin or a No. A pin stays when its
-- file changes or goes missing (D-W113).

CREATE TABLE IF NOT EXISTS session_reviews (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
    grouping_revision INTEGER NOT NULL CHECK (grouping_revision >= 0),
    finished_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS session_calibration (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
    generation INTEGER NOT NULL CHECK (generation > 0),
    -- Matching still has to run: recorded in the ingestion transaction, and
    -- on a rig confirmation or calibration arriving later; reconciled after
    -- commit and on restart.
    matching_pending INTEGER NOT NULL CHECK (matching_pending IN (0, 1)),
    updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS session_calibration_pending
    ON session_calibration (session_id) WHERE matching_pending = 1;

CREATE TABLE IF NOT EXISTS session_calibration_kinds (
    session_id TEXT NOT NULL REFERENCES session_calibration (session_id),
    kind TEXT NOT NULL CHECK (kind IN ('bias', 'dark', 'flat')),
    state TEXT NOT NULL CHECK (state IN ('unresolved', 'suggested', 'pinned', 'declined')),
    input_session_id TEXT REFERENCES sessions (id),
    input_master_id TEXT REFERENCES adopted_masters (id),
    input_revision INTEGER CHECK (input_revision IS NULL OR input_revision >= 0),
    pin TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (session_id, kind),
    CHECK (json_extract(pin, '$.state') = state),
    CHECK ((state IN ('suggested', 'pinned'))
        = (input_session_id IS NOT NULL OR input_master_id IS NOT NULL)),
    CHECK (input_session_id IS NULL OR input_master_id IS NULL),
    CHECK ((input_revision IS NULL) = (input_session_id IS NULL AND input_master_id IS NULL)),
    CHECK (input_session_id IS NOT session_id),
    CHECK (input_session_id IS json_extract(pin, '$.target.input.sessionId')),
    CHECK (input_master_id IS json_extract(pin, '$.target.input.masterId')),
    CHECK (input_revision IS coalesce(
        json_extract(pin, '$.target.input.groupingRevision'),
        json_extract(pin, '$.target.input.revision')
    ))
) STRICT;
-- Hide and Move to Trash of a master, and a raw set's removal, join the
-- sessions that use it.
CREATE INDEX IF NOT EXISTS session_calibration_kinds_master
    ON session_calibration_kinds (input_master_id) WHERE input_master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS session_calibration_kinds_raw_set
    ON session_calibration_kinds (input_session_id) WHERE input_session_id IS NOT NULL;

-- A calibration record starts with every kind unresolved.
CREATE TRIGGER IF NOT EXISTS session_calibration_kinds_created
AFTER INSERT ON session_calibration
BEGIN
    INSERT INTO session_calibration_kinds (session_id, kind, state, pin, decided_at) VALUES
        (NEW.session_id, 'bias', 'unresolved', '{"state":"unresolved"}', NEW.updated_at),
        (NEW.session_id, 'dark', 'unresolved', '{"state":"unresolved"}', NEW.updated_at),
        (NEW.session_id, 'flat', 'unresolved', '{"state":"unresolved"}', NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS session_calibration_kinds_kept
BEFORE DELETE ON session_calibration_kinds
BEGIN SELECT RAISE(ABORT, 'a session keeps a state for every calibration kind'); END;

CREATE TRIGGER IF NOT EXISTS session_calibration_kinds_identity
BEFORE UPDATE OF session_id, kind ON session_calibration_kinds
WHEN NEW.session_id IS NOT OLD.session_id OR NEW.kind IS NOT OLD.kind
BEGIN SELECT RAISE(ABORT, 'a session keeps a state for every calibration kind'); END;

CREATE TRIGGER IF NOT EXISTS session_calibration_kinds_generation
AFTER UPDATE ON session_calibration_kinds
BEGIN
    UPDATE session_calibration SET generation = generation + 1
    WHERE session_id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS session_calibration_pending_generation
AFTER UPDATE OF matching_pending ON session_calibration
WHEN NEW.matching_pending IS NOT OLD.matching_pending AND NEW.generation = OLD.generation
BEGIN
    UPDATE session_calibration SET generation = generation + 1
    WHERE session_id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS session_calibration_generation_forward
BEFORE UPDATE OF generation ON session_calibration
WHEN NEW.generation < OLD.generation
BEGIN SELECT RAISE(ABORT, 'a calibration generation only advances'); END;
