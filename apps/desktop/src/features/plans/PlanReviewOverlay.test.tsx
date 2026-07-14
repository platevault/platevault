// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * PlanReviewOverlay tests — spec 017 WP-E (cleanup-plan review + progress UI).
 *
 * Covers the shared review overlay's contract:
 * 1. Renders every plan item (source path, action, protection) from plans.get.
 * 2. Protected items keep "Approve & apply" disabled until acknowledged via
 *    the spec-016 protection gate; acknowledging unlocks it.
 * 3. Approve & apply drives plans.approve → plans.apply (with the approval
 *    token) and reports the completed terminal state (progress UI, D17).
 * 4. Discard calls plans.discard and closes the overlay.
 * 5. A zero-item plan cannot be approved (FR-014).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PlanDetail_Serialize,
  PlanItemDetail_Serialize,
  PlanProtectionCheckResponse,
  OperationEvent,
} from '@/bindings/index';

const {
  mockPlansGet,
  mockPlansApprove,
  mockPlansDiscard,
  mockPlansRetry,
  mockPlansResume,
  mockPlansCancel,
  mockPlansConfirmDestructive,
  mockProtectionCheck,
  mockAcknowledge,
  mockApplyPlan,
} = vi.hoisted(() => ({
  mockPlansGet: vi.fn(),
  mockPlansApprove: vi.fn(),
  mockPlansDiscard: vi.fn(),
  mockPlansRetry: vi.fn(),
  mockPlansResume: vi.fn(),
  mockPlansCancel: vi.fn(),
  mockPlansConfirmDestructive: vi.fn(),
  mockProtectionCheck: vi.fn(),
  mockAcknowledge: vi.fn(),
  mockApplyPlan: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    plansGet: mockPlansGet,
    plansApprove: mockPlansApprove,
    plansDiscard: mockPlansDiscard,
    plansRetry: mockPlansRetry,
    plansResume: mockPlansResume,
    plansCancel: mockPlansCancel,
    plansConfirmDestructive: mockPlansConfirmDestructive,
    planProtectionCheckCmd: mockProtectionCheck,
    protectionPlanAcknowledged: mockAcknowledge,
  },
}));

// The apply IPC wrapper bridges a Tauri Channel; mock it so the test drives
// the OperationEvent stream directly (same seam usePlanApplyProgress uses).
vi.mock('./planApply', () => ({
  applyPlan: mockApplyPlan,
}));

import { PlanReviewOverlay } from './PlanReviewOverlay';

/** Wrap a value in the generated `{ status: 'ok' }` Result envelope. */
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function item(
  overrides: Partial<PlanItemDetail_Serialize> = {},
): PlanItemDetail_Serialize {
  return {
    id: 'item-0',
    index: 0,
    name: 'light_001.xisf',
    action: 'archive',
    from: 'calibrated/light_001.xisf',
    to: '',
    reason: 'intermediate artifact',
    protection: 'normal',
    state: 'pending',
    ...overrides,
  };
}

function plan(
  overrides: Partial<PlanDetail_Serialize> = {},
): PlanDetail_Serialize {
  const items = overrides.items ?? [
    item(),
    item({
      id: 'item-1',
      index: 1,
      name: 'master_dark.xisf',
      from: 'masters/master_dark.xisf',
      protection: 'protected',
    }),
  ];
  return {
    id: 'plan-1',
    number: 1,
    title: 'Cleanup: M31 LRGB',
    origin: 'cleanup',
    state: 'ready_for_review',
    planType: 'cleanup',
    destructiveDestination: 'archive',
    itemsTotal: items.length,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    itemsCancelled: 0,
    itemsPending: items.length,
    totalBytesRequired: 3000,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
    items,
  };
}

function protectionCheck(
  overrides: Partial<PlanProtectionCheckResponse> = {},
): PlanProtectionCheckResponse {
  return {
    planId: 'plan-1',
    hasProtectedItems: true,
    protectedItems: [
      {
        itemId: 'item-1',
        sourceId: 'project-1',
        level: 'protected',
        reason: 'masters are protected by default',
        matchedCategories: ['masters'],
        originalAction: 'archive',
        rewrittenAction: null,
        requiresAcknowledgement: true,
      },
    ],
    nonBlockingSummary: { normalCount: 1, unprotectedCount: 0 },
    ...overrides,
  };
}

function renderOverlay(
  props: Partial<Parameters<typeof PlanReviewOverlay>[0]> = {},
) {
  return render(
    <PlanReviewOverlay planId="plan-1" open onClose={vi.fn()} {...props} />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPlansGet.mockResolvedValue(ok(plan()));
  mockProtectionCheck.mockResolvedValue(ok(protectionCheck()));
  mockAcknowledge.mockResolvedValue(ok('audit-1'));
  mockPlansApprove.mockResolvedValue(
    ok({
      planId: 'plan-1',
      newState: 'approved',
      approvalToken: 'tok-plan-1',
      approvedAt: '2026-07-01T00:00:00Z',
    }),
  );
  mockPlansDiscard.mockResolvedValue(
    ok({ planId: 'plan-1', discardedAt: '2026-07-01T00:00:00Z' }),
  );
  mockPlansCancel.mockResolvedValue(
    ok({
      planId: 'plan-1',
      cancelledAt: '2026-07-01T00:00:00Z',
      itemsApplied: 0,
      itemsCancelled: 1,
    }),
  );
  mockPlansConfirmDestructive.mockResolvedValue(
    ok({ planId: 'plan-1', itemsConfirmed: 1 }),
  );
  // Default apply: streams item events then a completed terminal event.
  mockApplyPlan.mockImplementation(
    (args: { id: string; onEvent?: (e: OperationEvent) => void }) => {
      const mk = (
        sequence: number,
        eventType: OperationEvent['eventType'],
        payload: unknown,
      ): OperationEvent => ({
        contractVersion: '1.0.0',
        operationId: 'op-1',
        eventType,
        sequence,
        payload,
      });
      args.onEvent?.(mk(0, 'item_started', { itemsTotal: 2 }));
      args.onEvent?.(mk(1, 'item_applied', {}));
      args.onEvent?.(mk(2, 'item_applied', {}));
      args.onEvent?.(mk(3, 'completed', {}));
      return Promise.resolve({
        planId: args.id,
        runId: 'op-1',
        newState: 'applied',
      });
    },
  );
});

describe('PlanReviewOverlay (spec 017 WP-E)', () => {
  it('renders every plan item with source path and protection state', async () => {
    renderOverlay();
    expect(await screen.findByText('light_001.xisf')).toBeInTheDocument();
    expect(screen.getByText('master_dark.xisf')).toBeInTheDocument();
    expect(screen.getByText('calibrated/light_001.xisf')).toBeInTheDocument();
    // Protected item is clearly marked.
    const protectedRow = screen.getByTestId('plan-review-item-1');
    expect(protectedRow).toHaveClass('alm-plan-review__row--protected');
    // Read-only until approval (FR-002 note).
    expect(
      screen.getByText(/Nothing has been changed on disk/),
    ).toBeInTheDocument();
  });

  it('renders the destination for archive items and a deletion cue for delete items (FR-003)', async () => {
    mockPlansGet.mockResolvedValue(
      ok(
        plan({
          items: [
            item({ to: '.astro-plan-archive/plan-1/item-0-light_001.xisf' }),
            item({
              id: 'item-1',
              index: 1,
              name: 'raw_002.fits',
              action: 'delete',
              to: '',
            }),
          ],
        }),
      ),
    );
    renderOverlay();
    expect(
      await screen.findByText(
        '.astro-plan-archive/plan-1/item-0-light_001.xisf',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Deleted, not moved')).toBeInTheDocument();
  });

  it('keeps Approve & apply disabled until protected items are acknowledged', async () => {
    renderOverlay();
    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    expect(approveBtn).toBeDisabled();

    fireEvent.click(await screen.findByText('Acknowledge'));
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('approve & apply drives plans.approve → apply with the token and reports completion', async () => {
    const onApplied = vi.fn();
    renderOverlay({ onApplied });

    fireEvent.click(await screen.findByText('Acknowledge'));
    const approveBtn = screen.getByTestId('plan-review-approve-apply');
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(mockPlansApprove).toHaveBeenCalledWith('plan-1'),
    );
    await waitFor(() =>
      expect(mockApplyPlan).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'plan-1', approvalToken: 'tok-plan-1' }),
      ),
    );
    // Terminal completed state is surfaced (progress UI).
    expect(
      await screen.findByTestId('plan-review-progress'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 items applied')).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('discard calls plans.discard and closes the overlay', async () => {
    const onClose = vi.fn();
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    renderOverlay({ onClose });

    fireEvent.click(await screen.findByText('Discard plan'));
    await waitFor(() =>
      expect(mockPlansDiscard).toHaveBeenCalledWith('plan-1'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('offers "Generate retry plan" after a partially_applied outcome and drives plans.retry (US5, T037)', async () => {
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    mockApplyPlan.mockImplementation(
      (args: { id: string; onEvent?: (e: OperationEvent) => void }) => {
        const mk = (
          sequence: number,
          eventType: OperationEvent['eventType'],
          payload: unknown,
        ): OperationEvent => ({
          contractVersion: '1.0.0',
          operationId: 'op-1',
          eventType,
          sequence,
          payload,
        });
        args.onEvent?.(mk(0, 'item_started', { itemsTotal: 2 }));
        args.onEvent?.(mk(1, 'item_applied', {}));
        args.onEvent?.(mk(2, 'item_failed', {}));
        args.onEvent?.(mk(3, 'failed', {}));
        return Promise.resolve({
          planId: args.id,
          runId: 'op-1',
          newState: 'partially_applied',
        });
      },
    );
    mockPlansRetry.mockResolvedValue(
      ok({ newPlanId: 'plan-2', parentPlanId: 'plan-1', itemsTotal: 1 }),
    );

    const onRetryCreated = vi.fn();
    renderOverlay({ onRetryCreated });

    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    fireEvent.click(approveBtn);

    const retryBtn = await screen.findByTestId('plan-review-retry');
    expect(screen.getByText('1 item failed')).toBeInTheDocument();

    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(mockPlansRetry).toHaveBeenCalledWith('plan-1', 'failed'),
    );
    await waitFor(() => expect(onRetryCreated).toHaveBeenCalledWith('plan-2'));
  });

  it('shows the catalog message (not "[object Object]") when retry rejects with a ContractError', async () => {
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    mockApplyPlan.mockImplementation(
      (args: { id: string; onEvent?: (e: OperationEvent) => void }) => {
        const mk = (
          sequence: number,
          eventType: OperationEvent['eventType'],
          payload: unknown,
        ): OperationEvent => ({
          contractVersion: '1.0.0',
          operationId: 'op-1',
          eventType,
          sequence,
          payload,
        });
        args.onEvent?.(mk(0, 'item_started', { itemsTotal: 2 }));
        args.onEvent?.(mk(1, 'item_applied', {}));
        args.onEvent?.(mk(2, 'item_failed', {}));
        args.onEvent?.(mk(3, 'failed', {}));
        return Promise.resolve({
          planId: args.id,
          runId: 'op-1',
          newState: 'partially_applied',
        });
      },
    );
    // `plans.retry` rejects with a ContractError — the real shape a Tauri
    // command failure takes on the wire (not a native Error).
    mockPlansRetry.mockRejectedValue({
      code: 'no.items.to.retry',
      message: 'no failed/skipped items on plan plan-1',
    });

    renderOverlay();

    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    fireEvent.click(approveBtn);

    const retryBtn = await screen.findByTestId('plan-review-retry');
    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(mockPlansRetry).toHaveBeenCalledWith('plan-1', 'failed'),
    );
    expect(
      await screen.findByText('There are no items to retry.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    expect(screen.queryByText('no.items.to.retry')).not.toBeInTheDocument();
  });

  it('shows a paused badge and Resume affordance on a pause condition, and calls plan.resume (R-Pause-1, T048-T050)', async () => {
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    mockApplyPlan.mockImplementation(
      (args: { id: string; onEvent?: (e: OperationEvent) => void }) => {
        const mk = (
          sequence: number,
          eventType: OperationEvent['eventType'],
          payload: unknown,
        ): OperationEvent => ({
          contractVersion: '1.0.0',
          operationId: 'op-1',
          eventType,
          sequence,
          payload,
        });
        args.onEvent?.(
          mk(0, 'item_started', { itemsTotal: 2, runId: 'run-1' }),
        );
        args.onEvent?.(mk(1, 'item_applied', {}));
        args.onEvent?.(
          mk(2, 'warning', {
            runId: 'run-1',
            pauseReason: 'item.stale',
            planId: args.id,
          }),
        );
        // No terminal event — a paused run stops streaming until resumed/cancelled.
        return Promise.resolve({
          planId: args.id,
          runId: 'run-1',
          newState: 'applying',
        });
      },
    );
    mockPlansResume.mockResolvedValue(
      ok({
        planId: 'plan-1',
        runId: 'run-1',
        resumedAt: '2026-07-09T00:00:00Z',
      }),
    );

    renderOverlay();
    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    fireEvent.click(approveBtn);

    expect(
      await screen.findByTestId('plan-review-paused-badge'),
    ).toHaveTextContent('Paused — item.stale');

    fireEvent.click(screen.getByTestId('plan-review-resume'));
    await waitFor(() =>
      expect(mockPlansResume).toHaveBeenCalledWith('plan-1', 'run-1'),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('plan-review-paused-badge'),
      ).not.toBeInTheDocument(),
    );

    // Regression: resume_plan doesn't re-spawn the executor (#575), so no
    // further events ever arrive on this channel. The UI must not render as
    // active progress (no "Applying X of Y…", no infinite-busy trap) and
    // must keep an escape affordance available instead.
    expect(
      await screen.findByTestId('plan-review-resume-stalled-badge'),
    ).toHaveTextContent(/not restarted yet/i);
    expect(screen.queryByText(/Applying \d+ of \d+/)).not.toBeInTheDocument();
    expect(screen.getByText('Discard plan')).not.toBeDisabled();
    expect(screen.getByTestId('plan-review-approve-apply')).not.toBeDisabled();
  });

  it('cannot approve a plan with zero items (FR-014)', async () => {
    mockPlansGet.mockResolvedValue(
      ok(plan({ items: [], itemsTotal: 0, itemsPending: 0 })),
    );
    mockProtectionCheck.mockResolvedValue(
      ok(
        protectionCheck({
          hasProtectedItems: false,
          protectedItems: [],
          nonBlockingSummary: { normalCount: 0, unprotectedCount: 0 },
        }),
      ),
    );
    renderOverlay();
    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    // Gate reports ready (no protected items) but the empty plan still blocks.
    await waitFor(() =>
      expect(screen.getByText(/No protected items/)).toBeInTheDocument(),
    );
    expect(approveBtn).toBeDisabled();
  });

  it('keeps Approve & apply disabled for a delete item until destructive-confirm succeeds (issue #741)', async () => {
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    mockPlansGet.mockResolvedValue(
      ok(
        plan({
          items: [item({ action: 'delete', to: '' })],
        }),
      ),
    );
    renderOverlay();

    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    const confirmBox = await screen.findByTestId(
      'plan-review-confirm-destructive',
    );
    // Protection gate is already satisfied (no protected items), but the
    // destructive-confirm checkbox is unchecked — Approve & apply stays
    // blocked until it is confirmed.
    await waitFor(() => expect(approveBtn).toBeDisabled());
    expect(confirmBox).not.toBeChecked();

    fireEvent.click(confirmBox);
    await waitFor(() =>
      expect(mockPlansConfirmDestructive).toHaveBeenCalledWith('plan-1'),
    );
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
  });

  it('offers Cancel apply during a running apply and calls plan.cancel (US3/FR-009, issue #743)', async () => {
    mockProtectionCheck.mockResolvedValue(
      ok(protectionCheck({ hasProtectedItems: false, protectedItems: [] })),
    );
    // Never emits a terminal event — the run stays "running" so Cancel stays
    // available (mirrors the pause test's no-terminal-event pattern above).
    mockApplyPlan.mockImplementation(
      (args: { id: string; onEvent?: (e: OperationEvent) => void }) => {
        args.onEvent?.({
          contractVersion: '1.0.0',
          operationId: 'op-1',
          eventType: 'item_started',
          sequence: 0,
          payload: { itemsTotal: 2, runId: 'run-1' },
        });
        return new Promise(() => {
          /* never resolves within the test — run stays live */
        });
      },
    );

    renderOverlay();
    const approveBtn = await screen.findByTestId('plan-review-approve-apply');
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    fireEvent.click(approveBtn);

    const cancelBtn = await screen.findByTestId('plan-review-cancel-run');
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(mockPlansCancel).toHaveBeenCalledWith('plan-1'));
  });
});
