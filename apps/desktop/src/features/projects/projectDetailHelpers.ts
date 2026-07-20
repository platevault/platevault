// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure presentation helpers for the Project detail pane.
 *
 * Extracted from `ProjectDetail.tsx` (#998) — no React, no IPC, so each one is
 * unit-testable on its own and the detail component stays about composition.
 */

import type { PillVariant } from '@/ui';
import type {
  ProjectChannelDto_Deserialize,
  ProjectSourceDto_Deserialize,
} from '@/bindings/index';

export function sourceTypeVariant(filter: string): PillVariant {
  const lower = filter.toLowerCase();
  if (lower === 'ha') return 'danger';
  if (lower === 'oiii') return 'info';
  if (lower === 'sii') return 'warn';
  if (lower === 'l' || lower === 'lum') return 'neutral';
  return 'ghost';
}

/** Format a frame count; returns "—" for zero. */
export function fmtFrames(n: number): string {
  return n > 0 ? String(n) : '—';
}

/**
 * Parse a source's `exposure` snapshot string (e.g. "300s", "1.5s") into
 * seconds. Mirrors the backend's `parse_exposure_seconds`
 * (crates/app/projects/src/project_setup.rs) — unparseable/empty values
 * degrade to 0 rather than throwing.
 */
export function parseExposureSeconds(exposure: string): number {
  const trimmed = exposure.trim();
  if (!trimmed) return 0;
  const numeric = trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
  const v = Number.parseFloat(numeric);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

// ── Channels palette ─────────────────────────────────────────────────────────

/**
 * Presentation-ready channel row. `totalFrames`/`totalIntegS` come straight
 * from the server-aggregated `ProjectChannelDto` (P7); only `inSync` is
 * derived client-side (the API has no notion of "backed by a current
 * source" — it just returns the channel list + its totals).
 */
export interface DerivedChannel {
  label: string;
  filter: string;
  totalFrames: number;
  totalIntegS: number;
  inSync: boolean;
}

export function deriveChannels(
  channels: ProjectChannelDto_Deserialize[],
  sources: ProjectSourceDto_Deserialize[],
): DerivedChannel[] {
  const sourceFilters = new Set(
    sources.filter((src) => src.filter).map((src) => src.filter.toUpperCase()),
  );

  return channels.map((ch) => ({
    label: ch.label,
    filter: ch.label,
    totalFrames: ch.subFrames,
    totalIntegS: ch.totalIntegrationS,
    inSync: sourceFilters.has(ch.label.toUpperCase()),
  }));
}

/** Build a short palette name like "HOS" from channel labels. */
export function paletteName(channels: DerivedChannel[]): string {
  return channels.map((c) => c.label[0] ?? c.label).join('');
}
