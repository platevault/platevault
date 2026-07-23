// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Completion choreography detector (spec 056, US3 T024; FR-018…FR-020).
 *
 * A single, module-level transition detector shared by every onboarding surface
 * (the expanded `ChecklistSection` progress line AND the icon-collapsed
 * `ChecklistPopover` ring). It watches the backend-authoritative store
 * projection and, when an item crosses `unchecked → settled`, drives three
 * effects:
 *   1. adds the item to a transient `completing` set so its row can play the
 *      check animation + brief emphasis IN PLACE before it drops to the group's
 *      completed area,
 *   2. bumps `pulseActive` for AUTOMATIC ticks (`source === 'event'`) so the
 *      progress line / ring pulses even when the user is looking elsewhere
 *      (edge case: milestone while the group is collapsed), and
 *   3. records the just-ticked item id for a polite aria-live announcement.
 *
 * Why module-level (not a component `useRef`): both surfaces can mount at once
 * (collapsed sidebar ring + open popover) and both must witness the same tick
 * exactly once. Detection is de-duped here — whichever instance ingests the new
 * projection first consumes the delta; the second sees no change.
 *
 * Reduced motion (FR-020): `prefers-reduced-motion` suppresses the `completing`
 * animation and the pulse entirely — the item settles into its final state with
 * zero motion. The announcement still fires (it is not motion).
 *
 * First hydration and restore/replay never animate (FR AS-4): on the first
 * sighting of an item there is no previous state to transition FROM, so no
 * choreography plays. `onboarding.restore` re-derives automatic items without
 * creating an `unchecked → settled` edge, so restoring history never ticks.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { OnboardingItemState, OnboardingStateDto } from '@/bindings/index';

/** How long a settled row lingers in place playing its check animation. */
const COMPLETING_MS = 900;
/** How long the progress pulse stays active after an automatic tick. */
const PULSE_MS = 1200;

const lastStates = new Map<string, OnboardingItemState>();
const completing = new Set<string>();
const completingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pulseActive = false;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
/** Item id of the most recent tick, plus a nonce so identical repeat ticks
 * still re-announce (aria-live re-reads only on text change). */
let announceItemId: string | null = null;
let announceNonce = 0;

const subscribers = new Set<() => void>();

interface ChoreographySnapshot {
  completingIds: ReadonlySet<string>;
  pulseActive: boolean;
  announceItemId: string | null;
  announceNonce: number;
}

let snapshot: ChoreographySnapshot = {
  completingIds: completing,
  pulseActive,
  announceItemId,
  announceNonce,
};

function rebuild(): void {
  // New object reference so `useSyncExternalStore` re-renders; the Set is
  // copied so React sees a distinct collection per emit.
  snapshot = {
    completingIds: new Set(completing),
    pulseActive,
    announceItemId,
    announceNonce,
  };
}

function emit(): void {
  rebuild();
  for (const fn of subscribers) fn();
}

/** SSR/test-safe reduced-motion read (re-evaluated per tick, FR AS "mid-session"). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clearCompleting(itemId: string): void {
  completing.delete(itemId);
  completingTimers.delete(itemId);
  emit();
}

/**
 * Fold a fresh projection into the detector. Idempotent per delta: repeat calls
 * with the same projection produce no further effects (module `lastStates` has
 * already advanced), so multiple mounted surfaces stay in sync.
 */
export function ingestOnboardingState(state: OnboardingStateDto | null): void {
  if (!state) return;
  const reduced = prefersReducedMotion();
  let dirty = false;
  let pulsed = false;

  for (const item of state.items) {
    const prev = lastStates.get(item.itemId);
    lastStates.set(item.itemId, item.state);
    if (prev === undefined) continue; // first sighting — never animates
    if (prev !== 'unchecked' || item.state === 'unchecked') continue;

    // unchecked → settled: a real completion transition.
    announceItemId = item.itemId;
    announceNonce += 1;
    dirty = true;

    // `source === 'event'` is an automatic tick (bus subscriber); manual
    // check-off / dismiss carry `source === 'user'` and never pulse (AS-2).
    if (item.source === 'event') pulsed = true;

    if (!reduced) {
      completing.add(item.itemId);
      const existing = completingTimers.get(item.itemId);
      if (existing) clearTimeout(existing);
      completingTimers.set(
        item.itemId,
        setTimeout(() => clearCompleting(item.itemId), COMPLETING_MS),
      );
    }
  }

  if (pulsed && !reduced) {
    pulseActive = true;
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      pulseActive = false;
      emit();
    }, PULSE_MS);
  }

  if (dirty) emit();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function getSnapshot(): ChoreographySnapshot {
  return snapshot;
}

/**
 * Subscribe a surface to the shared choreography signal and feed it the current
 * projection. Every mounted onboarding surface calls this with the same store
 * state; detection stays de-duped at the module level.
 */
export function useCompletionChoreography(
  state: OnboardingStateDto | null,
): ChoreographySnapshot {
  useEffect(() => {
    ingestOnboardingState(state);
  }, [state]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: reset detector memory so specs start from a clean slate. */
export function __resetChoreographyForTest(): void {
  lastStates.clear();
  completing.clear();
  for (const t of completingTimers.values()) clearTimeout(t);
  completingTimers.clear();
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = null;
  pulseActive = false;
  announceItemId = null;
  announceNonce = 0;
  rebuild();
}
