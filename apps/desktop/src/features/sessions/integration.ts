// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared total-integration-time computation (#798) — extracted so the
 * Sessions list "Integration" column and the SessionDetail panel compute and
 * format the SAME value from the SAME per-frame exposure × frame count,
 * instead of the list showing the raw per-frame exposure under a column
 * header that promises a total.
 */

import type { InventorySession } from '@/bindings/index';

/** Derive total integration seconds from frames × per-frame exposure. */
export function integrationSeconds(
  session: Pick<InventorySession, 'exposure' | 'frames'>,
): number | null {
  if (!session.exposure) return null;
  const raw = session.exposure.replace(/s$/i, '');
  const secs = parseFloat(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return secs * session.frames;
}

/** Format a total-seconds duration as `1h 30m` / `45m` / `1h`. */
export function fmtSeconds(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Total-integration display value for a session, or `null` when unknown. */
export function integrationLabel(
  session: Pick<InventorySession, 'exposure' | 'frames'>,
): string | null {
  const totalSec = integrationSeconds(session);
  return totalSec != null ? fmtSeconds(totalSec) : null;
}
