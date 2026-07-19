// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for guided flow store helpers (spec 010).
 *
 * These tests run in jsdom (no Tauri runtime) and cover:
 * - Step constants match the spec registry order.
 * - STEP_HINT_TEXT covers all steps.
 * - Mock command wrappers return sensible defaults.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core so dynamic imports in mock mode don't error.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

const {
  mockGuidedStateGet,
  mockGuidedActivate,
  mockGuidedDismiss,
  mockGuidedRestart,
} = vi.hoisted(() => ({
  mockGuidedStateGet: vi.fn(),
  mockGuidedActivate: vi.fn(),
  mockGuidedDismiss: vi.fn(),
  mockGuidedRestart: vi.fn(),
}));

vi.mock('@/bindings/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      guidedStateGet: mockGuidedStateGet,
      guidedActivate: mockGuidedActivate,
      guidedDismiss: mockGuidedDismiss,
      guidedRestart: mockGuidedRestart,
    },
  };
});

import {
  STEP_INBOX_CONFIRM_FIRST,
  STEP_PROJECT_CREATE_FIRST,
  STEP_TOOL_OPEN_FIRST,
  STEP_ORDER,
  STEP_HINT_TEXT,
} from '../store';

describe('guided/store — step constants', () => {
  it('STEP_ORDER has three steps in spec order', () => {
    expect(STEP_ORDER).toHaveLength(3);
    expect(STEP_ORDER[0]).toBe(STEP_INBOX_CONFIRM_FIRST);
    expect(STEP_ORDER[1]).toBe(STEP_PROJECT_CREATE_FIRST);
    expect(STEP_ORDER[2]).toBe(STEP_TOOL_OPEN_FIRST);
  });

  it('STEP_INBOX_CONFIRM_FIRST matches spec id', () => {
    expect(STEP_INBOX_CONFIRM_FIRST).toBe('inbox.confirm_first');
  });

  it('STEP_PROJECT_CREATE_FIRST matches spec id', () => {
    expect(STEP_PROJECT_CREATE_FIRST).toBe('project.create_first');
  });

  it('STEP_TOOL_OPEN_FIRST matches spec id', () => {
    expect(STEP_TOOL_OPEN_FIRST).toBe('tool.open_first');
  });

  it('STEP_HINT_TEXT covers all steps with distinct, non-empty copy', () => {
    // Truthy-only checks would pass even if every step reused the same i18n
    // key by copy-paste error; uniqueness across steps catches that.
    const titles = new Set<string>();
    const bodies = new Set<string>();
    for (const stepId of STEP_ORDER) {
      const hint = STEP_HINT_TEXT[stepId];
      expect(hint).toBeDefined();
      expect(hint.title.trim().length).toBeGreaterThan(0);
      expect(hint.body.trim().length).toBeGreaterThan(0);
      titles.add(hint.title);
      bodies.add(hint.body);
    }
    expect(titles.size).toBe(STEP_ORDER.length);
    expect(bodies.size).toBe(STEP_ORDER.length);
  });
});

describe('guided/store — mock mode', () => {
  beforeEach(() => {
    // Set mock mode for all tests in this block.
    vi.stubEnv('VITE_USE_MOCKS', 'true');
  });

  it('completeGuidedStep advances to next in mock mode', async () => {
    const { completeGuidedStep } = await import('../store');
    const resp = await completeGuidedStep(STEP_INBOX_CONFIRM_FIRST);
    expect(resp.completed).toBe(true);
    expect(resp.nextStep).toBe(STEP_PROJECT_CREATE_FIRST);
  });

  it('completeGuidedStep for last step returns null nextStep in mock mode', async () => {
    const { completeGuidedStep } = await import('../store');
    const resp = await completeGuidedStep(STEP_TOOL_OPEN_FIRST);
    expect(resp.completed).toBe(true);
    expect(resp.nextStep).toBeNull();
  });
});

// The former "getGuidedState/activateGuidedFlow/dismissGuidedFlow/
// restartGuidedFlow ... in mock mode" tests each asserted a value that is
// hardcoded verbatim in store.ts's `if (isMockMode()) return ...` branches —
// they could not fail short of deleting that line. The branch these
// wrappers exist for — dispatching through `commands.*` + `unwrap`,
// including the retry/fallback logic on backend failure — had no coverage
// at all. These tests exercise that real path instead.
describe('guided/store — backend command path (VITE_USE_MOCKS=false)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    mockGuidedStateGet.mockReset();
    mockGuidedActivate.mockReset();
    mockGuidedDismiss.mockReset();
    mockGuidedRestart.mockReset();
  });

  it('getGuidedState unwraps and returns the backend state', async () => {
    const backendState = {
      currentStep: STEP_PROJECT_CREATE_FIRST,
      completedSteps: [STEP_INBOX_CONFIRM_FIRST],
      dismissed: false,
      dismissedAt: null,
      updatedAt: '2026-07-18T00:00:00.000Z',
    };
    mockGuidedStateGet.mockResolvedValue({
      status: 'ok',
      data: { state: backendState },
    });
    const { getGuidedState } = await import('../store');
    await expect(getGuidedState()).resolves.toEqual(backendState);
    expect(mockGuidedStateGet).toHaveBeenCalledTimes(1);
  });

  it('getGuidedState retries once on failure, then returns the retry result', async () => {
    const retryState = {
      currentStep: null,
      completedSteps: [],
      dismissed: false,
      dismissedAt: null,
      updatedAt: '2026-07-18T00:00:00.000Z',
    };
    mockGuidedStateGet
      .mockRejectedValueOnce(new Error('state_corrupted'))
      .mockResolvedValueOnce({ status: 'ok', data: { state: retryState } });
    const { getGuidedState } = await import('../store');
    await expect(getGuidedState()).resolves.toEqual(retryState);
    expect(mockGuidedStateGet).toHaveBeenCalledTimes(2);
  });

  it('getGuidedState falls back to Idle when both attempts fail', async () => {
    mockGuidedStateGet.mockRejectedValue(new Error('state_corrupted'));
    const { getGuidedState } = await import('../store');
    const state = await getGuidedState();
    expect(state.currentStep).toBeNull();
    expect(state.completedSteps).toHaveLength(0);
    expect(mockGuidedStateGet).toHaveBeenCalledTimes(2);
  });

  it('activateGuidedFlow unwraps and returns the backend response', async () => {
    const backendState = {
      currentStep: STEP_INBOX_CONFIRM_FIRST,
      completedSteps: [],
      dismissed: false,
      dismissedAt: null,
      updatedAt: '2026-07-18T00:00:00.000Z',
    };
    mockGuidedActivate.mockResolvedValue({ status: 'ok', data: backendState });
    const { activateGuidedFlow } = await import('../store');
    await expect(activateGuidedFlow()).resolves.toEqual(backendState);
  });

  it('activateGuidedFlow falls back to Idle on backend failure', async () => {
    mockGuidedActivate.mockRejectedValue(new Error('backend unavailable'));
    const { activateGuidedFlow } = await import('../store');
    const state = await activateGuidedFlow();
    expect(state.currentStep).toBeNull();
  });

  it('dismissGuidedFlow unwraps and returns the backend response verbatim', async () => {
    mockGuidedDismiss.mockResolvedValue({
      status: 'ok',
      data: { dismissedAt: '2026-07-18T12:00:00.000Z' },
    });
    const { dismissGuidedFlow } = await import('../store');
    await expect(dismissGuidedFlow()).resolves.toEqual({
      dismissedAt: '2026-07-18T12:00:00.000Z',
    });
  });

  it('restartGuidedFlow unwraps and returns the backend state', async () => {
    const backendState = {
      currentStep: STEP_TOOL_OPEN_FIRST,
      completedSteps: [STEP_INBOX_CONFIRM_FIRST, STEP_PROJECT_CREATE_FIRST],
      dismissed: false,
      dismissedAt: null,
      updatedAt: '2026-07-18T00:00:00.000Z',
    };
    mockGuidedRestart.mockResolvedValue({
      status: 'ok',
      data: { state: backendState },
    });
    const { restartGuidedFlow } = await import('../store');
    await expect(restartGuidedFlow()).resolves.toEqual(backendState);
  });

  it('restartGuidedFlow falls back to Idle on backend failure', async () => {
    mockGuidedRestart.mockRejectedValue(new Error('backend unavailable'));
    const { restartGuidedFlow } = await import('../store');
    const state = await restartGuidedFlow();
    expect(state.currentStep).toBeNull();
    expect(state.dismissed).toBe(false);
  });
});
