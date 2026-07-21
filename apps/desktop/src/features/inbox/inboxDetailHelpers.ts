// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure presentation helpers for the Inbox detail pane.
 *
 * Extracted from `InboxDetail.tsx` (#994) — no React, no IPC, so each one is
 * unit-testable on its own and the detail component stays about composition.
 */

import type { PillVariant } from '@/ui';
import type { InboxClassifyResponse } from './store';

/**
 * Resolve an inbox item's reveal target: the source root joined with the
 * item's `relativePath`. Mirrors `features/sessions/revealInventory.ts`'s
 * `resolveRevealPath` (same tested contract: backend `relativePath` is always
 * forward-slash-normalized — `crates/app/inbox/src/scan.rs` — while the root
 * is native, so every separator is rewritten to the root's own). Duplicated
 * rather than imported to keep this feature's scope self-contained; the two
 * helpers must stay behaviorally identical if either changes.
 */
export function resolveInboxRevealPath(
  rootPath: string,
  relativePath: string,
): string {
  if (!relativePath) return rootPath;
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const root = rootPath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, sep);
  return `${root}${sep}${rel}`;
}

/** "exposureS" → "exposure S" (best-effort label for a registry key with no i18n entry). */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function classificationVariant(type: string): PillVariant {
  switch (type) {
    case 'single_type':
      return 'info';
    case 'mixed':
      return 'warn';
    case 'unclassified':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export const FRAME_TYPE_OPTIONS = [
  'light',
  'dark',
  'bias',
  'flat',
  'dark_flat',
] as const;

/**
 * Applicable destination-root category for a frame type (point 1: only show
 * libraries that can actually receive this image type). Light frames go to a
 * "raw" root; calibration frames (bias/dark/flat) + their masters go to a
 * "calibration" root. Returns null when we can't narrow (e.g. mixed) — then all
 * roots are shown. NOTE: this is a pragmatic frontend mapping; the spec-045
 * iterate (single-type sub-items) will make this authoritative per item.
 */
export function applicableRootCategory(
  frameType?: string | null,
): string | null {
  if (!frameType) return null;
  const ft = frameType.toLowerCase();
  if (ft.includes('light')) return 'raw';
  if (ft.includes('bias') || ft.includes('dark') || ft.includes('flat'))
    return 'calibration';
  return null;
}

/** Last path segment of a relative file path (forward- or back-slash separated). */
export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Second-to-last path segment (the basename's parent directory name). */
export function parentSegment(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/**
 * Build destination-root option labels, disambiguating roots that share a
 * basename (issue #866): two registered roots at different locations but the
 * same folder name (e.g. two "Lights" folders) rendered identically as
 * "Lights · raw" with no way to tell which one a pick actually targets.
 * Duplicates get their parent directory appended; unique basenames are
 * unaffected.
 */
export function buildRootLabels(
  roots: Array<{ id: string; path: string; category: string }>,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of roots) {
    const base = basename(r.path);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const r of roots) {
    const base = basename(r.path);
    const parent = parentSegment(r.path);
    const disambiguated =
      (counts.get(base) ?? 0) > 1 && parent ? `${base} (${parent})` : base;
    labels.set(r.id, `${disambiguated} · ${r.category}`);
  }
  return labels;
}

/**
 * Format an exposure length in seconds for display (issue #789): raw FITS
 * EXPTIME floats carry IEEE-754 noise (e.g. `6.92447668013071`) that reads as
 * fabricated/slop rather than a real capture value. Whole-second exposures
 * show no decimal; fractional exposures round to 2 decimal places.
 */
export function formatExposureSeconds(s: number): string {
  const rounded = Math.round(s * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded} s`;
}
