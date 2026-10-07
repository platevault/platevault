-- Copyright (C) 2024-2026 Sjors Robroek
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Frame review thumbnails (spec 067 PIX-FR-12, D-W40): display-only decodes,
-- each bound to the SHA-256 of the bytes it was decoded from and the
-- observation those bytes were read under. Only the latest bytes of an asset
-- stay cached. Rows are re-derivable (Tier 2) and never change an asset,
-- digest, quality, session or measurement row.

CREATE TABLE IF NOT EXISTS frame_thumbnails (
    asset_id TEXT NOT NULL REFERENCES assets (id),
    sha256 TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    stretch TEXT NOT NULL,
    plane INTEGER NOT NULL CHECK (plane >= 0),
    level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 8),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    gray BLOB NOT NULL,
    mask BLOB,
    decoded_at TEXT NOT NULL,
    PRIMARY KEY (asset_id, sha256)
) STRICT;
