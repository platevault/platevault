/**
 * guidance-settings.ts — settings-backed per-band Moon-avoidance params (spec 047).
 *
 * The seven-band Lorentzian parameters (`plannerMoonAvoidance`) live in the
 * spec-018 settings store under the `'planner'` scope. This module is the
 * single frontend access point: a live cache hydrated from the backend, a
 * React hook (`useGuidanceParams`) for components, and a non-hook getter
 * (`getGuidanceParams`) for sort comparators / tests. Writes go through
 * `saveGuidanceParams`, which persists and updates the cache so pills and
 * recommendations recompute live (SC-008) without a restart.
 *
 * When the backend is unavailable or nothing is persisted, callers fall back
 * to `DEFAULT_MOON_AVOIDANCE` (the shipped table, mirrored in the Rust default).
 */

import { useSyncExternalStore } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import {
  BANDS,
  DEFAULT_MOON_AVOIDANCE,
  type Band,
  type BandParams,
  type MoonAvoidanceParams,
} from './astro/moon-avoidance';

/** Settings scope + key for the per-band Moon-avoidance params. */
export const PLANNER_SCOPE = 'planner';
export const MOON_AVOIDANCE_KEY = 'plannerMoonAvoidance';

/** distanceDeg valid range (data-model.md). */
export const DISTANCE_MIN = 0;
export const DISTANCE_MAX = 180;
/** widthDays valid range (data-model.md). */
export const WIDTH_MIN = 0.5;
export const WIDTH_MAX = 30;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerce an unknown persisted value into a clean, fully-populated params set.
 * Missing/invalid bands or fields fall back to the shipped default; out-of-range
 * numbers are clamped. Always returns all seven bands.
 */
export function coerceParams(value: unknown): MoonAvoidanceParams {
  const src =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out = {} as MoonAvoidanceParams;
  for (const band of BANDS) {
    const fallback = DEFAULT_MOON_AVOIDANCE[band];
    const raw = src[band];
    const rawObj =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const distance = Number(rawObj['distanceDeg']);
    const width = Number(rawObj['widthDays']);
    const band_params: BandParams = {
      distanceDeg: Number.isFinite(distance)
        ? clamp(distance, DISTANCE_MIN, DISTANCE_MAX)
        : fallback.distanceDeg,
      widthDays: Number.isFinite(width)
        ? clamp(width, WIDTH_MIN, WIDTH_MAX)
        : fallback.widthDays,
    };
    out[band] = band_params;
  }
  return out;
}

// ── Live cache + subscribers ─────────────────────────────────────────────────

let current: MoonAvoidanceParams = { ...DEFAULT_MOON_AVOIDANCE };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): MoonAvoidanceParams {
  return current;
}

/**
 * Load the per-band params from the backend into the live cache. Safe to call
 * on planner mount; falls back to defaults when the backend is unavailable.
 */
export async function loadGuidanceParams(): Promise<MoonAvoidanceParams> {
  try {
    const data = unwrap(await commands.settingsGet(PLANNER_SCOPE));
    const values = data.values as Record<string, unknown>;
    current = coerceParams(values[MOON_AVOIDANCE_KEY]);
  } catch {
    current = { ...DEFAULT_MOON_AVOIDANCE };
  }
  emit();
  return current;
}

/**
 * Persist a new per-band params set and update the live cache so dependent
 * pills/recommendations recompute immediately (SC-008).
 */
export async function saveGuidanceParams(
  params: MoonAvoidanceParams,
): Promise<void> {
  const clean = coerceParams(params);
  unwrap(await commands.settingsUpdate(PLANNER_SCOPE, { [MOON_AVOIDANCE_KEY]: clean }));
  current = clean;
  emit();
}

/**
 * Restore the shipped defaults via `settings.restore-defaults` and update the
 * live cache.
 */
export async function restoreGuidanceDefaults(): Promise<void> {
  unwrap(
    await commands.settingsRestoreDefaults({
      keys: [MOON_AVOIDANCE_KEY],
    }),
  );
  await loadGuidanceParams();
}

/** Non-hook read of the current cached params (sort comparators, tests). */
export function getGuidanceParams(): MoonAvoidanceParams {
  return current;
}

/** Test-only: reset the cache to shipped defaults. */
export function __resetGuidanceParamsForTest(): void {
  current = { ...DEFAULT_MOON_AVOIDANCE };
  emit();
}

/**
 * React hook: subscribe to the live per-band Moon-avoidance params. Re-renders
 * when `saveGuidanceParams` / `loadGuidanceParams` update the cache.
 */
export function useGuidanceParams(): MoonAvoidanceParams {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export type { MoonAvoidanceParams, Band, BandParams };
