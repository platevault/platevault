import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  useParameterizedQuery,
  createParameterizedStore,
  invalidateStores,
  createQueryStore,
} from '@/data/store';
import { getPlan, approvePlan, discardPlan, listPlans } from '@/api/commands';
import type { PlanDetail, PlanState } from '@/api/types';
import { Toolbar, Pill, Btn } from '@/ui';
import { PlanTable } from './PlanTable';
import { PlanDiff } from './PlanDiff';
import { ApprovalGate } from './ApprovalGate';

const planStore = createParameterizedStore<string, PlanDetail>((id) =>
  getPlan({ id }),
);
const plansListStore = createQueryStore(() => listPlans());

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function planStateVariant(state: PlanState) {
  switch (state) {
    case 'applied':
      return 'ok' as const;
    case 'ready_for_review':
      return 'warn' as const;
    case 'approved':
    case 'applying':
      return 'neutral' as const;
    case 'failed':
    case 'cancelled':
    case 'discarded':
      return 'danger' as const;
    case 'partially_applied':
    case 'paused':
      return 'warn' as const;
    default:
      return 'ghost' as const;
  }
}

function formatState(state: string): string {
  return state.replace(/_/g, ' ').toUpperCase();
}

type ViewToggle = 'table' | 'diff';

export function PlanReview() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: plan, loading } = useParameterizedQuery(planStore, id);
  const [viewMode, setViewMode] = useState<ViewToggle>('table');

  async function handleApprove() {
    if (!plan) return;
    const acknowledged = plan.has_destructive ? true : undefined;
    await approvePlan({ id: plan.id, delete_acknowledged: acknowledged });
    planStore.invalidate(id);
    invalidateStores(plansListStore);
  }

  async function handleDiscard() {
    if (!plan) return;
    await discardPlan({ id: plan.id });
    planStore.invalidate(id);
    invalidateStores(plansListStore);
  }

  if (loading || !plan) {
    return <div className="alm-page__loading">Loading plan...</div>;
  }

  const { summary } = plan;
  const canApprove = plan.state === 'ready_for_review';
  const dryRunOk = plan.items.every((item) => item.dry_run_ok);

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <Toolbar
        subBar={
          <div className="alm-plan-subbar">
            <span>
              <span className="alm-mono">{plan.id}</span>
              {' · '}
              {plan.kind.replace(/_/g, ' ')}
              {' · target: '}
              <strong>NGC 7000 · HOO</strong>
            </span>
            <span className="alm-plan-subbar__sep" aria-hidden="true">&middot;</span>
            <span>created 12 min ago &middot; by user</span>
            <span className="alm-plan-subbar__dryrun">
              {dryRunOk
                ? 'dry-run: ✓ all preconditions satisfied'
                : 'dry-run: ✕ preconditions failed'}
            </span>
          </div>
        }
      >
        <Pill
          label={formatState(plan.state)}
          variant={planStateVariant(plan.state)}
          size="sm"
        />
        <span style={{ fontWeight: 600, fontSize: 'var(--alm-text-md)' }}>
          {plan.kind.replace(/_/g, ' ')}
        </span>
        <span style={{ flex: 1 }} />

        {/* ── View toggle (segmented control) ── */}
        <div className="alm-view-toggle">
          <button
            type="button"
            className={`alm-view-toggle__btn${viewMode === 'table' ? ' alm-view-toggle__btn--active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={`alm-view-toggle__btn${viewMode === 'diff' ? ' alm-view-toggle__btn--active' : ''}`}
            onClick={() => setViewMode('diff')}
          >
            Diff (before / after)
          </button>
        </div>

        <Btn size="sm" onClick={handleDiscard}>Discard</Btn>
        <Btn size="sm">Edit policy &rarr;</Btn>
        <Btn variant="primary" size="sm" disabled={!canApprove} onClick={handleApprove}>
          Approve &amp; apply
        </Btn>
      </Toolbar>

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      <div className="alm-plan-summary">
        <div>
          <span className="alm-plan-summary__label">Items: </span>
          <strong className="alm-mono">{summary.item_count}</strong>
        </div>
        <div>
          <span className="alm-plan-summary__label">Reclaim: </span>
          <strong className="alm-mono">{formatBytes(summary.reclaim_bytes)}</strong>
        </div>
        <div>
          <span className="alm-plan-summary__label">Trash: </span>
          <span className="alm-mono">{summary.trash_count}</span>
        </div>
        <div>
          <span className="alm-plan-summary__label">Archive: </span>
          <span className="alm-mono">{summary.archive_count}</span>
        </div>
        {summary.delete_count > 0 && (
          <div className="alm-plan-summary__danger">
            <span className="alm-plan-summary__label">Permanent delete: </span>
            <strong className="alm-mono">{summary.delete_count}</strong>
          </div>
        )}
        <div>
          <span className="alm-plan-summary__label">Protected (skipped): </span>
          <span className="alm-mono">{summary.protected_count}</span>
        </div>
        {summary.delete_count > 0 && (
          <span className="alm-plan-summary__warn">
            &#x26A0; Destructive items require separate approval below
          </span>
        )}
      </div>

      {/* ── Content: table or diff ───────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'table' ? (
          <PlanTable items={plan.items} />
        ) : (
          <PlanDiff items={plan.items} summary={summary} />
        )}
      </div>

      {/* ── Approval gate ────────────────────────────────────────────────── */}
      {canApprove && <ApprovalGate plan={plan} onApprove={handleApprove} />}
    </div>
  );
}
