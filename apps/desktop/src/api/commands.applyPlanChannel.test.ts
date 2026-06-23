/**
 * Spec 042 US16 (T240): plan-apply streams live progress over a
 * `tauri::ipc::Channel<OperationEvent>`.
 *
 * `applyPlan` constructs a `Channel<OperationEvent>` and forwards each message
 * to the caller's `onEvent` callback. This test drives the channel from the
 * IPC override (standing in for the backend) and asserts the wrapper:
 *   1. passes the channel through as the `onEvent` invoke argument,
 *   2. delivers every streamed `OperationEvent` to `onEvent` in order, and
 *   3. still resolves with the `PlanApplyResponse` returned by the command.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Channel } from '@tauri-apps/api/core';
import type { OperationEvent } from '@/bindings/types';
import { applyPlan } from './commands';
import { setInvokeOverride } from './ipc';

// Tauri's `Channel` constructor calls `window.__TAURI_INTERNALS__.transformCallback`
// to register its message sink. jsdom has no Tauri bridge (the global setup
// deliberately removes `__TAURI_INTERNALS__` so `isTauriRuntime()` is false), so
// shim only the one method `Channel` needs — scoped to this file and torn down
// after each test so the runtime-detection global stays absent elsewhere.
type TauriWindow = Window & {
  __TAURI_INTERNALS__?: { transformCallback: (cb: (msg: unknown) => void) => number };
};

beforeEach(() => {
  let nextId = 1;
  (window as TauriWindow).__TAURI_INTERNALS__ = {
    transformCallback: () => nextId++,
  };
});

afterEach(() => {
  setInvokeOverride(null);
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('applyPlan streams OperationEvents over the long-op channel', () => {
  it('forwards Started → per-item → Completed events to onEvent and returns the handle', async () => {
    setInvokeOverride((cmd, args) => {
      if (cmd !== 'plans_apply_real') return Promise.resolve(null);

      const channel = (args as { onEvent?: Channel<OperationEvent> }).onEvent;
      expect(channel).toBeInstanceOf(Channel);

      const opId = 'run-xyz';
      const mk = (
        sequence: number,
        eventType: OperationEvent['eventType'],
      ): OperationEvent => ({
        contractVersion: '1.0.0',
        operationId: opId,
        eventType,
        sequence,
        payload: { runId: opId },
      });

      // Stream the lifecycle synchronously through the channel's message sink.
      channel?.onmessage?.(mk(0, 'item_started'));
      channel?.onmessage?.(mk(1, 'item_applied'));
      channel?.onmessage?.(mk(2, 'completed'));

      return Promise.resolve({ planId: 'plan-1', runId: opId, newState: 'applied' });
    });

    const received: OperationEvent[] = [];
    const response = await applyPlan({
      id: 'plan-1',
      approvalToken: 'tok-1',
      onEvent: (event) => received.push(event),
    });

    // The wrapper returns the real PlanApplyResponse from the command.
    expect(response).toEqual({ planId: 'plan-1', runId: 'run-xyz', newState: 'applied' });

    // Every streamed event reached the subscriber, in sequence order.
    expect(received.map((e) => e.eventType)).toEqual([
      'item_started',
      'item_applied',
      'completed',
    ]);
    expect(received.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(received[2].eventType).toBe('completed');
  });

  it('works without a subscriber (onEvent omitted) and still resolves', async () => {
    setInvokeOverride((cmd, args) => {
      if (cmd !== 'plans_apply_real') return Promise.resolve(null);
      // A channel is always supplied because the command signature requires it,
      // even when the caller passes no onEvent callback.
      const channel = (args as { onEvent?: Channel<OperationEvent> }).onEvent;
      expect(channel).toBeInstanceOf(Channel);
      return Promise.resolve({ planId: 'plan-2', runId: 'r', newState: 'applied' });
    });

    const response = await applyPlan({ id: 'plan-2', approvalToken: 'tok-2' });
    expect(response).toEqual({ planId: 'plan-2', runId: 'r', newState: 'applied' });
  });
});
