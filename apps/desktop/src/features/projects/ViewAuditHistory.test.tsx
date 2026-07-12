/// <reference types="@testing-library/jest-dom" />
/**
 * ViewAuditHistory tests — spec 026 T019 audit-history surface.
 *
 * Covers:
 * 1. Lazy-loads on first expand only (no fetch before the <details> opens).
 * 2. Filters `plans.list`'s response client-side to this view's originPath.
 * 3. Renders each plan with type/state/counts and a "View" action that
 *    routes through `onViewPlan` (reusing the shared plan review overlay).
 * 4. Empty and error states.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPlansList } = vi.hoisted(() => ({
  mockPlansList: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    plansList: mockPlansList,
  },
}));

import { ViewAuditHistory } from './ViewAuditHistory';

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const removalPlan = {
  id: 'plan-remove-1',
  number: 1,
  title: 'Remove source view view-1',
  origin: 'prepared_view_removal',
  originPath: 'view-1',
  state: 'applied',
  createdAt: '2026-01-01T00:00:00Z',
  itemsTotal: 3,
  itemsApplied: 3,
  itemsFailed: 0,
  itemsSkipped: 0,
  itemsCancelled: 0,
  itemsPending: 0,
  totalBytesRequired: 0,
  destructiveDestination: 'archive',
  planType: 'source_view_removal',
};

const regenPlanOtherView = {
  ...removalPlan,
  id: 'plan-regen-other',
  origin: 'prepared_view_regeneration',
  originPath: 'view-other',
  state: 'failed',
  itemsApplied: 1,
  itemsFailed: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ViewAuditHistory', () => {
  it('does not fetch before the details element is expanded', () => {
    render(<ViewAuditHistory viewId="view-1" />);
    expect(mockPlansList).not.toHaveBeenCalled();
  });

  it('fetches prepared_view_removal/regeneration plans and filters to this view on expand', async () => {
    mockPlansList.mockResolvedValueOnce(
      ok({ plans: [removalPlan, regenPlanOtherView] }),
    );

    render(<ViewAuditHistory viewId="view-1" />);
    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(
        screen.getByTestId('view-history-row-plan-remove-1'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('view-history-row-plan-regen-other'),
    ).not.toBeInTheDocument();
    expect(mockPlansList).toHaveBeenCalledWith(
      null,
      ['prepared_view_removal', 'prepared_view_regeneration'],
      null,
      200,
    );
  });

  it('shows the empty state when no plans reference this view', async () => {
    mockPlansList.mockResolvedValueOnce(ok({ plans: [regenPlanOtherView] }));

    render(<ViewAuditHistory viewId="view-1" />);
    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(
        screen.getByText(/no removal or regeneration plans yet/i),
      ).toBeInTheDocument();
    });
  });

  it('calls onViewPlan with the plan id when View is clicked', async () => {
    mockPlansList.mockResolvedValueOnce(ok({ plans: [removalPlan] }));
    const onViewPlan = vi.fn();

    render(<ViewAuditHistory viewId="view-1" onViewPlan={onViewPlan} />);
    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(
        screen.getByTestId('view-history-open-plan-remove-1'),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('view-history-open-plan-remove-1'));
    expect(onViewPlan).toHaveBeenCalledWith('plan-remove-1');
  });

  it('shows an error message when the fetch fails', async () => {
    mockPlansList.mockRejectedValueOnce(new Error('boom'));

    render(<ViewAuditHistory viewId="view-1" />);
    fireEvent.click(screen.getByText('History'));

    await waitFor(() => {
      expect(screen.getByText(/failed to load history/i)).toBeInTheDocument();
    });
  });
});
