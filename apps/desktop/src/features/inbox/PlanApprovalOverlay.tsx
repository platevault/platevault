/**
 * PlanApprovalOverlay — focused overlay for reviewing and applying open inbox
 * plans. A thin wrapper over the shared {@link Modal}: it owns only the
 * inbox-specific content (the {@link PlanPanel}) and the auto-close behaviour.
 *
 * Opens from the top-bar "Review plans (N)" trigger. All open plans render in a
 * single scroll inside the modal body (no plan-switcher rail) — each plan is a
 * collapsible group with a per-file action table. Applying the last plan
 * auto-closes the overlay.
 */

import { useEffect } from 'react';
import { Modal } from '@/components';
import { m } from '@/lib/i18n';
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
  ...rest
}: PlanApprovalOverlayProps) {
  // Auto-close when the last plan is applied/cancelled.
  useEffect(() => {
    if (open && plans.length === 0) {
      onClose();
    }
  }, [open, plans.length, onClose]);

  const subtitle =
    plans.length > 0
      ? `${plans.length} plan${plans.length !== 1 ? 's' : ''} · ${totalActions} action${totalActions !== 1 ? 's' : ''}`
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.inbox_review_plans_title()}
      subtitle={subtitle}
      size="xl"
      ariaLabel={m.inbox_review_plans_title()}
      data-testid="plan-approval-overlay"
    >
      <PlanPanel plans={plans} totalActions={totalActions} {...rest} />
    </Modal>
  );
}
