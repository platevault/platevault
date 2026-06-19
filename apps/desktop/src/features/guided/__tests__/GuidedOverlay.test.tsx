/**
 * GuidedOverlay — component tests (spec 010, FR-011, spec 033 T030).
 *
 * The overlay was rewritten to use react-joyride 3.1 (D6). These tests verify:
 * - Joyride receives `run`, `stepIndex`, `blockTargetInteraction` (non-modal/FR-011).
 * - The component returns null when dismissed or no current step.
 * - `onDismiss` is called on STATUS.FINISHED / STATUS.SKIPPED via `onEvent`.
 *
 * react-joyride is mocked so tests run in jsdom without a real layout engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { GuidedFlowStateDto } from '../store';

// ── Mock react-joyride ────────────────────────────────────────────────────────

import type { Props as JoyrideProps, EventData } from 'react-joyride';

let capturedProps: JoyrideProps | null = null;

vi.mock('react-joyride', () => ({
  Joyride: (props: JoyrideProps) => {
    capturedProps = props;
    return (
      <div
        data-testid="joyride-mock"
        data-run={String(props.run)}
        data-step={String(props.stepIndex)}
      />
    );
  },
  STATUS: {
    FINISHED: 'finished',
    SKIPPED: 'skipped',
    RUNNING: 'running',
    PAUSED: 'paused',
    IDLE: 'idle',
    WAITING: 'waiting',
    READY: 'ready',
  },
}));

// ── Mock Tauri invoke ─────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function makeState(overrides: Partial<GuidedFlowStateDto> = {}): GuidedFlowStateDto {
  return {
    currentStep: 'inbox.confirm_first',
    completedSteps: [],
    dismissed: false,
    dismissedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

/** Simulate a joyride onEvent callback in v3.1. */
function fireOnEvent(status: string) {
  if (!capturedProps?.onEvent) return;
  (capturedProps.onEvent as (data: EventData) => void)({ status } as EventData);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GuidedOverlay (react-joyride 3.1 render layer)', () => {
  beforeEach(() => {
    capturedProps = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Joyride with run=true when state is active', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({ currentStep: 'inbox.confirm_first' });
    const { getByTestId } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const mock = getByTestId('joyride-mock');
    expect(mock.getAttribute('data-run')).toBe('true');
  });

  it('steps have blockTargetInteraction=false (non-modal, FR-011)', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const steps = capturedProps?.steps ?? [];
    expect(steps.length).toBe(3);
    for (const step of steps) {
      expect(step.blockTargetInteraction).toBe(false);
    }
  });

  it('passes stepIndex=0 for inbox.confirm_first', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({ currentStep: 'inbox.confirm_first' });
    const { getByTestId } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    expect(getByTestId('joyride-mock').getAttribute('data-step')).toBe('0');
  });

  it('passes stepIndex=1 for project.create_first', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({ currentStep: 'project.create_first' });
    const { getByTestId } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    expect(getByTestId('joyride-mock').getAttribute('data-step')).toBe('1');
  });

  it('passes stepIndex=2 for tool.open_first', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({ currentStep: 'tool.open_first' });
    const { getByTestId } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    expect(getByTestId('joyride-mock').getAttribute('data-step')).toBe('2');
  });

  it('renders nothing when state is dismissed', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({ dismissed: true, currentStep: null });
    const { container } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when guidedState is null', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const { container } = render(<GuidedOverlay guidedState={null} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when currentStep is null (completed flow)', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState({
      currentStep: null,
      completedSteps: ['inbox.confirm_first', 'project.create_first', 'tool.open_first'],
    });
    const { container } = render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onDismiss when STATUS.FINISHED fires via onEvent', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const onDismiss = vi.fn();
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={onDismiss} />);

    fireOnEvent('finished');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when STATUS.SKIPPED fires via onEvent', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const onDismiss = vi.fn();
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={onDismiss} />);

    fireOnEvent('skipped');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('steps include data-guide-anchor targets', async () => {
    const { GuidedOverlay } = await import('../GuidedOverlay');
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const steps = capturedProps?.steps ?? [];
    expect(steps.length).toBe(3);
    for (const step of steps) {
      expect(String(step.target)).toContain('data-guide-anchor');
    }
  });
});
