// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared session display-name fallback (#654) — the Sessions list and detail
 * both fell back to the bare backend `name` (`Session — {date}`) whenever a
 * session has no `target`, which is IDENTICAL across every same-night,
 * metadata-less session (Journey 4: "each session row must be distinguishable
 * even when FITS metadata is missing"). Append a discriminator so the label
 * is always unique per session, preferring the session's own frame-folder
 * name (human-meaningful) and falling back to the frame count + a short id
 * suffix (always available, guaranteed unique) when no folder is known.
 */

import type { InventorySession } from '@/bindings/index';

/** Last non-empty path segment of a (forward-slash) relative path. */
function folderBasename(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath) return null;
  const parts = relativePath.split('/').filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
}

/**
 * Human-readable, always-unique display name for a session. `target` is used
 * verbatim when present (it is already the object identity, spec 035 US4);
 * otherwise the generic `name` fallback is disambiguated.
 */
export function sessionDisplayName(
  session: Pick<
    InventorySession,
    'target' | 'name' | 'id' | 'frames' | 'relativePath'
  >,
): string {
  if (session.target) return session.target;
  const discriminator =
    folderBasename(session.relativePath) ??
    `${session.frames}f · ${session.id.slice(0, 8)}`;
  return `${session.name} · ${discriminator}`;
}
