/**
 * Guided first-project-flow client store (spec 010).
 *
 * Calls the `guided.*` Tauri commands (or stubs in mock mode) and exposes
 * a simple React-friendly hook surface.
 *
 * The guided commands are NOT in the auto-generated bindings yet — they will
 * be added when `cargo test` regenerates `src/bindings/index.ts`.  Until then
 * we call `invoke` directly with the stable command names.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types (mirror the Rust DTOs) ──────────────────────────────────────────────

export interface GuidedFlowStateDto {
  currentStep: string | null;
  completedSteps: string[];
  dismissed: boolean;
  dismissedAt: string | null;
  updatedAt: string;
}

export interface GuidedStateGetResponse {
  state: GuidedFlowStateDto;
}

export interface GuidedStepCompleteRequest {
  stepId: string;
}

export interface GuidedStepCompleteResponse {
  completed: boolean;
  nextStep: string | null;
  state: GuidedFlowStateDto;
}

export interface GuidedDismissResponse {
  dismissedAt: string;
}

export interface GuidedRestartResponse {
  state: GuidedFlowStateDto;
}

// ── Step ids (stable constants matching the Rust registry) ───────────────────

export const STEP_INBOX_CONFIRM_FIRST = 'inbox.confirm_first';
export const STEP_PROJECT_CREATE_FIRST = 'project.create_first';
export const STEP_TOOL_OPEN_FIRST = 'tool.open_first';

export const STEP_ORDER = [
  STEP_INBOX_CONFIRM_FIRST,
  STEP_PROJECT_CREATE_FIRST,
  STEP_TOOL_OPEN_FIRST,
] as const;

// ── Hint text by step id ──────────────────────────────────────────────────────

export const STEP_HINT_TEXT: Record<string, { title: string; body: string }> = {
  [STEP_INBOX_CONFIRM_FIRST]: {
    title: 'Confirm your first inventory item',
    body: 'Select a folder in your Inbox and click Confirm to move it into Inventory.',
  },
  [STEP_PROJECT_CREATE_FIRST]: {
    title: 'Create your first project',
    body: 'Click "+ New project" to create a project from your confirmed inventory items.',
  },
  [STEP_TOOL_OPEN_FIRST]: {
    title: 'Open your project in a processing tool',
    body: 'Click "Open in {tool}" to prepare your project for processing.',
  },
};

// ── Mock fallback ─────────────────────────────────────────────────────────────

function useMocks(): boolean {
  return import.meta.env.VITE_USE_MOCKS === 'true';
}

const IDLE_STATE: GuidedFlowStateDto = {
  currentStep: null,
  completedSteps: [],
  dismissed: false,
  dismissedAt: null,
  updatedAt: new Date().toISOString(),
};

// ── Command wrappers ──────────────────────────────────────────────────────────

export async function getGuidedState(): Promise<GuidedFlowStateDto> {
  if (useMocks()) return IDLE_STATE;
  try {
    const resp = await invoke<GuidedStateGetResponse>('guided.state.get');
    return resp.state;
  } catch {
    // If state_corrupted, retry once for the fresh Idle state.
    try {
      const resp2 = await invoke<GuidedStateGetResponse>('guided.state.get');
      return resp2.state;
    } catch {
      return IDLE_STATE;
    }
  }
}

export async function activateGuidedFlow(): Promise<GuidedFlowStateDto> {
  if (useMocks()) return { ...IDLE_STATE, currentStep: STEP_INBOX_CONFIRM_FIRST };
  try {
    return await invoke<GuidedFlowStateDto>('guided.activate');
  } catch {
    return IDLE_STATE;
  }
}

export async function completeGuidedStep(
  stepId: string,
): Promise<GuidedStepCompleteResponse> {
  if (useMocks()) {
    const idx = STEP_ORDER.indexOf(stepId as (typeof STEP_ORDER)[number]);
    const nextStep = idx >= 0 && idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1] : null;
    return {
      completed: true,
      nextStep,
      state: { ...IDLE_STATE, completedSteps: [stepId], currentStep: nextStep },
    };
  }
  return invoke<GuidedStepCompleteResponse>('guided.step.complete', { request: { stepId } });
}

export async function dismissGuidedFlow(): Promise<GuidedDismissResponse> {
  if (useMocks()) return { dismissedAt: new Date().toISOString() };
  return invoke<GuidedDismissResponse>('guided.dismiss');
}

export async function restartGuidedFlow(): Promise<GuidedFlowStateDto> {
  if (useMocks()) return { ...IDLE_STATE, currentStep: STEP_INBOX_CONFIRM_FIRST };
  try {
    const resp = await invoke<GuidedRestartResponse>('guided.restart');
    return resp.state;
  } catch {
    return IDLE_STATE;
  }
}
