// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * usePlanApplyProgress — live plan-apply progress consumer (spec 042 US16 /
 * FR-021).
 *
 * Drives the `applyPlan` wrapper with an `onEvent` subscriber and reduces the
 * streamed `OperationEvent`s (Started → per-item → terminal) into a small,
 * render-friendly progress state. This is the end-to-end consumer of the
 * `tauri::ipc::Channel<OperationEvent>` long-operation contract: the backend
 * (or the mock IPC) emits per-item events as the filesystem plan is applied and
 * this hook surfaces a live item counter + terminal outcome to the UI.
 */

import { useCallback, useState } from 'react';
import { applyPlan } from './planApply';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { OperationEvent, PlanApplyResponse } from '@/bindings/index';

export interface PlanApplyProgress {
  /** Whether an apply is currently streaming. */
  running: boolean;
  /** Items applied so far (counts `item_applied` events). */
  applied: number;
  /** Items failed so far (counts `item_failed` events). */
  failed: number;
  /** Total items, once the `item_started` lead event reports it (else null). */
  total: number | null;
  /** Terminal outcome once the stream completes, else null. */
  terminal: 'completed' | 'failed' | null;
  /** The most recent streamed event type, for fine-grained UI. */
  lastEventType: OperationEvent['eventType'] | null;
  /**
   * Whether the run has halted on a pause condition (R-Pause-1: volume
   * unavailable, disk full, or a stale source file). Derived from the
   * backend's `warning` long-op event, which carries `pauseReason`/`runId`
   * (spec 042 US16). `plan.resume` re-validates the condition server-side;
   * this hook only reflects what the backend reports.
   */
  paused: boolean;
  /** Human-readable pause reason as reported by the backend, else null. */
  pauseReason: string | null;
  /** Run id needed to call `plan.resume`; set once a pause or the initial
   * apply response reports one. */
  runId: string | null;
  /**
   * `true` immediately after a successful `plan.resume` call. The backend
   * currently only flips the plan's DB state and does not re-spawn the
   * executor (known limitation — see issue #575), so no further progress
   * events will arrive on this run's channel. Rendered as a distinct,
   * non-progressing state rather than as `running` so the UI never implies
   * work is happening when it isn't. Cleared the instant a *real* event
   * does arrive (any event proves the run is alive again), so a future fix
   * to the backend continuation gap self-heals this without a UI change.
   */
  resumeStalled: boolean;
}

const IDLE: PlanApplyProgress = {
  running: false,
  applied: 0,
  failed: 0,
  total: null,
  terminal: null,
  lastEventType: null,
  paused: false,
  pauseReason: null,
  runId: null,
  resumeStalled: false,
};

/** Extract a numeric `itemsTotal` from an event payload when present. */
function readItemsTotal(payload: unknown): number | null {
  if (payload && typeof payload === 'object' && 'itemsTotal' in payload) {
    const v = (payload as { itemsTotal?: unknown }).itemsTotal;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

/** Extract a string field from an event payload when present. */
function readStringField(payload: unknown, field: string): string | null {
  if (payload && typeof payload === 'object' && field in payload) {
    const v = (payload as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

export function usePlanApplyProgress() {
  const [progress, setProgress] = useState<PlanApplyProgress>(IDLE);

  const reset = useCallback(() => setProgress(IDLE), []);

  const run = useCallback(
    async (args: {
      id: string;
      approvalToken?: string;
    }): Promise<PlanApplyResponse | null> => {
      setProgress({ ...IDLE, running: true });
      try {
        const response = await applyPlan({
          id: args.id,
          approvalToken: args.approvalToken,
          onEvent: (event: OperationEvent) => {
            setProgress((prev) => {
              // Any event proves the run is alive, so a post-resume "stalled"
              // read is stale the moment a new event arrives.
              const next: PlanApplyProgress = {
                ...prev,
                lastEventType: event.eventType,
                resumeStalled: false,
              };
              switch (event.eventType) {
                case 'item_started': {
                  const total = readItemsTotal(event.payload);
                  if (total != null) next.total = total;
                  const runId = readStringField(event.payload, 'runId');
                  if (runId != null) next.runId = runId;
                  break;
                }
                case 'item_applied':
                  next.applied = prev.applied + 1;
                  break;
                case 'item_failed':
                  next.failed = prev.failed + 1;
                  break;
                case 'warning': {
                  // Pause condition (R-Pause-1): volume unavailable, disk
                  // full, or a stale source file. The run has halted; it
                  // stays `running` (busy) until cancelled or resumed.
                  next.paused = true;
                  next.pauseReason = readStringField(
                    event.payload,
                    'pauseReason',
                  );
                  const runId = readStringField(event.payload, 'runId');
                  if (runId != null) next.runId = runId;
                  break;
                }
                case 'completed':
                  next.running = false;
                  next.terminal = 'completed';
                  break;
                case 'failed':
                  next.running = false;
                  next.terminal = 'failed';
                  break;
                default:
                  break;
              }
              return next;
            });
          },
        });
        // Ensure the running flag clears even if no terminal event arrived.
        setProgress((prev) =>
          prev.running ? { ...prev, running: false } : prev,
        );
        return response;
      } catch {
        setProgress((prev) => ({
          ...prev,
          running: false,
          terminal: 'failed',
        }));
        return null;
      }
    },
    [],
  );

  /**
   * Resume a paused run (`plan.resume`, R-Pause-1). Calls the real backend
   * command; the plan's DB state moves `paused -> applying` on success.
   *
   * The backend does not yet re-spawn the executor to continue the run's
   * remaining pending items (issue #575), so no `item_*`/`completed` events
   * will follow. Landing on `running: true` here would render as an
   * indefinite "Applying…" with every action disabled (`busy` gates the
   * whole footer) — a real UI trap, since the run genuinely never
   * progresses. Instead land on the distinct `resumeStalled` state:
   * `running` stays `false` so the footer's Close/Discard remain usable,
   * and the progress panel shows an honest "not yet restarted" message
   * instead of implying live progress.
   */
  const resume = useCallback(
    async (planId: string): Promise<boolean> => {
      if (progress.runId === null) return false;
      try {
        unwrap(await commands.plansResume(planId, progress.runId));
        setProgress((prev) => ({
          ...prev,
          running: false,
          paused: false,
          pauseReason: null,
          resumeStalled: true,
        }));
        return true;
      } catch {
        return false;
      }
    },
    [progress.runId],
  );

  /**
   * Cancel an in-flight apply run (`plan.cancel`, US3/FR-009). Only needs the
   * plan id — the backend signals the shared `CancellationToken` for the
   * plan's currently-registered run, no `run_id` required. The channel
   * already streaming this run's progress will still deliver the resulting
   * terminal `completed` event (backend-emitted for a cancelled run too), so
   * this function does not itself flip `progress` — the reducer above
   * self-updates from that event.
   */
  const cancel = useCallback(async (planId: string): Promise<boolean> => {
    try {
      unwrap(await commands.plansCancel(planId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { progress, run, resume, cancel, reset };
}
