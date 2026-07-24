// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure selection-handoff decision functions for the inbox page. These run
 * during render (no side effects, no hooks) and are tested independently.
 */

/**
 * Pick which post-split sub-item selection should move to after a
 * `reclassify_v2` call (issue #755 CI fix, R-14 re-split). Prefers the
 * response's own resolved (single-type, no missing-mandatory) sub-items over
 * re-deriving a target from list state — the response is authoritative for
 * what the group split into; the item list is only an async projection of
 * it. Ties (equal frameType groups) break on file count, since a bulk edit's
 * largest resulting group is the one the user was most likely acting on.
 * Returns `null` when every sub-item is still needs-review (no safe target).
 */
export function pickReclassifyTarget(
  subItems: Array<{
    inboxItemId: string;
    frameType?: string | null;
    fileCount: number;
    missingMandatory?: string[] | null;
  }>,
): string | null {
  const resolved = subItems.filter(
    (si) => si.frameType != null && (si.missingMandatory?.length ?? 0) === 0,
  );
  if (resolved.length === 0) return null;
  return resolved.reduce((best, si) =>
    si.fileCount > best.fileCount ? si : best,
  ).inboxItemId;
}

/** Outcome of {@link resolveReclassifyHandoff}: keep waiting, navigate, or give up. */
export type ReclassifyHandoffDecision =
  | { action: 'wait' }
  | { action: 'navigate'; id: string }
  | { action: 'giveUp' };

/**
 * Decide what the post-split selection handoff should do THIS render (issue
 * #755 CI fix round 3; adapted for issue #644's id-based `?selected=<id>`
 * scheme — selection is no longer a list index, so there is no index to
 * navigate to, only the id itself, once it's confirmed reachable). Bounded
 * lifetime: `pendingId` must not stay set forever just because the active
 * search/kind filter happens to hide the post-split item — that would gate
 * `useStaleSelectionCleanup` open indefinitely for everything else on the
 * page.
 *
 * Judges "arrived" vs "genuinely not coming back" against the UNFILTERED
 * `items` list (only once it has settled — `listLoading === false` — so a
 * refetch already in flight isn't mistaken for "never arriving"). Once
 * settled: absent from `items` entirely → give up (nothing will ever
 * appear); present in `items` but absent from `filteredItems` → give up too
 * (it exists, but the user's own filter hides it — there is nothing visible
 * to select); present in both → navigate to it by id.
 */
export function resolveReclassifyHandoff(
  pendingId: string,
  items: Array<{ inboxItemId: string }>,
  filteredItems: Array<{ inboxItemId: string }>,
  listLoading: boolean,
): ReclassifyHandoffDecision {
  if (listLoading) return { action: 'wait' };
  if (!items.some((it) => it.inboxItemId === pendingId)) {
    return { action: 'giveUp' };
  }
  const visible = filteredItems.some((it) => it.inboxItemId === pendingId);
  return visible ? { action: 'navigate', id: pendingId } : { action: 'giveUp' };
}

/** Outcome of {@link resolveClassifiedGroupSelection}. */
export type ClassifiedGroupSelection =
  | { action: 'wait' }
  | { action: 'select'; id: string }
  | { action: 'none' };

/**
 * CHK011 (spec 058 T017/FR-023): where selection goes when a source-group row
 * is replaced by the items classification materialized from it.
 *
 * The rule is deliberately asymmetric:
 *
 *  - **N = 1** — select that item. The folder resolved to exactly one thing, so
 *    putting the user on it is unambiguous and saves a click.
 *  - **N > 1** — select NOTHING here. The rule says the folder group header,
 *    never a sibling, because picking one sibling would silently designate a
 *    primary — the thing D-002 forbids and which #1102 deleted `ids.next()` to
 *    avoid. The header is part of T034's grouping UI and does not exist yet, so
 *    selecting nothing is the correct conservative behaviour until it does.
 *    Selecting a sibling now would be actively wrong, not merely early.
 *  - **N = 0** — nothing to select. A source-group row was never selectable
 *    (FR-016), so unlike the reclassify handoff there is no prior selection to
 *    restore or lose.
 *
 * Bounded the same way {@link resolveReclassifyHandoff} is: it only decides
 * once the list has settled, so an in-flight refetch is never mistaken for
 * "the items never arrived".
 */
export function resolveClassifiedGroupSelection(
  sourceGroupId: string,
  items: Array<{ inboxItemId: string; sourceGroupId?: string | null }>,
  listLoading: boolean,
): ClassifiedGroupSelection {
  if (listLoading) return { action: 'wait' };
  const siblings = items.filter((it) => it.sourceGroupId === sourceGroupId);
  if (siblings.length === 1) {
    return { action: 'select', id: siblings[0].inboxItemId };
  }
  return { action: 'none' };
}
