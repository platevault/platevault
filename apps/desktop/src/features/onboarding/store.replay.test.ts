// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for the orientation-walk gate signals (T015).
 *
 * Shell gate invariant: `setupCompleted && (!orientationDone || walkActive)`.
 * walkActive is set BEFORE OrientationWalk mounts (by requestOrientationReplay)
 * and cleared only when the walk finishes/skips (by setWalkActive(false)).
 * This prevents the consume-unmount race: consuming _replayPending does not
 * emit to _walkSubs, so the gate never collapses mid-walk.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestOrientationReplay,
  consumeOrientationReplay,
  setWalkActive,
  isWalkActive,
} from './store';

// Reset walkActive between tests via setWalkActive(false).
beforeEach(() => {
  consumeOrientationReplay(); // drain any leftover pending signal
  setWalkActive(false); // reset walkActive to its idle state
});

describe('consumeOrientationReplay — one-shot semantics (T015)', () => {
  it('returns false when no replay was requested', () => {
    expect(consumeOrientationReplay()).toBe(false);
  });

  it('returns true exactly once after requestOrientationReplay', () => {
    requestOrientationReplay();
    expect(consumeOrientationReplay()).toBe(true);
    expect(consumeOrientationReplay()).toBe(false);
  });

  it('idempotent: multiple requests before consume collapse to one', () => {
    requestOrientationReplay();
    requestOrientationReplay();
    expect(consumeOrientationReplay()).toBe(true);
    expect(consumeOrientationReplay()).toBe(false);
  });

  it('can be requested again after consume (replay after replay)', () => {
    requestOrientationReplay();
    consumeOrientationReplay();
    requestOrientationReplay();
    expect(consumeOrientationReplay()).toBe(true);
  });
});

describe('walkActive gate — Shell does not collapse mid-walk (T015)', () => {
  it('walkActive is false by default (no walk running, no request)', () => {
    // Shell gate: !orientationDone || walkActive — done users never load chunk.
    expect(isWalkActive()).toBe(false);
  });

  it('requestOrientationReplay sets walkActive BEFORE consume (gate stays open)', () => {
    requestOrientationReplay();
    // Gate is open because walkActive=true — even after consume clears pending.
    expect(isWalkActive()).toBe(true);
    consumeOrientationReplay(); // simulates OrientationWalk mounting
    // walkActive must still be true — the mount cannot be collapsed here.
    expect(isWalkActive()).toBe(true);
  });

  it('setWalkActive(false) collapses the gate after the walk ends', () => {
    requestOrientationReplay();
    consumeOrientationReplay();
    setWalkActive(false); // simulates finish() or skip()
    expect(isWalkActive()).toBe(false);
  });
});
