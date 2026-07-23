// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PlanApprovalOverlay — focused overlay for reviewing and applying open inbox
 * plans. A thin wrapper over the shared {@link Modal}: it owns only the
 * inbox-specific content (the {@link PlanPanel}) and the auto-close behaviour.
 *
 * Opens from the top-bar "Review plans (N)" trigger. All open plans render in a
 * single scroll inside the modal body (no plan-switcher rail) — each plan is a
 * collapsible group with a per-file action table. Applying the last plan
 * auto-closes the overlay.
 *
 * Issue #767: the Modal's `open` is DERIVED as `open && hasContent` rather
 * than passed straight through. The previous version relied solely on an
 * effect that watched `plans.length` and asked the CALLER to flip its own
 * `open` state closed AFTER the render that first shows the emptied body — a
 * two-render sequence (one render shows the dialog still open over an empty
 * body, a later render finally closes it). Anything that stalls between those
 * two renders (a deferred effect, a caller re-render that doesn't land in
 * time) leaves the dialog stuck open with nothing left to dismiss it — Escape
 * / ✕ / backdrop only re-invoke the very `onClose` that already fired.
 * Deriving `visible` collapses both signals into the SAME render: the dialog
 * can never be visually open while it has nothing to show. The effect below
 * still calls `onClose` so the caller's own `open` flag resets — otherwise a
 * later plan re-populating `plans` while the caller's stale `open` is still
 * true would silently resurrect the overlay without a fresh trigger click.
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
  pendingRootPick = null,
  ...rest
}: PlanApprovalOverlayProps) {
  // A pending destination-root pick can leave `plans` empty (the plan hasn't
  // been generated yet) while the overlay still has real content — the
  // picker itself — to show, so it counts as content too.
  const hasContent = plans.length > 0 || pendingRootPick != null;
  const visible = open && hasContent;

  // Reset the caller's `open` flag once content disappears (see file header).
  useEffect(() => {
    if (open && !hasContent) {
      onClose();
    }
  }, [open, hasContent, onClose]);

  const subtitle =
    plans.length > 0
      ? `${m.plan_count_label({ count: plans.length })} · ${m.action_count_label({ count: totalActions })}`
      : undefined;

  return (
    <Modal
      open={visible}
      onClose={onClose}
      title={m.inbox_review_plans_title()}
      subtitle={subtitle}
      size="xl"
      ariaLabel={m.inbox_review_plans_title()}
      data-testid="plan-approval-overlay"
    >
      <PlanPanel
        plans={plans}
        totalActions={totalActions}
        pendingRootPick={pendingRootPick}
        {...rest}
      />
    </Modal>
  );
}
