/**
 * target-list-utils.ts — Grouping and sorting logic for the targets list (T039b, FR-041).
 *
 * Pure functions so they are unit-testable without a DOM.
 */

import type { TargetFixture } from '@/data/fixtures/targets';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GroupBy = 'none' | 'type' | 'constellation';
export type SortBy = 'name' | 'sessions' | 'hours';

export interface TargetGroup {
  /** Group key shown as a header label. Empty string for the "ungrouped" case. */
  key: string;
  label: string;
  targets: TargetFixture[];
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * Sort a shallow copy of `targets` by `sortBy`.
 * Name: ascending alphabetical.
 * Sessions: descending by session count, then name ascending.
 * Hours: descending by integration hours, then name ascending.
 */
export function sortTargets(targets: TargetFixture[], sortBy: SortBy): TargetFixture[] {
  const copy = [...targets];
  switch (sortBy) {
    case 'name':
      copy.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'sessions':
      copy.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
      break;
    case 'hours':
      copy.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
      break;
  }
  return copy;
}

// ── Group ─────────────────────────────────────────────────────────────────────

/**
 * Group and sort targets into `TargetGroup[]`.
 *
 * When `groupBy = 'none'`, returns a single group with key `''` and all
 * targets sorted by `sortBy`.
 *
 * When `groupBy = 'type'`, groups by `target.kind`. The `kind` values from
 * the fixture are used as-is with capitalization applied for the label.
 *
 * When `groupBy = 'constellation'`, groups are derived from the common name
 * prefix (this is a best-effort heuristic on fixture data; real data would use
 * a constellation FK column). For now, targets without a common name are
 * grouped under "Other".
 *
 * Groups are sorted alphabetically by key. Within each group, targets are
 * sorted by `sortBy`.
 */
export function groupTargets(
  targets: TargetFixture[],
  groupBy: GroupBy,
  sortBy: SortBy,
): TargetGroup[] {
  const sorted = sortTargets(targets, sortBy);

  if (groupBy === 'none') {
    return [{ key: '', label: '', targets: sorted }];
  }

  const map = new Map<string, TargetFixture[]>();

  for (const t of sorted) {
    const key = groupKey(t, groupBy);
    const existing = map.get(key);
    if (existing) {
      existing.push(t);
    } else {
      map.set(key, [t]);
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      key,
      label: groupLabel(key, groupBy),
      targets: items,
    }));
}

function groupKey(t: TargetFixture, groupBy: GroupBy): string {
  if (groupBy === 'type') {
    return t.kind || 'unknown';
  }
  // 'constellation': use common name or fall back to 'Other'
  if (groupBy === 'constellation') {
    return t.common ? t.common.split(' ')[0] ?? 'Other' : 'Other';
  }
  return '';
}

function groupLabel(key: string, _groupBy: GroupBy): string {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}
