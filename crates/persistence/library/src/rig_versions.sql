-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Physical cameras and rig versions (spec 064 LIB-FR-26, 072 PLAN-EQ-FR-07/08;
-- D-W95, D-W104). A camera keeps one identity across rigs; its alias is a
-- unique editable label, and its defaults settle its sessions as No darks or
-- No bias. Editing a rig (an `equipment` row) adds an immutable dated version;
-- a session keeps the version of its confirmed rig it was captured with.
-- Optics are shared-model JSON (`OpticsSignature`); `camera_id` repeats its
-- camera for the foreign key and must agree with it.

CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY NOT NULL,
    model TEXT NOT NULL CHECK (length(trim(model)) > 0),
    -- Comparison keys (trimmed, NFC, lowercase) computed by the model.
    model_key TEXT NOT NULL CHECK (length(model_key) > 0),
    alias TEXT CHECK (alias IS NULL OR length(trim(alias)) > 0),
    alias_key TEXT UNIQUE,
    no_darks INTEGER NOT NULL CHECK (no_darks IN (0, 1)),
    no_bias INTEGER NOT NULL CHECK (no_bias IN (0, 1)),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    CHECK ((alias IS NULL) = (alias_key IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS cameras_model ON cameras (model_key);

CREATE TABLE IF NOT EXISTS rig_versions (
    id TEXT PRIMARY KEY NOT NULL,
    equipment_id TEXT NOT NULL REFERENCES equipment (id),
    valid_from TEXT NOT NULL CHECK (date(valid_from) IS valid_from),
    camera_id TEXT REFERENCES cameras (id),
    optics TEXT NOT NULL,
    rotator TEXT NOT NULL CHECK (rotator IN ('present', 'absent', 'unknown')),
    created_at TEXT NOT NULL,
    UNIQUE (equipment_id, valid_from),
    CHECK (json_extract(optics, '$.cameraId') IS camera_id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS rig_versions_immutable_update
BEFORE UPDATE ON rig_versions
BEGIN SELECT RAISE(ABORT, 'a rig version is immutable; editing a rig adds a version'); END;

CREATE TRIGGER IF NOT EXISTS rig_versions_immutable_delete
BEFORE DELETE ON rig_versions
BEGIN SELECT RAISE(ABORT, 'a rig version is immutable; editing a rig adds a version'); END;

-- The rig version a light session was captured with: a version of its
-- confirmed rig. A later or backdated edit of that rig never rebinds it.
CREATE TABLE IF NOT EXISTS session_rig_versions (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
    rig_version_id TEXT NOT NULL REFERENCES rig_versions (id),
    recorded_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS session_rig_versions_version ON session_rig_versions (rig_version_id);

CREATE TRIGGER IF NOT EXISTS session_rig_versions_confirmed_rig
BEFORE INSERT ON session_rig_versions
WHEN NOT EXISTS (
    SELECT 1 FROM associations a JOIN rig_versions v ON v.equipment_id = a.equipment_id
    WHERE a.session_id = NEW.session_id AND a.kind = 'equipment' AND a.state = 'confirmed'
        AND v.id = NEW.rig_version_id
)
BEGIN SELECT RAISE(ABORT, 'a session records a version of its confirmed rig'); END;

CREATE TRIGGER IF NOT EXISTS session_rig_versions_kept
BEFORE UPDATE ON session_rig_versions
WHEN NEW.session_id IS NOT OLD.session_id OR (
    NEW.rig_version_id IS NOT OLD.rig_version_id
    AND (SELECT equipment_id FROM rig_versions WHERE id = NEW.rig_version_id)
        IS (SELECT equipment_id FROM rig_versions WHERE id = OLD.rig_version_id)
)
BEGIN SELECT RAISE(ABORT, 'a session keeps the rig version it was captured with'); END;

CREATE TRIGGER IF NOT EXISTS session_rig_versions_confirmed_rig_update
BEFORE UPDATE OF rig_version_id ON session_rig_versions
WHEN NOT EXISTS (
    SELECT 1 FROM associations a JOIN rig_versions v ON v.equipment_id = a.equipment_id
    WHERE a.session_id = NEW.session_id AND a.kind = 'equipment' AND a.state = 'confirmed'
        AND v.id = NEW.rig_version_id
)
BEGIN SELECT RAISE(ABORT, 'a session records a version of its confirmed rig'); END;

-- The camera a calibration session was taken with (adopted masters carry
-- theirs on `adopted_masters`): by model while the rigs hold one camera of
-- it, or the camera confirmed at import.
CREATE TABLE IF NOT EXISTS session_cameras (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
    camera_id TEXT NOT NULL REFERENCES cameras (id),
    basis TEXT NOT NULL CHECK (basis IN ('model', 'confirmed')),
    recorded_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS session_cameras_camera ON session_cameras (camera_id);
