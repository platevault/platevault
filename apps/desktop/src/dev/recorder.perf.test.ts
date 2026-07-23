// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Performance guard: zero added frames in the dispatch path when devMode = false
 * (spec 021 T029).
 *
 * When devMode is false, wrap() returns the original dispatch function without
 * wrapping it, so the proxy adds zero overhead at the call site. This test
 * verifies the reference identity guarantee that constitutes the zero-frame proof.
 */

import { describe, it, expect } from 'vitest';
import { wrap, type DispatchFn } from './recorder';

describe('recorder.perf (T029)', () => {
  it('wrap() returns the original function reference when devMode = false', () => {
    // Create a stable function reference.
    const original: DispatchFn = async (cmd) => ({ cmd });

    const wrapped = wrap(original, false);

    // Reference equality proves no wrapper frame is interposed.
    expect(wrapped).toBe(original);
  });

  it('wrap() returns a NEW function reference when devMode = true', () => {
    const original: DispatchFn = async (cmd) => ({ cmd });
    const wrapped = wrap(original, true);

    // When recording is on, a new function is returned (the proxy).
    expect(wrapped).not.toBe(original);
  });

  it('dispatch with devMode = false does not touch the ring buffer', async () => {
    const { getCallSnapshot, resetRecorder } = await import('./recorder');
    resetRecorder();

    const dispatch = wrap(async () => ({ ok: true }), false);
    // Call many times — should produce no buffer entries.
    for (let i = 0; i < 10; i++) {
      await dispatch('sessions.list', { limit: 25 });
    }

    expect(getCallSnapshot()).toHaveLength(0);
  });
});
