/**
 * PlanApprovalOverlay — full-screen focused overlay for reviewing and applying
 * open inbox plans.
 *
 * spec 043 Stage B: replaces the right-side-panel plan surface with a Dialog
 * that opens when the user clicks "Review plans (N)" in the InboxPage top bar.
 * Highest-stakes surface (irreversible filesystem moves) → focused overlay with
 * a dimmed/blurred backdrop, Dialog focus-trap, and Escape-to-close.
 *
 * Layout:
 *  - If MORE THAN ONE open plan: a left rail listing plans for quick switching.
 *  - Main area: the existing PlanPanel rendered for the selected plan.
 *  - Header with title "Review plans" and a ✕ close button.
 *
 * The PlanPanel is reused as-is — this component is only a new container.
 * Applying all plans that empties the open-plan set auto-closes the overlay.
 */

import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { PlanPanel } from './PlanPanel';
import type { PlanPanelProps } from './PlanPanel';
import type { InboxOpenPlan } from './store';

export interface PlanApprovalOverlayProps
  extends Omit<PlanPanelProps, 'plans' | 'totalActions'> {
  open: boolean;
  onClose: () => void;
  plans: InboxOpenPlan[];
  totalActions: number;
}

export function PlanApprovalOverlay({
  open,
  onClose,
  plans,
  totalActions,
  onApplySelected,
  onApplyAll,
  onCancel,
  ...rest
}: PlanApprovalOverlayProps) {
  // When > 1 plan exists, the user can select a single plan to view in the main
  // area. null means "show all plans" in PlanPanel (PlanPanel handles multi-plan
  // rendering natively, so we pass all plans when no single is selected).
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const showRail = plans.length > 1;

  // When the plan list changes (e.g. after apply), keep selectedPlanId in sync.
  // If the selected plan was just applied/cancelled, fall back to null (all).
  useEffect(() => {
    if (selectedPlanId && !plans.find((p) => p.inboxItemId === selectedPlanId)) {
      setSelectedPlanId(null);
    }
  }, [plans, selectedPlanId]);

  // Auto-close when the last plan is applied/cancelled.
  useEffect(() => {
    if (open && plans.length === 0) {
      onClose();
    }
  }, [open, plans.length, onClose]);

  // The plans passed to PlanPanel: when a rail item is selected, show just that
  // plan; otherwise show all (PlanPanel renders all of them in one scroll).
  const visiblePlans =
    selectedPlanId != null
      ? plans.filter((p) => p.inboxItemId === selectedPlanId)
      : plans;

  const visibleTotalActions = visiblePlans.reduce(
    (n, p) => n + p.actions.length,
    0,
  );

  const handleApplySelected = useCallback(
    (ids: string[]) => {
      onApplySelected(ids);
    },
    [onApplySelected],
  );

  const handleApplyAll = useCallback(() => {
    onApplyAll();
  }, [onApplyAll]);

  const handleCancel = useCallback(
    (id: string) => {
      onCancel(id);
    },
    [onCancel],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen, eventDetails) => {
        if (isOpen) return;
        // Ignore `outside-press`: base-ui treats a click on an inner control
        // that re-renders/unmounts (the plan checkboxes, the file foldout) as an
        // outside press because the original target is gone from the DOM by
        // pointer-up, which would wrongly close the overlay on every interaction.
        // Genuine outside dismissal is handled by the Backdrop onClick below;
        // Escape ('escape-key') and the ✕ ('close-press') still close here.
        if (eventDetails?.reason === 'outside-press') return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className="alm-plan-overlay__backdrop"
          // Explicit backdrop dismissal — fires only for true outside clicks
          // (clicks inside the popup never reach this sibling element).
          onClick={onClose}
        />
        <Dialog.Popup
          className="alm-plan-overlay"
          aria-label="Review plans"
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="alm-plan-overlay__header">
            <Dialog.Title className="alm-plan-overlay__title">
              Review plans
            </Dialog.Title>
            {plans.length > 0 && (
              <span className="alm-plan-overlay__subtitle">
                {plans.length} plan{plans.length !== 1 ? 's' : ''} ·{' '}
                {totalActions} action{totalActions !== 1 ? 's' : ''}
              </span>
            )}
            <Dialog.Close
              className="alm-plan-overlay__close"
              aria-label="Close plan review"
            >
              ✕
            </Dialog.Close>
          </div>

          {/* ── Body: optional rail + plan panel ───────────────────────────── */}
          <div className="alm-plan-overlay__body">
            {showRail && (
              <nav
                className="alm-plan-overlay__rail"
                aria-label="Plans"
              >
                <button
                  type="button"
                  className={
                    selectedPlanId === null
                      ? 'alm-plan-overlay__rail-item alm-plan-overlay__rail-item--active'
                      : 'alm-plan-overlay__rail-item'
                  }
                  onClick={() => setSelectedPlanId(null)}
                  aria-current={selectedPlanId === null ? 'true' : undefined}
                  data-testid="plan-overlay-rail-all"
                >
                  <span className="alm-plan-overlay__rail-label">
                    All plans
                  </span>
                  <span className="alm-plan-overlay__rail-count">
                    {plans.length}
                  </span>
                </button>
                {plans.map((p) => (
                  <button
                    key={p.inboxItemId}
                    type="button"
                    className={
                      selectedPlanId === p.inboxItemId
                        ? 'alm-plan-overlay__rail-item alm-plan-overlay__rail-item--active'
                        : 'alm-plan-overlay__rail-item'
                    }
                    onClick={() => setSelectedPlanId(p.inboxItemId)}
                    aria-current={
                      selectedPlanId === p.inboxItemId ? 'true' : undefined
                    }
                    data-testid={`plan-overlay-rail-${p.inboxItemId}`}
                  >
                    <span
                      className="alm-plan-overlay__rail-label"
                      title={p.itemName}
                    >
                      {p.itemName}
                    </span>
                    <span className="alm-plan-overlay__rail-count">
                      {p.actions.length}
                    </span>
                  </button>
                ))}
              </nav>
            )}

            {/* Main plan review area — reuses PlanPanel unchanged. */}
            <div className="alm-plan-overlay__main">
              <PlanPanel
                plans={visiblePlans}
                totalActions={visibleTotalActions}
                onApplySelected={handleApplySelected}
                onApplyAll={handleApplyAll}
                onCancel={handleCancel}
                {...rest}
              />
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
