import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { listPlans } from '@/api/commands';
import type { FilesystemPlan, PlanState, PlanKind } from '@/api/types';
import { Toolbar, DataTable, Pill, EmptyState } from '@/ui';

const plansStore = createQueryStore(() => listPlans());

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

export function PlansPage() {
  const { data, loading } = useQuery(plansStore);
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<FilesystemPlan, any>[]>(
    () => [
      {
        accessorKey: 'kind',
        header: 'Kind',
        cell: ({ getValue }) => {
          const kind = getValue() as PlanKind;
          return <Pill label={kind.replace(/_/g, ' ')} variant={planKindVariant(kind)} size="sm" />;
        },
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ getValue }) => {
          const state = getValue() as PlanState;
          return <Pill label={state.replace(/_/g, ' ')} variant={planStateVariant(state)} size="sm" />;
        },
      },
      {
        id: 'item_count',
        header: 'Items',
        accessorFn: (r) => r.items.length,
      },
      {
        accessorKey: 'reclaim_bytes',
        header: 'Reclaim',
        cell: ({ getValue }) => {
          const bytes = getValue() as number;
          return bytes > 0 ? formatBytes(bytes) : '—';
        },
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ getValue }) => formatRelativeDate(getValue() as string),
      },
    ],
    [],
  );

  return (
    <div className="alm-page">
      <Toolbar>
        <span style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}>
          Filesystem Plans
        </span>
      </Toolbar>

      {loading && <div className="alm-page__loading">Loading plans...</div>}

      {!loading && data && data.length === 0 && (
        <EmptyState
          title="No filesystem plans"
          description="Plans will appear here when you create project structures, source views, or cleanup operations."
        />
      )}

      {!loading && data && data.length > 0 && (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate({ to: '/plans/$id', params: { id: row.id } })}
        />
      )}
    </div>
  );
}
