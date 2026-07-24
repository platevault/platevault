// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Onboarding client store + API wrapper (spec 056, T008).
 *
 * The single frontend access point for the three-layer onboarding backend: a
 * live cache of the full `onboarding.state.get` projection, React hooks, the
 * five command wrappers, and the deterministic suppression flag.
 *
 * Refresh model (research R5): the backend is authoritative for state. This
 * store reads via `onboarding.state.get` and re-reads whenever the backend
 * emits `onboarding:state-changed` (a hint carrying at most an `itemId` — the
 * store ignores the payload and re-reads the whole projection). No polling.
 * In mock mode the event path is a documented no-op (VC-002 limit); the
 * generated `commands.*` calls still route through `mocks.ts`.
 *
 * Suppression flag (FR-030, research R8): a deterministic, per-test runtime
 * input rather than a build-time `VITE_E2E` gate — onboarding's OWN e2e specs
 * need onboarding to run. Two equivalent channels, either one suppresses:
 *
 * - `?e2eOnboarding=off` in the URL query ({@link ONBOARDING_SUPPRESSED_QUERY}).
 *   Per-WINDOW by construction. Required by the Layer-2 tauri-driver harness
 *   (`crates/e2e-tests/tests/common/mod.rs`): nextest runs journeys
 *   concurrently and on Windows WebView2 ignores the redirected LOCALAPPDATA,
 *   so all concurrent journeys share ONE localStorage origin — a sibling
 *   journey's suppression write would leak into (or be cleared by) the
 *   onboarding journey mid-run (#1133). Routes live in the hash (`#/inbox`),
 *   so the query slot is free.
 * - {@link ONBOARDING_SUPPRESSED_STORE_ID} in `localStorage` (mirroring
 *   `seedSetupComplete`'s `alm-preferences` channel). Used by the mock-mode
 *   Playwright harness, which gets one browser context per test and so is not
 *   exposed to the race above.
 *
 * When suppressed, all onboarding surfaces (walk, accordion auto-expand,
 * spotlights) suppress themselves.
 *
 * INTER-NODE CONTRACT: the e2e harness's `disableOnboarding` helper
 * (tests/e2e/support/harness.ts) MUST set exactly this localStorage key to
 * `'true'`.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { commands } from '@/bindings/index';
import type {
  OnboardingStateDto,
  OnboardingItemDto,
  OnboardingFlagsDto,
  OnboardingManualState,
  OnboardingOrientationOutcome,
} from '@/bindings/index';
import { unwrap } from '@/api/ipc';

/** localStorage key the harness sets to `'true'` to suppress all onboarding. */
export const ONBOARDING_SUPPRESSED_STORE_ID = 'alm-onboarding-suppressed';

/** URL query param the Layer-2 harness sets to `off` to suppress onboarding. */
export const ONBOARDING_SUPPRESSED_QUERY = 'e2eOnboarding';

/** Tauri notification name the backend emits after any persisted tick. */
const EVENT_STATE_CHANGED = 'onboarding:state-changed';

function isMockMode(): boolean {
  return import.meta.env.VITE_USE_MOCKS === 'true';
}

/**
 * Whether onboarding is suppressed for this session (FR-030). Deterministic —
 * reads only the two harness channels documented in the module header:
 * `?e2eOnboarding=off` (per window) or {@link ONBOARDING_SUPPRESSED_STORE_ID}
 * (per origin). Callers that gate a surface (walk launch, accordion,
 * spotlight) MUST honour this.
 */
export function isOnboardingSuppressed(): boolean {
  try {
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get(ONBOARDING_SUPPRESSED_QUERY) ===
        'off'
    ) {
      return true;
    }
  } catch {
    // fall through to the localStorage channel
  }
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(ONBOARDING_SUPPRESSED_STORE_ID) === 'true'
    );
  } catch {
    return false;
  }
}

// ── Live cache + subscribers ─────────────────────────────────────────────────

let current: OnboardingStateDto | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): OnboardingStateDto | null {
  return current;
}

/**
 * Load the full onboarding projection into the live cache. Safe to call on
 * mount; falls back to `null` (surfaces render nothing) when the backend is
 * unavailable.
 */
export async function loadOnboardingState(): Promise<OnboardingStateDto | null> {
  try {
    current = unwrap(await commands.onboardingStateGet()).state;
  } catch (err) {
    console.warn('[onboarding] state load failed:', err);
    current = null;
  }
  emit();
  return current;
}

// ── Backend-change subscription ───────────────────────────────────────────────

let started = false;
let unlisten: (() => void) | null = null;

/**
 * Start the onboarding state sync (idempotent): hydrate once, then re-read on
 * every `onboarding:state-changed` notification. In mock mode the event path
 * is a no-op — the initial hydration still runs.
 */
export async function startOnboardingStateSync(): Promise<void> {
  if (started) return;
  started = true;

  await loadOnboardingState();

  if (isMockMode()) return;

  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen(EVENT_STATE_CHANGED, () => {
      void loadOnboardingState();
    });
  } catch (err) {
    console.warn('[onboarding] state-changed listen registration failed:', err);
    started = false;
  }
}

/** Stop the sync and remove the listener. Safe if never started. */
export function stopOnboardingStateSync(): void {
  if (unlisten) {
    try {
      unlisten();
    } catch {
      // best-effort cleanup
    }
  }
  unlisten = null;
  started = false;
}

// ── Command wrappers ──────────────────────────────────────────────────────────

/** `onboarding.item.set_state` — manual check-off or dismiss (FR-017). */
export async function setOnboardingItemState(
  itemId: string,
  state: OnboardingManualState,
): Promise<OnboardingItemDto> {
  const resp = unwrap(await commands.onboardingItemSetState({ itemId, state }));
  await loadOnboardingState();
  return resp.item;
}

/** `onboarding.orientation.complete` — mark the walk finished/skipped (FR-004). */
export async function completeOrientation(
  outcome: OnboardingOrientationOutcome,
): Promise<string> {
  const resp = unwrap(
    await commands.onboardingOrientationComplete({ outcome }),
  );
  await loadOnboardingState();
  return resp.orientationDoneAt;
}

/** `onboarding.section.set` — explicit remove (FR-013) / collapse (FR-012). */
export async function setOnboardingSection(req: {
  hidden?: boolean;
  sidebarCollapsed?: boolean;
}): Promise<OnboardingFlagsDto> {
  const resp = unwrap(
    await commands.onboardingSectionSet({
      hidden: req.hidden ?? null,
      sidebarCollapsed: req.sidebarCollapsed ?? null,
    }),
  );
  await loadOnboardingState();
  return resp.flags;
}

/** `onboarding.restore` — the single Settings → Advanced restore (FR-014). */
export async function restoreOnboarding(): Promise<OnboardingStateDto> {
  const resp = unwrap(await commands.onboardingRestore());
  current = resp.state;
  emit();
  return resp.state;
}

// ── Non-hook reads (comparators, tests) ───────────────────────────────────────

/** Non-hook read of the current cached projection. */
export function getOnboardingState(): OnboardingStateDto | null {
  return current;
}

/** Test-only: set the cache directly. */
export function __setOnboardingStateForTest(
  state: OnboardingStateDto | null,
): void {
  current = state;
  emit();
}

// ── Replay signal (T015) ──────────────────────────────────────────────────────
//
// `requestOrientationReplay` is called from Settings → Advanced. It must live
// in `store.ts` (not `OrientationWalk.tsx`) so callers don't pull in the
// joyrideAdapter and react-joyride statically. The signal is a plain boolean
// consumed and cleared by the OrientationWalk component on mount.

let _replayPending = false;
const _replaySubs = new Set<() => void>();

function replayEmit(): void {
  for (const fn of _replaySubs) fn();
}

/**
 * Request an orientation walk replay (FR-005 / T015). Idempotent — multiple
 * calls before the walk mounts collapse to a single run. The OrientationWalk
 * component clears the signal on mount via `consumeOrientationReplay`.
 */
export function requestOrientationReplay(): void {
  _replayPending = true;
  replayEmit();
}

/** Called by OrientationWalk on mount: returns true once and resets. */
export function consumeOrientationReplay(): boolean {
  if (!_replayPending) return false;
  _replayPending = false;
  return true;
}

/** React hook: true while a replay is pending (drives Shell's mount gate). */
export function useOrientationReplayPending(): boolean {
  return useSyncExternalStore(
    (fn) => {
      _replaySubs.add(fn);
      return () => _replaySubs.delete(fn);
    },
    () => _replayPending,
    () => _replayPending,
  );
}

// ── React hooks ────────────────────────────────────────────────────────────────

/** React hook: the live onboarding projection (or `null` before hydration). */
export function useOnboardingState(): OnboardingStateDto | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Shared visibility gate for every onboarding surface: honours the
 * deterministic suppression flag (FR-030) and the backend `sectionHidden` flag
 * (explicit removal FR-013 / completion auto-hide FR-031). Returns `null` when
 * the section (and its progress-ring icon) must not render at all.
 *
 * Kept in `store.ts` (not `ChecklistSection.tsx`) so Shell/Sidebar can import
 * it without pulling the full checklist → FindSpotlight → joyrideAdapter tree
 * into the boot chunk.
 */
export function useVisibleOnboardingState(): OnboardingStateDto | null {
  const state = useOnboardingState();
  useEffect(() => {
    void startOnboardingStateSync();
  }, []);
  if (isOnboardingSuppressed()) return null;
  if (!state || state.flags.sectionHidden) return null;
  return state;
}
