// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useDetailDock — spec 054 (Adaptive Detail-Panel Dock) T006.
 *
 * Resolves a page's EFFECTIVE detail placement, in precedence order:
 *   1. `forcedPlacement` — a page-level hard override (e.g. Inbox always
 *      forces `'split'`; a future page could force `'bottom'`). Deliberately
 *      generic rather than a `page === 'inbox'` special case, so any page can
 *      hard-set its shape without a new branch in this hook.
 *   2. the user's persisted per-page pin (`data/preferences.ts` detailDock).
 *   3. the adaptive heuristic — measured window width (wide/narrow threshold)
 *      + measured page-available content width (the pin→bottom fallback,
 *      research.md D2/D3 — the sidebar is collapsible, so window width alone
 *      can't tell whether a side panel + a usable table fit).
 */

import { useEffect, useState, type RefObject } from 'react';
import { getDetailDock, type DetailDockPageKey } from '@/data/preferences';

/** Targets is the widest table — it needs the most room before a side panel
 * is worth engaging (research.md D1). */
export const TARGETS_DOCK_THRESHOLD = 1500;
/** Shared default for the other list-dominant pages (research.md D1). */
export const DEFAULT_DOCK_THRESHOLD = 1400;
/** Minimum side-panel / split-list width (spec FR-005). */
export const MIN_SIDE_WIDTH = 320;
/** Minimum usable table width beside a side panel (research.md D3). */
export const TABLE_FLOOR = 640;

/** Dead-band (px) around the threshold: a resize that only jitters a
 * sub-pixel amount across the boundary must not flip placement back and
 * forth (spec edge case: "no flicker or oscillation while resizing"). */
const HYSTERESIS = 4;

export type EffectivePlacement = 'side' | 'bottom' | 'split';

export interface UseDetailDockResult {
  effectivePlacement: EffectivePlacement;
  windowWidth: number;
  pageWidth: number;
}

function thresholdFor(page: DetailDockPageKey): number {
  return page === 'targets' ? TARGETS_DOCK_THRESHOLD : DEFAULT_DOCK_THRESHOLD;
}

export function useDetailDock(
  page: DetailDockPageKey,
  pageRef: RefObject<HTMLElement | null>,
  forcedPlacement?: EffectivePlacement,
): UseDetailDockResult {
  const threshold = thresholdFor(page);

  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : Math.round(window.innerWidth),
  );
  const [pageWidth, setPageWidth] = useState(0);
  // Whether the window currently counts as "wide" for adaptive placement.
  // Tracked as its own piece of state (rather than recomputed inline from
  // `windowWidth` every render) so the hysteresis band below can compare
  // against the PREVIOUS decision, not just the raw width.
  const [isWide, setIsWide] = useState(() => windowWidth >= threshold);

  useEffect(() => {
    const handleResize = () => setWindowWidth(Math.round(window.innerWidth));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const node = pageRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setPageWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageRef]);

  // Re-resolve the wide/narrow bit whenever the measured width changes.
  // Comparing against the PREVIOUS decision (via the functional update) is
  // the hysteresis: once wide, stay wide until width drops threshold-4; once
  // narrow, stay narrow until width clears threshold+4. A plain `>= threshold`
  // recompute every render would flip on a single-pixel jitter at the
  // boundary (spec edge case).
  useEffect(() => {
    setIsWide((prevWide: boolean) => {
      const band = prevWide ? threshold - HYSTERESIS : threshold + HYSTERESIS;
      return windowWidth >= band;
    });
  }, [windowWidth, threshold]);

  if (forcedPlacement) {
    return { effectivePlacement: forcedPlacement, windowWidth, pageWidth };
  }

  const { mode } = getDetailDock(page);

  let effectivePlacement: EffectivePlacement;
  if (mode === 'bottom') {
    effectivePlacement = 'bottom';
  } else if (mode === 'side') {
    // Pinned side placement falls back to bottom when the page can't fit the
    // minimum side width alongside a usable table (research.md D3).
    const fits = pageWidth - MIN_SIDE_WIDTH >= TABLE_FLOOR;
    effectivePlacement = fits ? 'side' : 'bottom';
  } else {
    effectivePlacement = isWide ? 'side' : 'bottom';
  }

  return { effectivePlacement, windowWidth, pageWidth };
}
