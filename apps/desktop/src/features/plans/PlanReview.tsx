import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore, invalidateStores, createQueryStore } from '@/data/store';
import { getPlan, approvePlan, listPlans } from '@/api/commands';
import type { PlanDetail, PlanState } from '@/api/types';
import { Toolbar, Pill, Btn } from '@/ui';
import { PlanTable } from './PlanTable';
import { PlanDiff } from './PlanDiff';
import { ApprovalGate } from './ApprovalGate';

const planStore = createParameterizedStore<string, PlanDetail>((id) => getPlan({ id }));
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
      return 'info' as const;
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

  if (loading || !plan) {
    return <div className="alm-page__loading">Loading plan...</div>;
  }

  const { summary } = plan;
  const canApprove = plan.state === 'ready_for_review';

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Header */}
      <Toolbar>
        <Pill label={plan.kind.replace(/_/g, ' ')} variant="info" />
        <Pill label={plan.state.replace(/_/g, ' ')} variant={planStateVariant(plan.state)} />
        <span style={{ flex: 1 }} />
        <Btn
          size="sm"
          variant={viewMode === 'table' ? 'primary' : undefined}
          onClick={() => setViewMode('table')}
        >
          Table
        </Btn>
        <Btn
          size="sm"
          variant={viewMode === 'diff' ? 'primary' : undefined}
          onClick={() => setViewMode('diff')}
        >
          Diff
        </Btn>
      </Toolbar>

      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--alm-space-5)',
          padding: 'var(--alm-space-3) var(--alm-space-5)',
          borderBottom: '1px solid var(--alm-border)',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          flexWrap: 'wrap',
        }}
      >
        <span><strong>{summary.item_count}</strong> items</span>
        <span><strong>{formatBytes(summary.reclaim_bytes)}</strong> reclaim</span>
        {summary.trash_count > 0 && <span><strong>{summary.trash_count}</strong> trash</span>}
        {summary.archive_count > 0 && <span><strong>{summary.archive_count}</strong> archive</span>}
        {summary.delete_count > 0 && <span style={{ color: 'var(--alm-danger)' }}><strong>{summary.delete_count}</strong> delete</span>}
        {summary.protected_count > 0 && <span><strong>{summary.protected_count}</strong> protected</span>}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--alm-space-5)' }}>
        {viewMode === 'table' ? (
          <PlanTable items={plan.items} />
        ) : (
          <PlanDiff items={plan.items} />
        )}
      </div>

      {/* Approval gate */}
      {canApprove && <ApprovalGate plan={plan} onApprove={handleApprove} />}
    </div>
  );
}
