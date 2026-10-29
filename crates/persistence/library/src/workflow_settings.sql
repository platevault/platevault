-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- The library's F4 workflow settings (D-W114): framing and panel margins,
-- flat rotation and age, the dark and bias window, the group keyword names,
-- the default input mode, whether raw calibration frames are kept and the
-- old-master badge age (CAL-FR-15, J36 S8), and each band's Moon-avoidance
-- curve (PLAN-FR-02), as shared-model `WorkflowSettings` JSON. One row at
-- most; without it every value reads the owner-approved default at
-- revision 0. Schema version 24 added the calibration and Moon fields.
CREATE TABLE IF NOT EXISTS workflow_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    settings TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
) STRICT;
