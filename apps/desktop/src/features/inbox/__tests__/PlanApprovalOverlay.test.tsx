/// <reference types="@testing-library/jest-dom" />
/**
 * PlanApprovalOverlay tests — spec 043 Stage B.
 *
 * Verifies:
 * 1. When openPlans.length > 0 the "Review plans (N)" trigger button appears.
 * 2. Clicking the trigger opens the overlay (Dialog title visible).
 * 3. PlanPanel is rendered inside the overlay (plan group visible).
 * 4. Apply-all / apply-selected / cancel callbacks fire through the overlay.
 * 5. Rail shows when > 1 plan; clicking a rail item narrows the visible plan.
 * 6. Overlay closes when onClose is fired (Esc / ✕).
 * 7. When plans.length drops to 0 (all applied) the overlay auto-closes.
 *
 * The overlay uses @base-ui-components/react/dialog which provides a focus
 * trap + Portal. In jsdom tests the Portal renders into document.body so
 * queries still work.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanApprovalOverlay } from '../PlanApprovalOverlay';
import type { PlanApprovalOverlayProps } from '../PlanApprovalOverlay';
import type { InboxOpenPlan, InboxPlanAction } from '../store';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<InboxPlanAction> = {}): InboxPlanAction {
  return {
    index: 0,
    action: 'move',
    fromPath: '/root/lights/img001.fits',
    toPath: '/dest/lights/img001.fits',
    destinationPreview: '/dest/lights/img001.fits',
    requiresDestructiveConfirm: false,
    ...overrides,
  };
}

function makePlan(overrides: Partial<InboxOpenPlan> = {}): InboxOpenPlan {
  return {
    inboxItemId: 'item-1',
    itemName: '2026-06-01/NGC7000',
    planId: 'plan-1',
    state: 'open',
    stale: false,
    actions: [makeAction()],
    ...overrides,
  };
}

type Props = PlanApprovalOverlayProps;

function renderOverlay(props: Partial<Props> & { plans: InboxOpenPlan[] }) {
  const defaults: Props = {
    open: true,
    onClose: vi.fn(),
    totalActions: props.plans.reduce((n, p) => n + p.actions.length, 0),
    destructiveDestination: 'archive',
    onDestructiveDestinationChange: vi.fn(),
    onApplySelected: vi.fn(),
    onApplyAll: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  };
  return render(<PlanApprovalOverlay {...defaults} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanApprovalOverlay', () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  let onApplyAll: ReturnType<typeof vi.fn<() => void>>;
  let onApplySelected: ReturnType<typeof vi.fn<(ids: string[]) => void>>;
  let onCancel: ReturnType<typeof vi.fn<(id: string) => void>>;

  beforeEach(() => {
    onClose = vi.fn<() => void>();
    onApplyAll = vi.fn<() => void>();
    onApplySelected = vi.fn<(ids: string[]) => void>();
    onCancel = vi.fn<(id: string) => void>();
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  it('renders the Dialog title when open=true', () => {
    renderOverlay({ plans: [makePlan()], open: true, onClose });
    expect(screen.getByText('Review plans')).toBeInTheDocument();
  });

  it('does not render popup content when open=false', () => {
    renderOverlay({ plans: [makePlan()], open: false, onClose });
    expect(screen.queryByText('Review plans')).toBeNull();
  });

  it('shows the plan group inside the overlay', () => {
    renderOverlay({
      plans: [makePlan({ inboxItemId: 'a', itemName: 'Night-A' })],
      open: true,
      onClose,
    });
    expect(screen.getByTestId('plan-group-a')).toBeInTheDocument();
    expect(screen.getByText('Night-A')).toBeInTheDocument();
  });

  // ── Callbacks ──────────────────────────────────────────────────────────────

  it('fires onApplyAll when Apply all is clicked inside the overlay', () => {
    renderOverlay({ plans: [makePlan()], open: true, onApplyAll });
    fireEvent.click(screen.getByTestId('plan-apply-all'));
    expect(onApplyAll).toHaveBeenCalledOnce();
  });

  it('fires onApplySelected with checked ids when Apply selected is clicked', () => {
    renderOverlay({
      plans: [makePlan({ inboxItemId: 'x' })],
      open: true,
      onApplySelected,
    });
    fireEvent.click(screen.getByTestId('plan-group-check-x'));
    fireEvent.click(screen.getByTestId('plan-apply-selected'));
    expect(onApplySelected).toHaveBeenCalledWith(['x']);
  });

  it('fires onCancel with the plan id when Discard is clicked', () => {
    renderOverlay({
      plans: [makePlan({ inboxItemId: 'zz' })],
      open: true,
      onCancel,
    });
    fireEvent.click(screen.getByTestId('plan-cancel-zz'));
    expect(onCancel).toHaveBeenCalledWith('zz');
  });

  it('calls onClose when the ✕ button is clicked', () => {
    renderOverlay({ plans: [makePlan()], open: true, onClose });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── All plans render together (no rail) ─────────────────────────────────────

  it('renders every open plan group together (no plan-switcher rail)', () => {
    renderOverlay({
      plans: [
        makePlan({ inboxItemId: 'a', itemName: 'Night-A' }),
        makePlan({ inboxItemId: 'b', itemName: 'Night-B' }),
      ],
      open: true,
      onClose,
    });
    // Both groups are visible at once — the overlay no longer narrows to one.
    expect(screen.getByTestId('plan-group-a')).toBeInTheDocument();
    expect(screen.getByTestId('plan-group-b')).toBeInTheDocument();
    // No rail navigation element.
    expect(screen.queryByRole('navigation', { name: /plans/i })).toBeNull();
  });

  // ── Auto-close ─────────────────────────────────────────────────────────────

  it('calls onClose when plans become empty while overlay is open', () => {
    const { rerender } = renderOverlay({
      plans: [makePlan()],
      open: true,
      onClose,
    });
    act(() => {
      rerender(
        <PlanApprovalOverlay
          open={true}
          onClose={onClose}
          plans={[]}
          totalActions={0}
          destructiveDestination="archive"
          onDestructiveDestinationChange={vi.fn()}
          onApplySelected={vi.fn()}
          onApplyAll={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
