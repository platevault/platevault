/**
 * Guided flow event → step bridge (spec 010, FR-010, spec 033 T029).
 *
 * Subscribes to domain events forwarded over the Tauri event bus and
 * calls `completeGuidedStep` when the corresponding step's action is
 * performed by the user.
 *
 * Modeled on `apps/desktop/src/data/logSubscription.ts`.
 *
 * Event → step mapping:
 *   `inventory.confirmed`  → `inbox.confirm_first`
 *   `project.created`      → `project.create_first`
 *   `tool.opened`          → `tool.open_first`
 *
 * Filter rule: events with `source === "restore"` are ignored — they replay
 * historical state and MUST NOT advance the guide (FR-010).
 */

import { completeGuidedStep } from './store';

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

/** Maps a Tauri event topic to the guided-flow step id it completes. */
const EVENT_TO_STEP: Record<string, string> = {
  'inventory.confirmed': 'inbox.confirm_first',
  'project.created': 'project.create_first',
  'tool.opened': 'tool.open_first',
};

type UnlistenFn = () => void;

let unlisteners: UnlistenFn[] = [];
let started = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Handle a domain event envelope payload.
 *
 * Checks the `source` field on the envelope and skips `"restore"` events
 * so that state-restore replays do not advance the guide.
 */
function handleDomainEvent(topic: string, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;

  const envelope = payload as Record<string, unknown>;

  // Filter: ignore events emitted from a restore source.
  if (envelope['source'] === 'restore') return;

  const stepId = EVENT_TO_STEP[topic];
  if (!stepId) return;

  // Best-effort: do not let an error in completeGuidedStep crash the bridge.
  completeGuidedStep(stepId).catch((err: unknown) => {
    console.warn(`[guidedEventBridge] completeGuidedStep(${stepId}) failed:`, err);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the guided event bridge (idempotent).
 *
 * Subscribes to all domain events that can advance a guided step.
 * In mock mode this is a no-op (Tauri event API unavailable).
 */
export async function startGuidedEventBridge(): Promise<void> {
  if (IS_MOCK || started) return;
  started = true;

  try {
    const { listen } = await import('@tauri-apps/api/event');

    for (const topic of Object.keys(EVENT_TO_STEP)) {
      // Tauri event names only allow alphanumeric, '-', '/', ':', '_'.
      // Replace dots with ':' to form a valid Tauri event name while keeping
      // the original dotted topic for downstream handleDomainEvent routing.
      const eventName = topic.replace(/\./g, ':');
      const unlisten = await listen<unknown>(eventName, (event) => {
        handleDomainEvent(topic, event.payload);
      });
      unlisteners.push(unlisten);
    }
  } catch (err) {
    console.warn('[guidedEventBridge] listen registration failed:', err);
    started = false;
  }
}

/**
 * Stop the guided event bridge and remove all listeners.
 *
 * Safe to call even if the bridge was never started.
 */
export function stopGuidedEventBridge(): void {
  for (const fn of unlisteners) {
    try {
      fn();
    } catch {
      // best-effort cleanup
    }
  }
  unlisteners = [];
  started = false;
}
