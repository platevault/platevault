import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { FilesystemPlan, PlanState, PlanKind } from '@/api/types';
import { Pill } from '@/ui';

export interface PlansListProps {
  plans: FilesystemPlan[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

type SortKey = 'created' | 'kind' | 'state';

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

function planKindVariant(kind: PlanKind) {
  switch (kind) {
    case 'cleanup':
    case 'archive':
      return 'warn' as const;
    case 'project_structure':
    case 'source_view':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

export function PlansList({ plans, selectedId, onSelect }: PlansListProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('created');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = plans;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.kind.toLowerCase().includes(q) ||
          p.state.toLowerCase().includes(q),
      );
    }

    if (stateFilter !== 'all') {
      result = result.filter((p) => p.state === stateFilter);
    }

    if (kindFilter !== 'all') {
      result = result.filter((p) => p.kind === kindFilter);
    }

    const sorted = [...result];
    switch (sort) {
      case 'created':
        sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        break;
      case 'kind':
        sorted.sort((a, b) => a.kind.localeCompare(b.kind));
        break;
      case 'state':
        sorted.sort((a, b) => a.state.localeCompare(b.state));
        break;
    }

    return sorted;
  }, [plans, search, sort, stateFilter, kindFilter]);

  return (
    <nav className="alm-list-pane" aria-label="Filesystem plans">
      {/* Header */}
      <div className="alm-list-pane__header">
        <div className="alm-list-pane__title">Plans</div>
        <div className="alm-list-pane__counts">
          {plans.length} plan{plans.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Search */}
      <div className="alm-list-pane__search">
        <input
          type="text"
          className="alm-list-pane__input"
          placeholder="Search plans..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search plans"
        />
      </div>

      {/* Sort and filter controls */}
      <div className="alm-list-pane__controls">
        <select
          className="alm-list-pane__select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort plans"
        >
          <option value="created">Sort: Created</option>
          <option value="kind">Sort: Kind</option>
          <option value="state">Sort: State</option>
        </select>
        <select
          className="alm-list-pane__select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          aria-label="Filter by state"
        >
          <option value="all">State: all</option>
          <option value="draft">draft</option>
          <option value="ready_for_review">ready for review</option>
          <option value="approved">approved</option>
          <option value="applied">applied</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="discarded">discarded</option>
        </select>
        <select
          className="alm-list-pane__select"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          aria-label="Filter by kind"
        >
          <option value="all">Kind: all</option>
          <option value="cleanup">cleanup</option>
          <option value="project_structure">project structure</option>
          <option value="archive">archive</option>
          <option value="source_view">source view</option>
        </select>
      </div>

      {/* Plan items */}
      <div className="alm-list-pane__items">
        {filtered.length === 0 && (
          <div className="alm-list-pane__empty">No matching plans</div>
        )}
        {filtered.map((plan) => {
          const isSelected = plan.id === selectedId;
          return (
            <button
              key={plan.id}
              type="button"
              className={clsx(
                'alm-list-pane__item',
                isSelected && 'alm-list-pane__item--selected',
              )}
              onClick={() => onSelect(plan.id)}
              aria-current={isSelected ? 'true' : undefined}
            >
              <div className="alm-list-pane__item-top">
                <span
                  className={clsx(
                    'alm-list-pane__item-label',
                    isSelected && 'alm-list-pane__item-label--active',
                  )}
                  title={plan.id}
                >
                  {plan.id}
                </span>
              </div>
              <div className="alm-list-pane__item-row">
                <Pill
                  label={plan.kind.replace(/_/g, ' ')}
                  variant={planKindVariant(plan.kind)}
                  size="sm"
                />
                <Pill
                  label={plan.state.replace(/_/g, ' ')}
                  variant={planStateVariant(plan.state)}
                  size="sm"
                />
              </div>
              <div className="alm-list-pane__item-meta">
                <span>{plan.items.length} items</span>
                {plan.reclaim_bytes > 0 && (
                  <>
                    <span className="alm-list-pane__dot" />
                    <span>{formatBytes(plan.reclaim_bytes)}</span>
                  </>
                )}
                <span className="alm-list-pane__dot" />
                <span>{formatRelativeDate(plan.created_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
