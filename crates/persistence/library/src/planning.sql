-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Observing plans (spec 072): Tier 1 planning decisions appended to the clean
-- library catalog after projects.sql. Windows, upcoming reminders and calendar
-- snapshots are computed on read and never stored. Planning writes touch only
-- these tables, never a Target, session, Project or image file.

-- Saved observing sites; the zone is an IANA name the user chose.
CREATE TABLE IF NOT EXISTS observing_sites (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0 AND name = trim(name)),
    latitude_deg REAL NOT NULL CHECK (latitude_deg >= -90 AND latitude_deg <= 90),
    longitude_deg REAL NOT NULL CHECK (longitude_deg >= -180 AND longitude_deg <= 180),
    elevation_m REAL,
    time_zone TEXT NOT NULL CHECK (length(time_zone) > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

-- The one stored planning setting; no row reads no default at revision 0.
CREATE TABLE IF NOT EXISTS planning_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_site_id TEXT REFERENCES observing_sites (id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
) STRICT;

-- The Planned mark, keyed by Target; never a column of `targets`.
CREATE TABLE IF NOT EXISTS target_plans (
    target_id TEXT PRIMARY KEY NOT NULL REFERENCES targets (id),
    planned INTEGER NOT NULL CHECK (planned IN (0, 1)),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
) STRICT;

-- Per-Target reminder subscriptions with the values confirmed at activation;
-- `criteria` is the shared model's JSON of the explicit criteria.
CREATE TABLE IF NOT EXISTS reminder_subscriptions (
    target_id TEXT PRIMARY KEY NOT NULL REFERENCES targets (id),
    site_id TEXT NOT NULL REFERENCES observing_sites (id),
    site_revision INTEGER NOT NULL CHECK (site_revision > 0),
    settings_revision INTEGER NOT NULL CHECK (settings_revision > 0),
    criteria TEXT NOT NULL,
    lead_minutes INTEGER NOT NULL CHECK (lead_minutes >= 1 AND lead_minutes <= 1440),
    state TEXT NOT NULL
        CHECK (state IN ('enabled', 'blocked', 'needs_reconfirmation', 'disabled')),
    block_reason TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    activated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((state = 'blocked') = (block_reason IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS reminder_subscriptions_site ON reminder_subscriptions (site_id);

-- One row per claimed Target, site and UTC window-start identity, committed
-- before submission. Every state keeps the identity taken; none says delivered.
CREATE TABLE IF NOT EXISTS reminder_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL REFERENCES targets (id),
    site_id TEXT NOT NULL REFERENCES observing_sites (id),
    window_start_utc TEXT NOT NULL,
    window_end_utc TEXT NOT NULL,
    night TEXT NOT NULL,
    due_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('sending', 'submitted', 'failed', 'uncertain')),
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (target_id, site_id, window_start_utc)
) STRICT;
CREATE INDEX IF NOT EXISTS reminder_deliveries_state ON reminder_deliveries (state);
