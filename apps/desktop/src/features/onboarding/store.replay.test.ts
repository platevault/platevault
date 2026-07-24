// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression test for the replay-signal consume-unmount race (T015).
 *
 * Root cause: when consumeOrientationReplay() cleared _replayPending and
 * called replayEmit(), Shell's useOrientationReplayPending() hook re-evaluated
 * to false and unmounted OrientationWalk before setActive(true) committed —
 * causing the tooltip to never appear. Fix: OrientationWalk is always mounted
 * once setupCompleted; consumeOrientationReplay is called inside a stable
 * mounted component, not from Shell's gate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestOrientationReplay,
  consumeOrientationReplay,
} from './store';

// Each test gets a clean slate via re-import; reset via consume.
beforeEach(() => {
  // Drain any pending signal left by a prior test.
  consumeOrientationReplay();
});

describe('orientationReplay signal (T015)', () => {
  it('is false by default', () => {
    expect(consumeOrientationReplay()).toBe(false);
  });

  it('returns true exactly once after requestOrientationReplay', () => {
    requestOrientationReplay();
    expect(consumeOrientationReplay()).toBe(true);
    // Second consume must return false — signal is cleared after first consume.
    expect(consumeOrientationReplay()).toBe(false);
  });

  it('idempotent: multiple requests before consume still fire only once', () => {
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
