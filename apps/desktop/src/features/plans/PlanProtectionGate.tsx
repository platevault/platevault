// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 016 US3 — plan protection gating UI (T024).
//
// Renders the protection-affected items for a plan before execution proceeds.
// Protected items require explicit acknowledgement before the plan can run.
//
// Usage: render this component in the plan review/approve flow. The parent
// is responsible for checking `allAcknowledged` and disabling the Apply button
// until it is true.

import { useEffect, useState, useCallback } from 'react';
import { Pill, Btn } from '@/ui';
import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  ProtectedPlanItem,
  PlanProtectionCheckResponse,
} from '@/bindings/index';

interface PlanProtectionGateProps {
  planId: string;
  /** Called whenever the acknowledged set changes. */
  onAcknowledgedChange?: (allAcknowledged: boolean) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * #807: previously suffixed a rewritten action with "(rewritten by
 * protection policy)", implying the SOFTER action (e.g. delete → archive)
 * would actually run. It never does: the apply-time protection gate
 * (`fs/executor/run.rs`) unconditionally refuses ANY mutating action —
 * rewritten or not — on a protected item; only NoOp/Catalogue pass. Showing
 * the rewrite is still useful context (what the plan WOULD have done absent
 * protection), but the wording must not imply it will be applied.
 */
function actionLabel(item: ProtectedPlanItem): string {
  if (item.rewrittenAction) {
    return `${item.originalAction} → ${item.rewrittenAction}`;
  }
  return item.originalAction;
}

export function PlanProtectionGate({
  planId,
  onAcknowledgedChange,
}: PlanProtectionGateProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [checkResult, setCheckResult] =
    useState<PlanProtectionCheckResponse | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [ackErrors, setAckErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoadState('loading');
    commands
      .planProtectionCheckCmd(planId)
      .then(unwrap)
      .then((resp) => {
        setCheckResult(resp);
        setLoadState('ready');
        // If no protected items, immediately signal all-acknowledged.
        if (!resp.hasProtectedItems) {
          onAcknowledgedChange?.(true);
        }
      })
      .catch(() => {
        setLoadState('error');
      });
  }, [planId, onAcknowledgedChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAcknowledge = useCallback(
    async (item: ProtectedPlanItem) => {
      try {
        unwrap(
          await commands.protectionPlanAcknowledged(
            planId,
            item.itemId,
            item.sourceId ?? null,
            item.level,
            item.reason,
          ),
        );
        setAcknowledged((prev) => {
          const next = new Set(prev);
          next.add(item.itemId);
          const total = checkResult?.protectedItems.length ?? 0;
          onAcknowledgedChange?.(next.size >= total);
          return next;
        });
      } catch (err: unknown) {
        setAckErrors((prev) => ({
          ...prev,
          [item.itemId]: typeof err === 'string' ? err : 'Acknowledge failed',
        }));
      }
    },
    [planId, checkResult, onAcknowledgedChange],
  );

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="pv-plan-gate__status">{m.plans_gate_checking()}</div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="pv-plan-gate__status">{m.plans_gate_load_error()}</div>
    );
  }

  if (!checkResult?.hasProtectedItems) {
    const { normalCount, unprotectedCount } =
      checkResult?.nonBlockingSummary ?? {
        normalCount: 0,
        unprotectedCount: 0,
      };
    return (
      <div className="pv-plan-gate__status">
        {m.plans_gate_no_protected()}
        {normalCount > 0 &&
          m.plans_gate_normal_items_sentence({ count: normalCount })}
        {unprotectedCount > 0 &&
          m.plans_gate_unprotected_items_sentence({ count: unprotectedCount })}
      </div>
    );
  }

  const total = checkResult.protectedItems.length;
  const doneCount = acknowledged.size;
  const allDone = doneCount >= total;

  return (
    <div className="pv-plan-gate__root">
      <div
        className={
          'pv-plan-gate__summary-bar' +
          (allDone ? ' pv-plan-gate__summary-bar--done' : '')
        }
      >
        <Pill variant={allDone ? 'ok' : 'warn'}>
          {allDone
            ? m.plans_all_acknowledged()
            : m.plans_gate_require_ack({ done: total - doneCount, total })}
        </Pill>
        <span className="pv-plan-gate__summary-label">
          {allDone ? m.plans_may_proceed() : m.plans_review_acknowledge()}
        </span>
      </div>

      {checkResult.protectedItems.map((item) => {
        const isDone = acknowledged.has(item.itemId);
        return (
          <div
            key={item.itemId}
            className={
              'pv-plan-gate__item' + (isDone ? ' pv-plan-gate__item--done' : '')
            }
          >
            <div className="pv-plan-gate__item-header">
              <Pill variant="ok">{item.level}</Pill>
              <code className="pv-mono pv-plan-gate__item-id">
                {item.itemId}
              </code>
              {isDone && (
                <Pill variant="ok">{m.plans_gate_acknowledged()}</Pill>
              )}
            </div>

            <div className="pv-plan-gate__item-action">
              {m.plans_gate_action_label()} <strong>{actionLabel(item)}</strong>
            </div>

            {/* #807: state the truth plainly — protection is permanent, so
                this item will never be archived/moved/deleted regardless of
                the action shown above or of acknowledging below. */}
            <div className="pv-plan-gate__item-note">
              {m.plans_protected_item_note()}
            </div>

            {item.matchedCategories.length > 0 && (
              <div className="pv-plan-gate__item-categories">
                {m.plans_gate_categories_label()}{' '}
                {item.matchedCategories.join(', ')}
              </div>
            )}

            <div className="pv-plan-gate__item-reason">{item.reason}</div>

            {ackErrors[item.itemId] && (
              <div className="pv-plan-gate__item-error">
                {ackErrors[item.itemId]}
              </div>
            )}

            {!isDone && (
              <Btn size="sm" onClick={() => handleAcknowledge(item)}>
                {m.plans_gate_acknowledge_btn()}
              </Btn>
            )}
          </div>
        );
      })}

      {/* Non-blocking summary counts (FR-008) */}
      {(checkResult.nonBlockingSummary.normalCount > 0 ||
        checkResult.nonBlockingSummary.unprotectedCount > 0) && (
        <div className="pv-plan-gate__footer-summary">
          {m.plans_gate_also_in_plan()}{' '}
          {checkResult.nonBlockingSummary.normalCount > 0 &&
            m.plans_gate_normal_items({
              count: checkResult.nonBlockingSummary.normalCount,
            })}
          {checkResult.nonBlockingSummary.normalCount > 0 &&
            checkResult.nonBlockingSummary.unprotectedCount > 0 &&
            ', '}
          {checkResult.nonBlockingSummary.unprotectedCount > 0 &&
            m.plans_gate_unprotected_items({
              count: checkResult.nonBlockingSummary.unprotectedCount,
            })}{' '}
          {m.plans_no_ack_required()}
        </div>
      )}
    </div>
  );
}
