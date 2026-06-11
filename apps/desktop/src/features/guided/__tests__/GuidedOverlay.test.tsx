/**
 * GuidedOverlay — component tests (spec 010, US1–US4).
 *
 * Tests run in jsdom (vitest + @testing-library/react).
 * The overlay uses createPortal which renders into document.body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GuidedOverlay } from '../GuidedOverlay';
import type { GuidedFlowStateDto } from '../store';

// Mock the Tauri invoke so tests run in jsdom without a Tauri bridge.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Mount an anchor element so the overlay can resolve it.
function mountAnchor(anchorId: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-guide-anchor', anchorId);
  btn.textContent = 'Anchor';
  document.body.appendChild(btn);
  return btn;
}

function removeAnchor(el: HTMLElement) {
  if (el.parentNode) el.parentNode.removeChild(el);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GuidedOverlay', () => {
  let anchorEl: HTMLButtonElement;

  beforeEach(() => {
    // Mount anchor for inbox.confirm_first before each test.
    anchorEl = mountAnchor('inbox.confirm-row');
  });

  afterEach(() => {
    cleanup();
    // Remove any dangling anchors.
    document.querySelectorAll('[data-guide-anchor]').forEach((el) => el.remove());
  });

  it('renders hint card when state is active and anchor is present', async () => {
    const state = makeState();
    render(
      <GuidedOverlay guidedState={state} onDismiss={() => {}} />,
    );

    // The hint card is rendered into document.body via a portal.
    // Wait for MutationObserver to fire by using findByTestId.
    const card = await screen.findByTestId('guided-hint-card');
    expect(card).toBeDefined();
    expect(card.getAttribute('aria-live')).toBe('polite');
  });

  it('renders dismiss button with accessible label', async () => {
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const dismissBtn = await screen.findByTestId('guided-dismiss-btn');
    expect(dismissBtn.getAttribute('aria-label')).toBe('Dismiss guided coach');
  });

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={onDismiss} />);

    const dismissBtn = await screen.findByTestId('guided-dismiss-btn');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Escape is pressed', async () => {
    const onDismiss = vi.fn();
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={onDismiss} />);

    // Wait for hint to mount.
    await screen.findByTestId('guided-hint-card');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when state is dismissed', () => {
    const state = makeState({ dismissed: true, currentStep: null });
    const { container } = render(
      <GuidedOverlay guidedState={state} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('guided-hint-card')).toBeNull();
  });

  it('renders nothing when guidedState is null', () => {
    const { container } = render(
      <GuidedOverlay guidedState={null} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when currentStep is null (completed flow)', () => {
    const state = makeState({
      currentStep: null,
      completedSteps: ['inbox.confirm_first', 'project.create_first', 'tool.open_first'],
    });
    const { container } = render(
      <GuidedOverlay guidedState={state} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('defers hint (renders nothing) when anchor element is absent (FR-007)', () => {
    // Remove anchor before rendering.
    removeAnchor(anchorEl);

    const state = makeState({ currentStep: 'inbox.confirm_first' });
    render(
      <GuidedOverlay guidedState={state} onDismiss={() => {}} />,
    );
    // The hook resolves async so nothing renders immediately.
    expect(screen.queryByTestId('guided-hint-card')).toBeNull();

    // afterEach will clean up; re-assign so beforeEach doesn't double-mount.
    anchorEl = document.createElement('button');
  });

  it('shows step 1 of 3 progress for inbox.confirm_first', async () => {
    const state = makeState({ currentStep: 'inbox.confirm_first' });
    render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const card = await screen.findByTestId('guided-hint-card');
    expect(card.textContent).toContain('Step 1 of 3');
  });

  it('hint card has aria-live="polite" (a11y, T044)', async () => {
    const state = makeState();
    render(<GuidedOverlay guidedState={state} onDismiss={() => {}} />);

    const card = await screen.findByTestId('guided-hint-card');
    expect(card.getAttribute('aria-live')).toBe('polite');
  });
});
