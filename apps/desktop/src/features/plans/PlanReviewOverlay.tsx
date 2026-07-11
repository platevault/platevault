/**
 * PlanReviewOverlay — shared, parameterised focused overlay for reviewing and
 * applying ONE generated plan (spec 017 review surface; first consumer is the
 * cleanup flow, WP-E).
 *
 * Plan approval is a focused overlay per the product decisions: the overlay
 * loads the plan via `plans.get`, renders every proposed item (source path,
 * action, protection — FR-003/SC-001), gates approval behind the spec-016
 * {@link PlanProtectionGate} (protected items require explicit
 * acknowledgement), then drives the single review → approved → applying edge:
 * `plans.approve` issues the approval token and {@link usePlanApplyProgress}
 * streams the apply run with live per-item progress (D17 progress UI, absorbed
 * from spec 025).
 *
 * Reuse contract (user mandate — one parameterised component, never
 * per-feature clones): any flow that generates a plan and reviews it inline
 * renders THIS overlay with its `planId`. Feature-specific bulk surfaces (the
 * inbox multi-plan PlanApprovalOverlay) predate it and remain separate.
 */

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components';
import { Btn, Pill, Banner, Table } from '@/ui';
import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { errMessage } from '@/lib/errors';
import { queryKeys } from '@/data/queryKeys';
import { formatBytes } from '@/lib/format';
import { addToast } from '@/shared/toast';
import { PlanProtectionGate } from './PlanProtectionGate';
import { usePlanApplyProgress } from './usePlanApplyProgress';
import type { PlanDetail_Serialize, PlanItemDetail_Serialize } from '@/bindings/index';

// ── Props ────────────────────────────────────────────────────────────────────

export interface PlanReviewOverlayProps {
  /** Plan to review; the overlay is inert while null. */
  planId: string | null;
  open: boolean;
  onClose: () => void;
  /** Overlay title; defaults to the generic review title. */
  title?: string;
  /** Called once when the apply run reaches the `completed` terminal state. */
  onApplied?: () => void;
  /** Called after the plan is discarded. */
  onDiscarded?: () => void;
  /**
   * Called after `plans.retry` creates a new plan from this one's failed
   * items (US5, T037). The caller decides how to surface it — the shared
   * pattern is to re-point this same overlay's `planId` at the new plan.
   */
  onRetryCreated?: (newPlanId: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function actionPillVariant(action: PlanItemDetail_Serialize['action']) {
  return action === 'delete' ? ('danger' as const) : ('info' as const);
}

function destinationLabel(plan: PlanDetail_Serialize): string {
  // DTO enum is `archive | os_trash` (the DB canonical vocabulary is
  // `archive | trash`; plans.get maps trash → os_trash).
  return plan.destructiveDestination === 'os_trash'
    ? m.plans_dest_trash()
    : m.plans_dest_archive();
}

// ── Component ────────────────────────────────────────────────────────────────

export function PlanReviewOverlay({
  planId,
  open,
  onClose,
  title,
  onApplied,
  onDiscarded,
  onRetryCreated,
}: PlanReviewOverlayProps) {
  const queryClient = useQueryClient();

  const {
    data: plan,
    isFetching: planLoading,
    error: planError,
  } = useQuery({
    queryKey: queryKeys.plans.detail(planId ?? ''),
    queryFn: async () => unwrap(await commands.plansGet(planId as string)),
    enabled: open && planId !== null,
  });

  // Protection gate readiness (spec 016 US3): the gate signals true when every
  // protected item is acknowledged — or immediately when none are protected.
  const [gateReady, setGateReady] = useState(false);

  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // The apply run's final `PlanState` (US5/T037): distinct from
  // `progress.terminal`, which only tracks the event-stream outcome and
  // cannot tell `partially_applied` apart from `applied`. Retry needs the
  // real terminal plan state to decide whether to offer "Generate retry plan".
  const [finalState, setFinalState] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const { progress, run: runApply, resume: resumeApply, reset: resetApply } = usePlanApplyProgress();

  const busy = approving || discarding || retrying || progress.running;
  const applied = finalState === 'applied';
  const retryable = finalState === 'failed' || finalState === 'partially_applied';

  const invalidatePlan = useCallback(() => {
    if (planId !== null) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans.detail(planId) });
    }
  }, [planId, queryClient]);

  // The overlay must not silently disappear mid-run (constitution II — the
  // apply outcome stays on screen); ignore close requests while busy.
  const handleClose = useCallback(() => {
    if (busy) return;
    resetApply();
    setApplyError(null);
    setGateReady(false);
    setFinalState(null);
    onClose();
  }, [busy, onClose, resetApply]);

  const handleApproveAndApply = useCallback(async () => {
    if (planId === null || busy) return;
    setApplyError(null);
    setApproving(true);
    let token: string;
    try {
      token = unwrap(await commands.plansApprove(planId)).approvalToken;
    } catch (e) {
      setApproving(false);
      setApplyError(errMessage(e));
      return;
    }
    setApproving(false);

    const response = await runApply({ id: planId, approvalToken: token });
    invalidatePlan();
    setFinalState(response?.newState ?? 'failed');
    if (response !== null && response.newState === 'applied') {
      addToast({ message: m.plans_review_apply_success_toast(), variant: 'success' });
      onApplied?.();
    } else {
      setApplyError(m.plans_review_apply_failed());
    }
  }, [planId, busy, runApply, invalidatePlan, onApplied]);

  const handleDiscard = useCallback(async () => {
    if (planId === null || busy) return;
    setDiscarding(true);
    try {
      unwrap(await commands.plansDiscard(planId));
      addToast({ message: m.plans_review_discarded_toast(), variant: 'info' });
      onDiscarded?.();
      resetApply();
      setGateReady(false);
      setFinalState(null);
      onClose();
    } catch (e) {
      setApplyError(errMessage(e));
    } finally {
      setDiscarding(false);
    }
  }, [planId, busy, onDiscarded, onClose, resetApply]);

  /** Resume a paused apply run (R-Pause-1, T048-T050). Minimal, honest
   * surface: reflects the real `plan.resume` call outcome, nothing simulated. */
  const handleResume = useCallback(async () => {
    if (planId === null || resuming) return;
    setResuming(true);
    setApplyError(null);
    const ok = await resumeApply(planId);
    setResuming(false);
    if (!ok) setApplyError(m.plans_review_resume_failed());
  }, [planId, resuming, resumeApply]);

  /** Generate a retry plan from this plan's failed items (US5, T037) — the
   * plan-review flow's only entry point since there is no standalone Plans
   * list to reopen a terminal plan from (T015/T016 OBSOLETE-BY-DESIGN). */
  const handleGenerateRetryPlan = useCallback(async () => {
    if (planId === null || busy) return;
    setRetrying(true);
    setApplyError(null);
    try {
      const res = unwrap(await commands.plansRetry(planId, 'failed'));
      addToast({ message: m.plans_review_retry_created_toast(), variant: 'info' });
      resetApply();
      setGateReady(false);
      setFinalState(null);
      onRetryCreated?.(res.newPlanId);
    } catch (e) {
      // `errMessage` resolves a `plans.retry` `ContractError` (e.g. the
      // backend's `NoItemsToRetry`/`no.items.to.retry` code) through the
      // exhaustive spec-046 catalog (`err_no_items_to_retry`) rather than a
      // second, plan-review-specific translation of the same case.
      setApplyError(errMessage(e));
    } finally {
      setRetrying(false);
    }
  }, [planId, busy, resetApply, onRetryCreated]);

  // ── Items table ────────────────────────────────────────────────────────────

  const columns = [
    { key: 'name', label: m.plans_review_col_item() },
    { key: 'action', label: m.plans_review_col_action() },
    { key: 'from', label: m.plans_review_col_from() },
    { key: 'to', label: m.plans_review_col_to() },
    { key: 'protection', label: m.plans_review_col_protection() },
  ];

  // FR-003: every item shows its destination path or, for `delete`-action
  // items (no destination — the source is removed in place), a deletion cue.
  const rows = (plan?.items ?? []).map((item) => ({
    _testid: `plan-review-item-${item.index}`,
    _rowClassName:
      item.protection === 'protected' ? 'alm-plan-review__row--protected' : undefined,
    name: item.name,
    action: <Pill variant={actionPillVariant(item.action)}>{item.action}</Pill>,
    from: <span className="alm-mono">{item.from}</span>,
    to:
      item.action === 'delete' ? (
        <span className="alm-cell--muted">{m.plans_review_deletion_target()}</span>
      ) : (
        <span className="alm-mono">{item.to}</span>
      ),
    protection:
      item.protection === 'protected' ? (
        <Pill variant="warn">{m.settings_cleanup_protection_protected()}</Pill>
      ) : (
        <Pill variant="ghost">{m.settings_cleanup_protection_normal()}</Pill>
      ),
  }));

  // ── Footer ────────────────────────────────────────────────────────────────

  const footer = applied ? (
    <Btn onClick={handleClose}>{m.common_close()}</Btn>
  ) : retryable ? (
    <>
      <Btn variant="ghost" onClick={handleClose} disabled={busy}>
        {m.common_close()}
      </Btn>
      <Btn
        variant="danger"
        onClick={() => void handleGenerateRetryPlan()}
        disabled={busy}
        data-testid="plan-review-retry"
      >
        {retrying ? m.plans_review_retrying() : m.plans_review_retry_btn()}
      </Btn>
    </>
  ) : (
    <>
      <Btn variant="ghost" onClick={() => void handleDiscard()} disabled={busy}>
        {m.plans_review_discard_btn()}
      </Btn>
      <Btn
        variant="danger"
        onClick={() => void handleApproveAndApply()}
        disabled={busy || !gateReady || plan == null || plan.itemsTotal === 0}
        data-testid="plan-review-approve-apply"
      >
        {approving
          ? m.plans_review_approving()
          : progress.running
            ? m.common_applying()
            : m.plans_review_approve_apply_btn()}
      </Btn>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title ?? m.plans_review_overlay_title()}
      subtitle={
        plan
          ? `${m.plans_review_item_count({ count: plan.itemsTotal })} · ${destinationLabel(plan)}`
          : undefined
      }
      size="lg"
      ariaLabel={title ?? m.plans_review_overlay_title()}
      closeOnBackdrop={!busy}
      footer={footer}
      // The item table owns its own scroll region (below); the body itself
      // must not also scroll, or the item list would double-scroll.
      bodyClassName="alm-modal__body--fill"
      data-testid="plan-review-overlay"
    >
      {planLoading && plan == null ? (
        <div className="alm-plan-review__status">{m.common_loading()}</div>
      ) : planError || plan == null ? (
        <Banner variant="danger">{m.plans_review_load_error()}</Banner>
      ) : (
        <div className="alm-plan-review">
          {/* Summary line: no mutation before approval (FR-002 teaching copy). */}
          <Banner variant="info" role="status">
            {m.plans_review_no_mutation_note()}
            {plan.totalBytesRequired > 0 &&
              ` ${m.plans_review_bytes_required({ size: formatBytes(plan.totalBytesRequired) })}`}
          </Banner>

          {/* Every proposed item, reviewable before approval (SC-001).
              Virtualized (shared `.alm-listtable` pattern, spec 017 T050):
              plans can carry hundreds of items, so the table owns its own
              bounded scroll region instead of rendering every row — the
              summary/gate/progress/footer above and below stay pinned. */}
          <div className="alm-listtable">
            <Table
              columns={columns}
              rows={rows}
              virtualized
              scrollClassName="alm-listtable__scroll"
              data-testid="plan-review-items"
            />
          </div>

          {/* Spec-016 protection gate: protected items require acknowledgement
              before Approve & apply unlocks. */}
          <PlanProtectionGate planId={plan.id} onAcknowledgedChange={setGateReady} />

          {/* Live apply progress (D17 — spec 025 progress UI, absorbed here). */}
          {(progress.running || progress.terminal !== null || progress.paused) && (
            <div
              className="alm-plan-review__progress"
              role="status"
              aria-live="polite"
              data-testid="plan-review-progress"
            >
              {progress.running &&
                m.plans_review_progress_running({
                  applied: progress.applied,
                  total: progress.total ?? plan.itemsTotal,
                })}
              {applied && (
                <Pill variant="ok">
                  {m.plans_review_progress_done({ count: progress.applied })}
                </Pill>
              )}
              {progress.terminal === 'failed' && (
                <Pill variant="danger">{m.plans_review_apply_failed()}</Pill>
              )}
              {progress.failed > 0 &&
                ` ${m.plans_review_progress_failed({ count: progress.failed })}`}
              {progress.paused && (
                <>
                  {' '}
                  <Pill variant="warn" data-testid="plan-review-paused-badge">
                    {m.plans_review_paused_badge({
                      reason: progress.pauseReason ?? m.common_unknown(),
                    })}
                  </Pill>{' '}
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleResume()}
                    disabled={resuming}
                    data-testid="plan-review-resume"
                  >
                    {resuming ? m.plans_review_resuming() : m.plans_review_resume_btn()}
                  </Btn>
                </>
              )}
            </div>
          )}

          {applyError !== null && <Banner variant="danger">{applyError}</Banner>}
        </div>
      )}
    </Modal>
  );
}
