// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backing-source connectivity surface (#889) — a session on a missing,
 * disabled, or reconnect-required root previously rendered identically to a
 * healthy one, with file-touching actions (Reveal) that would just fail with
 * no explanation. Shared so the Sessions list and detail panel render the
 * SAME chip + gating from the SAME state.
 */

import type { InventorySourceState } from '@/bindings/index';
import type { PillVariant } from '@/ui';
import { m } from '@/lib/i18n';

/** File-touching actions (Reveal, etc.) are only safe when the source is active. */
export function isSourceActionable(state: InventorySourceState): boolean {
  return state === 'active';
}

/** Chip label for a non-active source state; `null` for the healthy `active` state. */
export function connectivityLabel(state: InventorySourceState): string | null {
  switch (state) {
    case 'active':
      return null;
    case 'missing':
      return m.sessions_source_missing();
    case 'disabled':
      return m.sessions_source_disabled();
    case 'reconnect_required':
      return m.sessions_source_reconnect_required();
  }
}

/** Pill tone per state — `reconnect_required` is recoverable (warn); the rest are `danger`. */
export function connectivityVariant(state: InventorySourceState): PillVariant {
  return state === 'reconnect_required' ? 'warn' : 'danger';
}
