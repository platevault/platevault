// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issues #769 / #609 — per-plan Apply (live progress) must approve the plan
 * before applying it: a freshly-confirmed plan is `ready_for_review` with no
 * `approval_token`, and `plans.apply` unconditionally rejects any plan that
 * isn't `approved`.
 *
 * Covers `InboxPage.handleApplyOne`'s two paths:
 * 1. Success — plans.approve is called BEFORE the apply IPC, and its
 *    returned token is threaded into the apply call.
 * 2. Failure — when plans.approve rejects, the apply IPC must NEVER be
 *    invoked (the old bug always called apply with an empty token and let
 *    the backend reject it after the fact) and an error toast shows.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStatusProvider } from '@/app/PageStatusContext';
import type { InboxOpenPlan } from '@/bindings/index';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>{ui}</PageStatusProvider>
    </QueryClientProvider>,
  );
}

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockPlansApprove,
  mockApplyPlan,
  mockAddToast,
  mockNavigate,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockPlansApprove: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockAddToast: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    plansApprove: mockPlansApprove,
  },
}));

// usePlanApplyProgress drives `applyPlan` (features/plans/planApply.ts), which
// bridges a Tauri `Channel`; mock the wrapper directly (same seam
// PlanReviewOverlay.test.tsx uses) instead of dealing with the Channel ctor.
vi.mock('@/features/plans/planApply', () => ({
  applyPlan: mockApplyPlan,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: undefined, type: undefined }),
}));

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const openPlan: InboxOpenPlan = {
  inboxItemId: 'item-plan-001',
  itemName: 'lights/NGC7000',
  planId: 'plan-001',
  state: 'ready_for_review',
  stale: false,
  actions: [
    {
      index: 1,
      action: 'move',
      fromPath: 'lights/NGC7000/frame_001.fits',
      toPath: 'M31/light/frame_001.fits',
      destinationPreview: 'M31/light/frame_001.fits',
      requiresDestructiveConfirm: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRootsList.mockResolvedValue(ok([]));
  mockInboxList.mockResolvedValue(ok({ items: [], capped: false, limit: 500 }));
  mockInboxPlanListOpen.mockResolvedValue(
    ok({ plans: [openPlan], totalActions: 1 }),
  );
});

import { InboxPage } from '../InboxPage';

async function openOverlayAndClickApply() {
  render(<InboxPage />);
  const reviewBtn = await screen.findByTestId('inbox-review-plans-btn');
  fireEvent.click(reviewBtn);
  const applyBtn = await screen.findByTestId(
    `plan-apply-one-${openPlan.inboxItemId}`,
  );
  fireEvent.click(applyBtn);
}

describe('InboxPage.handleApplyOne — approve before apply (#769, #609)', () => {
  it('approves the plan before applying it and threads the token through', async () => {
    mockPlansApprove.mockResolvedValue(
      ok({
        planId: openPlan.planId,
        newState: 'approved',
        approvalToken: 'tok-abc',
        approvedAt: '2026-07-17T00:00:00Z',
      }),
    );
    mockApplyPlan.mockResolvedValue({
      results: [{ inboxItemId: openPlan.inboxItemId, planId: openPlan.planId }],
    });

    await openOverlayAndClickApply();

    await waitFor(() => expect(mockApplyPlan).toHaveBeenCalled());

    // approve must run BEFORE apply, and the returned token must be threaded
    // into the apply call.
    const approveOrder = mockPlansApprove.mock.invocationCallOrder[0];
    const applyOrder = mockApplyPlan.mock.invocationCallOrder[0];
    expect(approveOrder).toBeLessThan(applyOrder);
    expect(mockPlansApprove).toHaveBeenCalledWith(openPlan.planId);
    expect(mockApplyPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        id: openPlan.planId,
        approvalToken: 'tok-abc',
      }),
    );
  });

  // #871: after a completed apply, offer a direct way to reach the moved
  // items instead of leaving the user to find them manually.
  it('offers a "View in Sessions" toast action that navigates to /sessions', async () => {
    mockPlansApprove.mockResolvedValue(
      ok({
        planId: openPlan.planId,
        newState: 'approved',
        approvalToken: 'tok-abc',
        approvedAt: '2026-07-17T00:00:00Z',
      }),
    );
    mockApplyPlan.mockResolvedValue({
      results: [{ inboxItemId: openPlan.inboxItemId, planId: openPlan.planId }],
    });

    await openOverlayAndClickApply();

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'info',
          action: expect.objectContaining({ label: 'View in Sessions' }),
        }),
      ),
    );

    const call = mockAddToast.mock.calls.find(
      (c) => c[0].action?.label === 'View in Sessions',
    );
    call?.[0].action.onClick();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/sessions' });
  });

  it('never calls apply and shows an error toast when approve fails', async () => {
    mockPlansApprove.mockRejectedValue(new Error('plan.invalid_state'));

    await openOverlayAndClickApply();

    await waitFor(() => expect(mockPlansApprove).toHaveBeenCalled());
    // Give any (incorrect) apply call a chance to fire before asserting absence.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error' }),
    );
  });
});
