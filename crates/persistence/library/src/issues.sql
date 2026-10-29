-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
-- Issue dismissals (063 FR-032, D-W92, D-W158): the fingerprint of each issue
-- the user dismissed, which is its kind, subject, count and bytes. An issue
-- counts again as soon as its fingerprint differs. Reading never writes here:
-- a row goes on Restore, or when a location's availability write ends the
-- offline or denied issue it hides, so going offline again brings it back.
-- Dismissing changes nothing else.

CREATE TABLE IF NOT EXISTS issue_dismissals (
    fingerprint TEXT PRIMARY KEY NOT NULL CHECK (length(fingerprint) > 0),
    dismissed_at TEXT NOT NULL
) STRICT;
