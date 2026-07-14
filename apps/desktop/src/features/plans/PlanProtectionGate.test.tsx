// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Vitest unit tests for PlanProtectionGate (spec 016 US3, T024).
 *
 * Tests protection check display and acknowledgement flow using mock invoke.
 * Does NOT run against a real backend — all Tauri invocations are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanProtectionGate } from './PlanProtectionGate';
import type { PlanProtectionCheckResponse } from '@/bindings/index';

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// The component calls the generated bindings (`commands.*`) directly (spec 037),
// so we mock at the dispatch layer (`@/bindings/index`) and return generated
// `Result`-shaped values that the real `unwrap` in the component translates.

vi.mock('@/bindings/index', () => ({
  commands: {
    planProtectionCheckCmd: vi.fn(),
    protectionPlanAcknowledged: vi.fn(),
  },
}));

import { commands } from '@/bindings/index';

const mockCheck = vi.mocked(commands.planProtectionCheckCmd);
const mockAck = vi.mocked(commands.protectionPlanAcknowledged);

/** Wrap a value in the generated `{ status: 'ok' }` Result envelope. */
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCheckResponse(
  overrides: Partial<PlanProtectionCheckResponse> = {},
) {
  return ok<PlanProtectionCheckResponse>({
    planId: 'plan-1',
    hasProtectedItems: false,
    protectedItems: [],
    nonBlockingSummary: { normalCount: 0, unprotectedCount: 0 },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAck.mockResolvedValue(ok('audit-id-1'));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanProtectionGate', () => {
  it('shows loading state initially', () => {
    // Never resolves during this test.
    mockCheck.mockReturnValue(new Promise(() => {}));
    render(<PlanProtectionGate planId="plan-1" />);
    expect(screen.getByText(/Checking plan protection/i)).toBeTruthy();
  });

  it('shows no-protected-items message when plan is clean', async () => {
    mockCheck.mockResolvedValue(
      makeCheckResponse({
        hasProtectedItems: false,
        nonBlockingSummary: { normalCount: 3, unprotectedCount: 0 },
      }),
    );
    const onChange = vi.fn();
    render(
      <PlanProtectionGate planId="plan-1" onAcknowledgedChange={onChange} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/No protected items/i)).toBeTruthy();
    });
    // onAcknowledgedChange should have been called with true.
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders protected item with acknowledge button', async () => {
    mockCheck.mockResolvedValue(
      makeCheckResponse({
        hasProtectedItems: true,
        protectedItems: [
          {
            itemId: 'item-abc',
            sourceId: 'src-1',
            level: 'protected',
            matchedCategories: ['lights'],
            originalAction: 'delete',
            rewrittenAction: 'archive',
            requiresAcknowledgement: true,
            reason: 'Item is from a protected source.',
          },
        ],
        nonBlockingSummary: { normalCount: 2, unprotectedCount: 0 },
      }),
    );
    render(<PlanProtectionGate planId="plan-1" />);

    await waitFor(() => {
      expect(screen.getByText(/require acknowledgement/i)).toBeTruthy();
    });

    // Rewritten action should be displayed.
    expect(screen.getByText(/delete.*archive/i)).toBeTruthy();
    // Acknowledge button present.
    expect(screen.getByRole('button', { name: /Acknowledge/i })).toBeTruthy();
    // Reason text.
    expect(screen.getByText(/protected source/i)).toBeTruthy();
  });

  it('marks item as acknowledged after button click', async () => {
    const onChange = vi.fn();
    mockCheck.mockResolvedValue(
      makeCheckResponse({
        hasProtectedItems: true,
        protectedItems: [
          {
            itemId: 'item-xyz',
            sourceId: null,
            level: 'protected',
            matchedCategories: [],
            originalAction: 'move',
            rewrittenAction: null,
            requiresAcknowledgement: true,
            reason: 'Protected.',
          },
        ],
        nonBlockingSummary: { normalCount: 0, unprotectedCount: 0 },
      }),
    );
    render(
      <PlanProtectionGate planId="plan-1" onAcknowledgedChange={onChange} />,
    );

    await waitFor(() => screen.getByRole('button', { name: /Acknowledge/i }));
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/i }));

    await waitFor(() => {
      // All-done header shows "All acknowledged" pill.
      expect(screen.getByText('All acknowledged')).toBeTruthy();
    });
    // protectionPlanAcknowledged was called with correct args.
    expect(mockAck).toHaveBeenCalledWith(
      'plan-1',
      'item-xyz',
      null,
      'protected',
      'Protected.',
    );
    // onAcknowledgedChange called with true (all 1 items done).
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows error message on load failure', async () => {
    mockCheck.mockRejectedValue(new Error('network error'));
    render(<PlanProtectionGate planId="plan-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Protection check failed to load/i)).toBeTruthy();
    });
  });

  it('shows non-blocking summary counts', async () => {
    mockCheck.mockResolvedValue(
      makeCheckResponse({
        hasProtectedItems: true,
        protectedItems: [
          {
            itemId: 'item-1',
            sourceId: null,
            level: 'protected',
            matchedCategories: [],
            originalAction: 'archive',
            rewrittenAction: null,
            requiresAcknowledgement: true,
            reason: 'Protected.',
          },
        ],
        nonBlockingSummary: { normalCount: 5, unprotectedCount: 2 },
      }),
    );
    render(<PlanProtectionGate planId="plan-1" />);

    await waitFor(() => {
      expect(screen.getByText(/5 normal item/i)).toBeTruthy();
      expect(screen.getByText(/2 unprotected item/i)).toBeTruthy();
    });
  });
});
