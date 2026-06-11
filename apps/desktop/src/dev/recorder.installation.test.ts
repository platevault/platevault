/**
 * Recorder installation guard — verifies the proxy is NOT installed when
 * devMode = false (spec 021 T018).
 *
 * When devMode is false, `wrap(dispatch, false)` must return the original
 * function reference unchanged, so no proxy frames appear in the call graph.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { wrap, getCallSnapshot, resetRecorder, type DispatchFn } from './recorder';

beforeEach(() => {
  resetRecorder();
});

describe('recorder.installation (T018)', () => {
  it('returns identical function reference when devMode = false', () => {
    const original: DispatchFn = async () => ({ ok: true });
    const wrapped = wrap(original, false);
    expect(wrapped).toBe(original);
  });

  it('buffer stays empty when devMode = false and dispatch is called', async () => {
    const dispatch = wrap(async () => ({ ok: true }), false);
    await dispatch('sessions.list');
    await dispatch('targets.list');
    expect(getCallSnapshot()).toHaveLength(0);
  });

  it('buffer is populated when devMode = true', async () => {
    const dispatch = wrap(async () => ({ ok: true }), true);
    await dispatch('sessions.list');
    expect(getCallSnapshot()).toHaveLength(1);
  });

  it('switching from true to false stops recording for new wrap', async () => {
    // Simulate app restart: first devMode=true, then devMode=false.
    const dispatchOn = wrap(async () => ({ ok: true }), true);
    await dispatchOn('first.call');
    expect(getCallSnapshot()).toHaveLength(1);

    resetRecorder();

    const dispatchOff = wrap(async () => ({ ok: true }), false);
    await dispatchOff('second.call');
    // Buffer should still be empty after toggling off and resetting.
    expect(getCallSnapshot()).toHaveLength(0);
  });
});
