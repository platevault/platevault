// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers + constants shared by `TargetSearch` and its `useTargetSearch`
 * hook. Split out (refactor sweep #996) so the hook/component files don't
 * each redeclare the same tuning constants and dedupe logic.
 */

import type { TargetSuggestion, ResolvedTarget } from '@/bindings/aliases';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Contract version for the target.search / target.resolve requests. Moved here
 * off the retired @/api/commands wrapper (spec 037 FR-004: move, not drop).
 */
export const TARGET_SEARCH_CONTRACT_VERSION = '1.0';

export const DEBOUNCE_MS = 300;
export const DEFAULT_LIMIT = 20;
/**
 * Minimum trimmed query length before the SIMBAD long-tail phase fires (US3,
 * T022). #843: this gates the RAW input, before the backend's catalog-prefix
 * normalization (`M31` -> `m 31`) — duplicating that normalization here (NFKC
 * + prefix-expansion + punctuation stripping, `crates/targeting/src/
 * normalize.rs`) would recreate the exact cross-crate drift risk that module
 * exists to avoid. `2` is the lower bound the issue accepts instead: the
 * debounce already protects the network, and cache/seed lookups are cheap, so
 * a two-character gate (letting legitimate un-spaced 2-char designations like
 * `M1`..`M9` through) costs nothing extra in the common case.
 */
export const MIN_RESOLVE_LEN = 2;
/** Estimated suggestion-row height (px) for the virtualizer. */
export const OPTION_ESTIMATE = 44;
/**
 * Bounds for the empty-result-while-warming retry (#818): `target.search`
 * reports `cacheWarming = true` while the shared resolve cache's background
 * seed/durable-row re-warm is still running (one write transaction per
 * ~1000-entry chunk since the #818 follow-up — nothing in a given chunk is
 * visible to a reader until THAT chunk's transaction commits, so a query for
 * an object in a not-yet-committed chunk can still legitimately come back
 * empty). A query that lands in this window and comes back empty is retried
 * on this interval for as long as the backend keeps reporting
 * `cacheWarming = true` — never on an ordinary (settled) miss, so the common
 * case pays no extra latency. `WARM_RETRY_BUDGET_MS` is a safety cap, not
 * the expected wait: it only bites if the backend's own flag never flips
 * back to `false` (e.g. a stuck/crashed warm task), well past the seconds a
 * real warm takes even on a slow disk.
 */
export const WARM_RETRY_INTERVAL_MS = 250;
export const WARM_RETRY_BUDGET_MS = 30_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Project a SIMBAD `ResolvedTarget` into the suggestion row shape. */
export function resolvedToSuggestion(t: ResolvedTarget): TargetSuggestion {
  return {
    targetId: t.targetId,
    primaryDesignation: t.primaryDesignation,
    commonName: t.commonName ?? null,
    objectType: t.objectType,
    matchedAlias: null,
    source: t.source,
  };
}

/**
 * Merge a long-tail resolved suggestion into the local hits, de-duped.
 *
 * Dedupe keys: canonical `targetId` (primary), and — to catch the case where
 * the same physical object is already present from the seed/cache under a
 * different row id — a case-insensitive `primaryDesignation` match. Local hits
 * always win (they are kept; the resolved row is dropped when it collides).
 */
export function mergeDedupe(
  local: TargetSuggestion[],
  resolved: TargetSuggestion,
): TargetSuggestion[] {
  const designation = resolved.primaryDesignation.trim().toLowerCase();
  const isDuplicate = local.some(
    (s) =>
      s.targetId === resolved.targetId ||
      s.primaryDesignation.trim().toLowerCase() === designation,
  );
  return isDuplicate ? local : [...local, resolved];
}
