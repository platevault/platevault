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

  it('STEP_HINT_TEXT covers all steps', () => {
    for (const stepId of STEP_ORDER) {
      expect(STEP_HINT_TEXT[stepId]).toBeDefined();
      expect(STEP_HINT_TEXT[stepId].title).toBeTruthy();
      expect(STEP_HINT_TEXT[stepId].body).toBeTruthy();
    }
  });
});

describe('guided/store — mock mode', () => {
  beforeEach(() => {
    // Set mock mode for all tests in this block.
    vi.stubEnv('VITE_USE_MOCKS', 'true');
  });

  it('getGuidedState returns Idle in mock mode', async () => {
    const { getGuidedState } = await import('../store');
    const state = await getGuidedState();
    expect(state.currentStep).toBeNull();
    expect(state.completedSteps).toHaveLength(0);
    expect(state.dismissed).toBe(false);
  });

  it('activateGuidedFlow returns first step in mock mode', async () => {
    const { activateGuidedFlow } = await import('../store');
    const state = await activateGuidedFlow();
    expect(state.currentStep).toBe(STEP_INBOX_CONFIRM_FIRST);
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

  it('dismissGuidedFlow returns a dismissedAt timestamp in mock mode', async () => {
    const { dismissGuidedFlow } = await import('../store');
    const resp = await dismissGuidedFlow();
    expect(resp.dismissedAt).toBeTruthy();
    // Should be a parseable ISO date.
    expect(new Date(resp.dismissedAt).getTime()).toBeGreaterThan(0);
  });

  it('restartGuidedFlow returns first step in mock mode', async () => {
    const { restartGuidedFlow } = await import('../store');
    const state = await restartGuidedFlow();
    expect(state.currentStep).toBe(STEP_INBOX_CONFIRM_FIRST);
    expect(state.dismissed).toBe(false);
  });
});
