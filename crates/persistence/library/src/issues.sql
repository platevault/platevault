-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
-- Issue dismissals (063 FR-032, D-W92, D-W158): the fingerprint of each issue
-- the user dismissed, which is its kind, subject, count and bytes. An issue
-- counts again as soon as its fingerprint differs, and a fingerprint no
-- current issue has is forgotten, so an issue that ends and returns comes
-- back. Dismissing changes nothing else.

CREATE TABLE IF NOT EXISTS issue_dismissals (
    fingerprint TEXT PRIMARY KEY NOT NULL CHECK (length(fingerprint) > 0),
    dismissed_at TEXT NOT NULL
) STRICT;
