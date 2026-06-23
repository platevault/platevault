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
import { applyPlan } from '@/api/commands';
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
}

const IDLE: PlanApplyProgress = {
  running: false,
  applied: 0,
  failed: 0,
  total: null,
  terminal: null,
  lastEventType: null,
};

/** Extract a numeric `itemsTotal` from an event payload when present. */
function readItemsTotal(payload: unknown): number | null {
  if (payload && typeof payload === 'object' && 'itemsTotal' in payload) {
    const v = (payload as { itemsTotal?: unknown }).itemsTotal;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

export function usePlanApplyProgress() {
  const [progress, setProgress] = useState<PlanApplyProgress>(IDLE);

  const reset = useCallback(() => setProgress(IDLE), []);

  const run = useCallback(
    async (args: { id: string; approvalToken?: string }): Promise<PlanApplyResponse | null> => {
      setProgress({ ...IDLE, running: true });
      try {
        const response = await applyPlan({
          id: args.id,
          approvalToken: args.approvalToken,
          onEvent: (event: OperationEvent) => {
            setProgress((prev) => {
              const next: PlanApplyProgress = { ...prev, lastEventType: event.eventType };
              switch (event.eventType) {
                case 'item_started': {
                  const total = readItemsTotal(event.payload);
                  if (total != null) next.total = total;
                  break;
                }
                case 'item_applied':
                  next.applied = prev.applied + 1;
                  break;
                case 'item_failed':
                  next.failed = prev.failed + 1;
                  break;
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
        setProgress((prev) => (prev.running ? { ...prev, running: false } : prev));
        return response;
      } catch {
        setProgress((prev) => ({ ...prev, running: false, terminal: 'failed' }));
        return null;
      }
    },
    [],
  );

  return { progress, run, reset };
}
