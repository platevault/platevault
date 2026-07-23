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
import { formatIntegration } from '@/lib/format';

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

/**
 * Total-integration display value for a session (#631: formatting now comes
 * from the shared `formatIntegration`; this only supplies the derivation).
 */
export function integrationLabel(
  session: Pick<InventorySession, 'exposure' | 'frames'>,
): string {
  return formatIntegration(integrationSeconds(session));
}
