// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { DetailDockPref, DockPlacement } from '@/bindings';
import { getPreferences, setPreference } from '@/data/preferences';

/**
 * useAdaptiveDock — spec 054 (#936): decides whether a list page's detail
 * panel docks to the SIDE (wide window) or the BOTTOM (narrow window), with
 * a per-page pinned override and a persisted, drag-resizable side width.
 *
 * Placement resolution: `override ?? (windowWidth >= threshold ? 'side' :
 * 'bottom')`. Below `minSideWidth` the side dock is never usable regardless
 * of an override — bottom is the universal narrow-window fallback (decision
 * #8: the shell's enforced 1100x720 minimum must stay fully workable).
 *
 * `dockId` scopes persistence per adopting page (e.g. "sessions", "targets")
 * so each page remembers its own pin + width, stored under the typed
 * `detailDock` preference (#1158).
 */

export type { DockPlacement };

export interface UseAdaptiveDockOptions {
  /** Persistence key scope, e.g. "sessions", "calibration", "targets". */
  dockId: string;
  /** Window width (px) at/above which the side dock engages. Default 1400. */
  threshold?: number;
  /** Side-panel width floor (px), also the absolute floor below which side
   * placement is unavailable regardless of a pinned override. Default 320. */
  minWidth?: number;
  /** Side-panel width ceiling as a fraction of window width. Default 0.5. */
  maxWidthFraction?: number;
  /** Initial/default side-panel width (px) before any resize. Default 420. */
  defaultWidth?: number;
}

export interface UseAdaptiveDockResult {
  /** Resolved placement for the current window width + override. */
  placement: DockPlacement;
  /** Explicit user pin, or null when following the automatic width rule. */
  override: DockPlacement | null;
  /** Set (or clear, via null) the user's pinned placement. Persisted. */
  setOverride: (value: DockPlacement | null) => void;
  /** Current side-panel width (px), clamped to [minWidth, window*maxFraction]. */
  width: number;
  /** Set the side-panel width directly (already clamps). Persisted. */
  setWidth: (value: number) => void;
  /** Pointer-drag handler for a resize handle: pass the handle's onPointerDown. */
  onResizeStart: (event: ReactPointerEvent) => void;
  /** True while a drag-resize is in progress. */
  resizing: boolean;
}

function readStored(dockId: string): DetailDockPref | undefined {
  return getPreferences().detailDock?.[dockId];
}

/** Merges a partial dock update for one `dockId` into the typed preference. */
function writeStored(dockId: string, patch: Partial<DetailDockPref>): void {
  const all = getPreferences().detailDock ?? {};
  const current = all[dockId] ?? { placement: null, width: null };
  setPreference('detailDock', { ...all, [dockId]: { ...current, ...patch } });
}

export function useAdaptiveDock({
  dockId,
  threshold = 1400,
  minWidth = 320,
  maxWidthFraction = 0.5,
  defaultWidth = 420,
}: UseAdaptiveDockOptions): UseAdaptiveDockResult {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [override, setOverrideState] = useState<DockPlacement | null>(
    () => readStored(dockId)?.placement ?? null,
  );
  const [width, setWidthState] = useState<number>(
    () => readStored(dockId)?.width ?? defaultWidth,
  );
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const clampWidth = useCallback(
    (value: number) =>
      Math.min(
        Math.max(value, minWidth),
        Math.max(minWidth, Math.round(window.innerWidth * maxWidthFraction)),
      ),
    [minWidth, maxWidthFraction],
  );

  const setWidth = useCallback(
    (value: number) => {
      const clamped = clampWidth(value);
      setWidthState(clamped);
      writeStored(dockId, { width: clamped });
    },
    [clampWidth, dockId],
  );

  const setOverride = useCallback(
    (value: DockPlacement | null) => {
      setOverrideState(value);
      writeStored(dockId, { placement: value });
    },
    [dockId],
  );

  const sideAvailable = windowWidth >= minWidth * 2;
  const placement: DockPlacement =
    override != null && sideAvailable
      ? override
      : windowWidth >= threshold
        ? 'side'
        : 'bottom';

  const onResizeStart = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setResizing(true);
      const handlePointerMove = (moveEvent: PointerEvent) => {
        // Side panel is on the right edge — dragging left grows it.
        const delta = startX - moveEvent.clientX;
        setWidth(startWidth + delta);
      };
      const handlePointerUp = () => {
        setResizing(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [width, setWidth],
  );

  return {
    placement,
    override,
    setOverride,
    width,
    setWidth,
    onResizeStart,
    resizing,
  };
}
