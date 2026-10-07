-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Naming templates (spec 071 STO-IMP-FR-07): one row per overridden frame
-- type. A type at its built-in default has no row; Restore defaults deletes
-- them all. Templates are validated by the application before they are stored
-- and again whenever they are resolved.

CREATE TABLE IF NOT EXISTS naming_templates (
    frame_type TEXT PRIMARY KEY NOT NULL CHECK (frame_type IN (
        'light', 'flat', 'dark', 'bias', 'master_flat', 'master_dark', 'master_bias'
    )),
    template TEXT NOT NULL CHECK (length(trim(template)) > 0)
) STRICT;
