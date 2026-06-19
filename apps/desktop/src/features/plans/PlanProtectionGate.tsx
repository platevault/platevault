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
import { planProtectionCheck, protectionPlanAcknowledged } from '@/api/commands';
import type { ProtectedPlanItem, PlanProtectionCheckResponse } from '@/api/commands';

interface PlanProtectionGateProps {
  planId: string;
  /** Called whenever the acknowledged set changes. */
  onAcknowledgedChange?: (allAcknowledged: boolean) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function actionLabel(item: ProtectedPlanItem): string {
  if (item.rewrittenAction) {
    return `${item.originalAction} → ${item.rewrittenAction} (rewritten by protection policy)`;
  }
  return item.originalAction;
}

export function PlanProtectionGate({ planId, onAcknowledgedChange }: PlanProtectionGateProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [checkResult, setCheckResult] = useState<PlanProtectionCheckResponse | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [ackErrors, setAckErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoadState('loading');
    planProtectionCheck(planId)
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
        await protectionPlanAcknowledged(
          planId,
          item.itemId,
          item.sourceId ?? null,
          item.level,
          item.reason,
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
      <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
        Checking plan protection…
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
        Could not load protection check. Plan may still proceed.
      </div>
    );
  }

  if (!checkResult || !checkResult.hasProtectedItems) {
    const { normalCount, unprotectedCount } = checkResult?.nonBlockingSummary ?? {
      normalCount: 0,
      unprotectedCount: 0,
    };
    return (
      <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
        No protected items.
        {normalCount > 0 && ` ${normalCount} normal item(s).`}
        {unprotectedCount > 0 && ` ${unprotectedCount} unprotected item(s).`}
      </div>
    );
  }

  const total = checkResult.protectedItems.length;
  const doneCount = acknowledged.size;
  const allDone = doneCount >= total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-2)',
          padding: 'var(--alm-sp-2) var(--alm-sp-3)',
          border: '1px solid var(--alm-border)',
          borderRadius: 'var(--alm-radius-md)',
          background: allDone ? 'var(--alm-surface)' : 'var(--alm-surface2)',
        }}
      >
        <Pill variant={allDone ? 'ok' : 'warn'}>
          {allDone ? 'All acknowledged' : `${total - doneCount} of ${total} require acknowledgement`}
        </Pill>
        <span style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
          {allDone
            ? 'You may proceed with plan execution.'
            : 'Review and acknowledge each protected item below before running the plan.'}
        </span>
      </div>

      {checkResult.protectedItems.map((item) => {
        const isDone = acknowledged.has(item.itemId);
        return (
          <div
            key={item.itemId}
            style={{
              border: '1px solid var(--alm-border)',
              borderRadius: 'var(--alm-radius-md)',
              padding: 'var(--alm-sp-3)',
              background: isDone ? 'var(--alm-surface)' : undefined,
              opacity: isDone ? 0.7 : 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--alm-sp-2)',
                flexWrap: 'wrap',
                marginBottom: 'var(--alm-sp-2)',
              }}
            >
              <Pill variant="ok">{item.level}</Pill>
              <code
                className="alm-mono"
                style={{ fontSize: 'var(--alm-text-xs)', flex: 1, wordBreak: 'break-all' }}
              >
                {item.itemId}
              </code>
              {isDone && <Pill variant="ok">Acknowledged</Pill>}
            </div>

            <div style={{ fontSize: 'var(--alm-text-sm)', marginBottom: 'var(--alm-sp-1)' }}>
              Action: <strong>{actionLabel(item)}</strong>
            </div>

            {item.matchedCategories.length > 0 && (
              <div
                style={{
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-text-muted)',
                  marginBottom: 'var(--alm-sp-1)',
                }}
              >
                Protected categories: {item.matchedCategories.join(', ')}
              </div>
            )}

            <div
              style={{
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-muted)',
                marginBottom: 'var(--alm-sp-2)',
              }}
            >
              {item.reason}
            </div>

            {ackErrors[item.itemId] && (
              <div
                style={{
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-danger)',
                  marginBottom: 'var(--alm-sp-1)',
                }}
              >
                {ackErrors[item.itemId]}
              </div>
            )}

            {!isDone && (
              <Btn size="sm" onClick={() => handleAcknowledge(item)}>
                Acknowledge
              </Btn>
            )}
          </div>
        );
      })}

      {/* Non-blocking summary counts (FR-008) */}
      {(checkResult.nonBlockingSummary.normalCount > 0 ||
        checkResult.nonBlockingSummary.unprotectedCount > 0) && (
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          Also in plan:{' '}
          {checkResult.nonBlockingSummary.normalCount > 0 &&
            `${checkResult.nonBlockingSummary.normalCount} normal item(s)`}
          {checkResult.nonBlockingSummary.normalCount > 0 &&
            checkResult.nonBlockingSummary.unprotectedCount > 0 &&
            ', '}
          {checkResult.nonBlockingSummary.unprotectedCount > 0 &&
            `${checkResult.nonBlockingSummary.unprotectedCount} unprotected item(s)`}
          {' — no acknowledgement required.'}
        </div>
      )}
    </div>
  );
}
