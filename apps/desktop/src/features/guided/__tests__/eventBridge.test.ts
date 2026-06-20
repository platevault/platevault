/**
 * Unit tests for the guided event→step bridge (spec 033 T026/T029, FR-010).
 *
 * Covers:
 * - Bridge calls `completeGuidedStep` when domain events arrive.
 * - `source === "restore"` events are filtered out (never advance the guide).
 * - Each event topic maps to the correct step id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Tauri event API ──────────────────────────────────────────────────────

type ListenerFn = (event: { payload: unknown }) => void;
const listeners: Map<string, ListenerFn[]> = new Map();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (topic: string, fn: ListenerFn) => {
    const existing = listeners.get(topic) ?? [];
    existing.push(fn);
    listeners.set(topic, existing);
    // Return an unlisten function.
    return () => {
      const fns = listeners.get(topic) ?? [];
      listeners.set(
        topic,
        fns.filter((f) => f !== fn),
      );
    };
  }),
}));

// ── Mock store ────────────────────────────────────────────────────────────────

const mockCompleteGuidedStep = vi.fn().mockResolvedValue({
  completed: true,
  nextStep: null,
  state: { currentStep: null, completedSteps: [], dismissed: false, dismissedAt: null, updatedAt: '' },
});

vi.mock('../store', () => ({
  completeGuidedStep: mockCompleteGuidedStep,
}));

// ── Helper: emit a simulated Tauri event ──────────────────────────────────────

function emitEvent(topic: string, payload: unknown): void {
  // The bridge registers listeners under the Tauri-valid (dot→colon) event name.
  const fns = listeners.get(topic.replace(/\./g, ':')) ?? [];
  for (const fn of fns) {
    fn({ payload });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('guidedEventBridge', () => {
  beforeEach(() => {
    // Clear listeners and mocks between tests.
    listeners.clear();
    mockCompleteGuidedStep.mockClear();
    // Ensure mock mode is OFF so the bridge registers listeners.
    vi.stubEnv('VITE_USE_MOCKS', 'false');
  });

  afterEach(async () => {
    // Stop the bridge to reset its internal state for the next test.
    const { stopGuidedEventBridge } = await import('../eventBridge');
    stopGuidedEventBridge();
    vi.unstubAllEnvs();
  });

  it('advances inbox.confirm_first on inventory.confirmed event', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();

    emitEvent('inventory.confirmed', { source: 'user', inboxItemId: 'item-1', planId: 'plan-1', at: '2026-01-01T00:00:00Z' });

    await vi.waitFor(() => {
      expect(mockCompleteGuidedStep).toHaveBeenCalledWith('inbox.confirm_first');
    });
  });

  it('advances project.create_first on project.created event', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();

    emitEvent('project.created', { source: 'user', projectId: 'proj-1', at: '2026-01-01T00:00:00Z' });

    await vi.waitFor(() => {
      expect(mockCompleteGuidedStep).toHaveBeenCalledWith('project.create_first');
    });
  });

  it('advances tool.open_first on tool.opened event', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();

    emitEvent('tool.opened', { source: 'user', toolId: 'pixinsight', projectId: 'proj-1', at: '2026-01-01T00:00:00Z' });

    await vi.waitFor(() => {
      expect(mockCompleteGuidedStep).toHaveBeenCalledWith('tool.open_first');
    });
  });

  it('ignores inventory.confirmed when source is "restore" (FR-010)', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();

    emitEvent('inventory.confirmed', { source: 'restore', inboxItemId: 'item-1', planId: 'plan-1', at: '2026-01-01T00:00:00Z' });

    // Give any async work a moment.
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCompleteGuidedStep).not.toHaveBeenCalled();
  });

  it('ignores project.created when source is "restore"', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();

    emitEvent('project.created', { source: 'restore', projectId: 'proj-1', at: '2026-01-01T00:00:00Z' });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockCompleteGuidedStep).not.toHaveBeenCalled();
  });

  it('is idempotent — startGuidedEventBridge called twice registers listeners once', async () => {
    const { startGuidedEventBridge } = await import('../eventBridge');
    await startGuidedEventBridge();
    await startGuidedEventBridge(); // second call should be no-op

    emitEvent('inventory.confirmed', { source: 'user', inboxItemId: 'item-2', planId: 'plan-2', at: '2026-01-01T00:00:00Z' });

    await vi.waitFor(() => {
      expect(mockCompleteGuidedStep).toHaveBeenCalledTimes(1);
    });
  });
});
