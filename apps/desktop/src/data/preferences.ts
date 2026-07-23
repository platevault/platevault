// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore, useCallback } from 'react';
import type { AppPreferences } from '@/bindings/types';

const STORAGE_KEY = 'alm-preferences';

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedPreferences: AppPreferences | undefined;

const defaults: AppPreferences = {
  sidebarCollapsed: false,
  density: 'comfortable',
  projectViewModes: {},
  defaultProjectView: 'combined',
  sessionsGroupBy: 'none',
  sessionsView: 'list',
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
export function getPreferences(): AppPreferences {
  if (cachedPreferences !== undefined) {
    return cachedPreferences;
  }
  let result: AppPreferences;
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
function persistPreferences(prefs: AppPreferences): void {
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
export function setPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
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

function getSnapshot(): AppPreferences {
  return getPreferences();
}

/**
 * Hook: subscribes to all preferences. Re-renders on any preference change.
 */
export function usePreferences(): AppPreferences {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook: subscribes to a single preference key. Returns [value, setter] tuple.
 */
export function usePreference<K extends keyof AppPreferences>(
  key: K,
): [AppPreferences[K], (value: AppPreferences[K]) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot);
  const setter = useCallback(
    (value: AppPreferences[K]) => {
      setPreference(key, value);
    },
    [key],
  );
  return [prefs[key], setter];
}
