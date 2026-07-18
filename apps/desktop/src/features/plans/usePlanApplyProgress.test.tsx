// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spec 042 US16 / FR-021: `usePlanApplyProgress` is the end-to-end consumer of
 * the plan-apply long-operation `OperationEvent` channel. This test drives the
 * channel from the IPC override (standing in for the backend) and asserts the
 * hook reduces the streamed Started → per-item → terminal events into a live
 * progress state (item counter + terminal outcome).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Channel } from '@tauri-apps/api/core';
import type { OperationEvent } from '@/bindings/types';
import { setInvokeOverride } from '@/api/ipc';
import { usePlanApplyProgress } from './usePlanApplyProgress';

// `Channel` needs `window.__TAURI_INTERNALS__.transformCallback`; the global
// setup removes it so `isTauriRuntime()` is false. Shim only that one method,
// scoped to this file and torn down after each test.
type TauriWindow = Window & {
  __TAURI_INTERNALS__?: {
    transformCallback: (cb: (msg: unknown) => void) => number;
  };
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

function mk(
  sequence: number,
  eventType: OperationEvent['eventType'],
  payload: unknown,
): OperationEvent {
  return {
    contractVersion: '1.0.0',
    operationId: 'run-1',
    eventType,
    sequence,
    payload,
  };
}

describe('usePlanApplyProgress', () => {
  it('updates live progress from streamed OperationEvents and records the terminal outcome', async () => {
    setInvokeOverride((cmd, args) => {
      if (cmd !== 'plans_apply_real') return Promise.resolve(null);
      const channel = (args as { onEvent?: Channel<OperationEvent> }).onEvent;
      // Drive the lifecycle: 3-item plan, 2 applied + 1 failed, then completed.
      channel?.onmessage?.(
        mk(0, 'item_started', { runId: 'run-1', itemsTotal: 3 }),
      );
      channel?.onmessage?.(
        mk(1, 'item_applied', { runId: 'run-1', itemId: 'a' }),
      );
      channel?.onmessage?.(
        mk(2, 'item_applied', { runId: 'run-1', itemId: 'b' }),
      );
      channel?.onmessage?.(
        mk(3, 'item_failed', { runId: 'run-1', itemId: 'c' }),
      );
      channel?.onmessage?.(
        mk(4, 'completed', { runId: 'run-1', terminalState: 'completed' }),
      );
      return Promise.resolve({
        planId: 'plan-1',
        runId: 'run-1',
        newState: 'applied',
      });
    });

    const { result } = renderHook(() => usePlanApplyProgress());

    let response: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      response = await result.current.run({
        id: 'plan-1',
        approvalToken: 'tok',
      });
    });

    expect(response).toEqual({
      planId: 'plan-1',
      runId: 'run-1',
      newState: 'applied',
    });

    await waitFor(() => {
      expect(result.current.progress.terminal).toBe('completed');
    });
    expect(result.current.progress.total).toBe(3);
    expect(result.current.progress.applied).toBe(2);
    expect(result.current.progress.failed).toBe(1);
    expect(result.current.progress.running).toBe(false);
    expect(result.current.progress.lastEventType).toBe('completed');
  });

  it('marks the apply failed when the command rejects', async () => {
    setInvokeOverride((cmd) => {
      if (cmd !== 'plans_apply_real') return Promise.resolve(null);
      return Promise.reject(new Error('boom'));
    });

    const { result } = renderHook(() => usePlanApplyProgress());

    let response: Awaited<ReturnType<typeof result.current.run>> = {
      planId: '',
      runId: '',
      newState: '',
    };
    await act(async () => {
      response = await result.current.run({ id: 'plan-2' });
    });

    expect(response).toBeNull();
    expect(result.current.progress.terminal).toBe('failed');
    expect(result.current.progress.running).toBe(false);
  });

  // Issue #744 FR-002: `plan.resume` returns no event channel (the run
  // continues since #575, but nothing streams it), so this hook must POLL
  // `plans.apply.status` to make a resumed run's progress visible instead of
  // leaving it permanently invisible.
  describe('resume (#744 FR-002 status polling)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls plans.apply.status after resume and reports live + terminal progress', async () => {
      let statusCall = 0;
      setInvokeOverride((cmd, args) => {
        if (cmd === 'plans_apply_real') {
          const channel = (args as { onEvent?: Channel<OperationEvent> })
            .onEvent;
          channel?.onmessage?.(
            mk(0, 'item_started', { runId: 'run-9', itemsTotal: 5 }),
          );
          channel?.onmessage?.(
            mk(1, 'warning', { runId: 'run-9', pauseReason: 'disk_full' }),
          );
          return Promise.resolve({
            planId: 'plan-9',
            runId: 'run-9',
            newState: 'paused',
          });
        }
        if (cmd === 'plans_resume') {
          return Promise.resolve({ planId: 'plan-9', newState: 'applying' });
        }
        if (cmd === 'plans_apply_status') {
          statusCall += 1;
          // First tick: still applying, partial progress. Second tick: done.
          if (statusCall === 1) {
            return Promise.resolve({
              planId: 'plan-9',
              runId: 'run-9',
              planState: 'applying',
              itemsTotal: 5,
              itemsApplied: 3,
              itemsFailed: 0,
              itemsSkipped: 0,
              itemsCancelled: 0,
              itemsPending: 2,
            });
          }
          return Promise.resolve({
            planId: 'plan-9',
            runId: 'run-9',
            planState: 'applied',
            itemsTotal: 5,
            itemsApplied: 5,
            itemsFailed: 0,
            itemsSkipped: 0,
            itemsCancelled: 0,
            itemsPending: 0,
          });
        }
        return Promise.resolve(null);
      });

      const { result } = renderHook(() => usePlanApplyProgress());
      await act(async () => {
        await result.current.run({ id: 'plan-9', approvalToken: 'tok' });
      });
      expect(result.current.progress.paused).toBe(true);

      let resumed = false;
      await act(async () => {
        resumed = await result.current.resume('plan-9');
      });
      expect(resumed).toBe(true);
      // Resume itself carries no progress — running while the poll spins up.
      expect(result.current.progress.running).toBe(true);
      expect(result.current.progress.paused).toBe(false);

      // First poll tick: partial progress, still running (not terminal).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.progress.applied).toBe(3);
      expect(result.current.progress.running).toBe(true);
      expect(result.current.progress.terminal).toBeNull();

      // Second poll tick: plan reaches `applied` — terminal, polling stops.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.progress.applied).toBe(5);
      expect(result.current.progress.running).toBe(false);
      expect(result.current.progress.terminal).toBe('completed');
      expect(statusCall).toBe(2);

      // Polling has genuinely stopped — no further status calls accrue.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(statusCall).toBe(2);
    });
  });
});
