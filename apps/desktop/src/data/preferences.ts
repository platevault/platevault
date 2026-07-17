// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore, useCallback } from 'react';
import type { AppPreferences } from '@/bindings/types';

const STORAGE_KEY = 'alm-preferences';

type Listener = () => void;

// ── Detail-dock placement preference (spec 054 D4/T007) ─────────────────────
//
// `detailDock` is deliberately NOT added to the generated `AppPreferences`
// contract DTO (crates/contracts/core/src/preferences.rs, mirrored via specta
// into bindings/index.ts): it is placement UI state, not durable library data
// (research.md D4/S5; constitution §V), and adding it there would require a
// Rust change + bindings regen for a value that never crosses IPC — the real
// `preferences.ts` store here is already pure localStorage, independent of
// the `preferences_get`/`preferences_set` commands (those only back the mock
// IPC surface). We locally widen the type instead, mirroring the existing
// `projectViewModes: {}` per-page-keyed-map precedent.
export type DetailDockMode = 'adaptive' | 'side' | 'bottom';
export type DetailDockPageKey =
  | 'sessions'
  | 'calibration'
  | 'archive'
  | 'projects'
  | 'targets'
  | 'inbox';

export interface DetailDockPreference {
  /** User override. 'adaptive' = follow the width heuristic (default). */
  mode: DetailDockMode;
  /** Persisted side-panel / split width in logical px. Clamped on restore. */
  width: number;
}

/** Frontend-local extension of the generated `AppPreferences` contract DTO. */
type LocalPreferences = AppPreferences & {
  /** Per-page detail-dock placement + width. Absent key ⇒ page default. */
  detailDock: Partial<Record<DetailDockPageKey, DetailDockPreference>>;
};

// List-dominant pages default to a ~420px side panel; Inbox's detail-dominant
// split defaults narrower on the LIST side (~360px) — see data-model.md.
const DEFAULT_DOCK_WIDTH: Record<DetailDockPageKey, number> = {
  sessions: 420,
  calibration: 420,
  archive: 420,
  projects: 420,
  targets: 420,
  inbox: 360,
};

/** Side/split width bounds (spec FR-005): ~320px min to 50% of the window. */
const DOCK_WIDTH_MIN = 320;

function clampDockWidth(width: number): number {
  const max = typeof window === 'undefined' ? width : window.innerWidth * 0.5;
  return Math.min(
    Math.max(width, DOCK_WIDTH_MIN),
    Math.max(max, DOCK_WIDTH_MIN),
  );
}

const listeners = new Set<Listener>();
let cachedPreferences: LocalPreferences | undefined;

const defaults: LocalPreferences = {
  sidebarCollapsed: false,
  density: 'comfortable',
  projectViewModes: {},
  defaultProjectView: 'combined',
  sessionsGroupBy: 'none',
  sessionsView: 'list',
  tourCompleted: { step1: false, step2: false, step3: false },
  setupCompleted: false,
  detailDock: {},
};

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads preferences from localStorage, merging with defaults.
 */
export function getPreferences(): LocalPreferences {
  if (cachedPreferences !== undefined) {
    return cachedPreferences;
  }
  let result: LocalPreferences;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      result = { ...defaults, ...JSON.parse(raw) };
    } else {
      result = { ...defaults };
    }
  } catch {
    result = { ...defaults };
  }
  cachedPreferences = result;
  return result;
}

/**
 * Persists updated preferences to localStorage and notifies subscribers.
 */
function persistPreferences(prefs: LocalPreferences): void {
  cachedPreferences = prefs;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or unavailable; state is still in memory
  }
  notify();
}

/**
 * Sets a single preference key and persists.
 */
export function setPreference<K extends keyof LocalPreferences>(
  key: K,
  value: LocalPreferences[K],
): void {
  const current = getPreferences();
  persistPreferences({ ...current, [key]: value });
}

/**
 * Resets all preferences to defaults.
 */
export function resetPreferences(): void {
  cachedPreferences = undefined;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Intentional ignore: localStorage may be unavailable (private mode / quota);
    // the in-memory cache was already cleared above, so this is best-effort.
  }
  notify();
}

/**
 * Subscribes to preference changes outside React (components use the hooks
 * below). Lets the appearance runtime (data/theme.ts) re-apply density when
 * ANY caller writes it — Settings, the Setup wizard's usePreference — so the
 * app-wide token rescale never depends on a per-call-site applyDensity (#587).
 */
export function subscribePreferences(listener: Listener): () => void {
  return subscribe(listener);
}

// --- Hooks ---

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LocalPreferences {
  return getPreferences();
}

/**
 * Hook: subscribes to all preferences. Re-renders on any preference change.
 */
export function usePreferences(): LocalPreferences {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook: subscribes to a single preference key. Returns [value, setter] tuple.
 */
export function usePreference<K extends keyof LocalPreferences>(
  key: K,
): [LocalPreferences[K], (value: LocalPreferences[K]) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot);
  const setter = useCallback(
    (value: LocalPreferences[K]) => {
      setPreference(key, value);
    },
    [key],
  );
  return [prefs[key], setter];
}

// ── Detail-dock helpers (spec 054 T007) ──────────────────────────────────────

/**
 * Reads the resolved detail-dock preference for a page: an absent stored key
 * defaults to `'adaptive'` at the page's default width, and any stored width
 * is clamped into `[320, 0.5*windowWidth]` on read (never restore an unusable
 * layout — spec edge case, FR-005).
 */
export function getDetailDock(page: DetailDockPageKey): DetailDockPreference {
  const stored = getPreferences().detailDock[page];
  return {
    mode: stored?.mode ?? 'adaptive',
    width: clampDockWidth(stored?.width ?? DEFAULT_DOCK_WIDTH[page]),
  };
}

/** Pins (or un-pins, via `'adaptive'`) a page's placement (FR-003). */
export function setDetailDockMode(
  page: DetailDockPageKey,
  mode: DetailDockMode,
): void {
  const current = getPreferences();
  const width = current.detailDock[page]?.width ?? DEFAULT_DOCK_WIDTH[page];
  persistPreferences({
    ...current,
    detailDock: { ...current.detailDock, [page]: { mode, width } },
  });
}

/** Persists a dragged side-panel / split width for a page (FR-005). */
export function setDetailDockWidth(
  page: DetailDockPageKey,
  width: number,
): void {
  const current = getPreferences();
  const mode = current.detailDock[page]?.mode ?? 'adaptive';
  persistPreferences({
    ...current,
    detailDock: {
      ...current.detailDock,
      [page]: { mode, width: clampDockWidth(width) },
    },
  });
}

/**
 * Hook: subscribes to one page's resolved detail-dock preference (mode +
 * clamped width), re-rendering on any preference change.
 */
export function useDetailDockPref(
  page: DetailDockPageKey,
): DetailDockPreference {
  const prefs = usePreferences();
  const stored = prefs.detailDock[page];
  return {
    mode: stored?.mode ?? 'adaptive',
    width: clampDockWidth(stored?.width ?? DEFAULT_DOCK_WIDTH[page]),
  };
}
