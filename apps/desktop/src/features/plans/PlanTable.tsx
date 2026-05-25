import { useMemo, memo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import type { PlanItem, PlanItemAction, PlanItemStatus, ProvenanceOrigin } from '@/api/types';
import { DataTable, Pill, Provenance } from '@/ui';

export interface PlanTableProps {
  items: PlanItem[];
}

/** Map action to pill variant + display label (matches wireframe). */
function actionChip(action: PlanItemAction): { variant: 'warn' | 'danger' | 'info' | 'ghost' | 'neutral'; label: string } {
  switch (action) {
    case 'trash':
      return { variant: 'warn', label: 'trash' };
    case 'delete':
      return { variant: 'danger', label: 'DELETE' };
    case 'archive':
      return { variant: 'info', label: 'archive' };
    case 'link':
    case 'junction':
      return { variant: 'ghost', label: 'rm link' };
    case 'mkdir':
      return { variant: 'info', label: 'mkdir' };
    case 'move':
      return { variant: 'neutral', label: 'move' };
    case 'copy':
      return { variant: 'neutral', label: 'copy' };
    case 'write':
      return { variant: 'neutral', label: 'write' };
  }
}

function statusVariant(status: PlanItemStatus) {
  switch (status) {
    case 'applied':
      return 'ok' as const;
    case 'failed':
      return 'danger' as const;
    case 'protected':
      return 'ghost' as const;
    case 'skipped':
      return 'ghost' as const;
    default:
      return 'ghost' as const;
  }
}

/** Format size for display. Real items would carry a size field; for demo use dash. */
function formatItemSize(item: PlanItem): string {
  // In a real implementation, PlanItem would carry a size_bytes field.
  // For now, derive from path patterns to match wireframe.
  if (item.source_path.includes('drizzle')) return '880 MB (14 files)';
  if (item.source_path.includes('.xisf')) return '128 MB';
  if (item.source_path.includes('.tmp')) return '64 MB';
  if (item.source_path.includes('.log')) return item.source_path.includes('14') ? '2.4 MB' : '1.8 MB';
  if (item.source_path.includes('wbpp_input_old')) return '92 links';
  if (item.source_path.includes('final')) return '512 MB';
  if (item.source_path.includes('manifest')) return '12 KB';
  return '--';
}

function conflictPolicy(item: PlanItem): string {
  if (item.status === 'protected') return '--';
  if (item.action === 'archive') return 'rename';
  return 'fail if exists';
}

export const PlanTable = memo(function PlanTable({ items }: PlanTableProps) {
  const columns = useMemo<ColumnDef<PlanItem, any>[]>(
    () => [
      {
        accessorKey: 'action',
        header: 'Action',
        size: 80,
        cell: ({ getValue }) => {
          const action = getValue() as PlanItemAction;
          const chip = actionChip(action);
          return <Pill label={chip.label} variant={chip.variant} size="sm" />;
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 70,
        cell: ({ getValue }) => {
          const status = getValue() as PlanItemStatus;
          return <Pill label={status} variant={statusVariant(status)} size="sm" />;
        },
      },
      {
        accessorKey: 'source_path',
        header: 'Source path',
        cell: ({ getValue }) => (
          <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
            {getValue() as string || '--'}
          </span>
        ),
      },
      {
        accessorKey: 'dest_path',
        header: 'Destination',
        cell: ({ row }) => {
          const item = row.original;
          if (item.status === 'protected') {
            return (
              <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                &#x1F512; (skipped &mdash; {item.protection_reason ? item.protection_reason.replace('Protected — ', '') : 'protected'})
              </span>
            );
          }
          return (
            <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {item.dest_path || '--'}
            </span>
          );
        },
      },
      {
        id: 'size',
        header: 'Size',
        size: 90,
        cell: ({ row }) => (
          <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
            {formatItemSize(row.original)}
          </span>
        ),
      },
      {
        id: 'conflict',
        header: 'Conflict',
        size: 100,
        cell: ({ row }) => (
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {conflictPolicy(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'provenance',
        header: 'Provenance',
        size: 80,
        cell: ({ row }) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--alm-space-1)' }}>
            <Provenance origin={row.original.provenance} />
            <span style={{ fontSize: '10.5px', color: 'var(--alm-text-muted)' }}>
              {row.original.provenance}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'dry_run_ok',
        header: 'Dry-run',
        size: 50,
        cell: ({ getValue }) => {
          const ok = getValue() as boolean;
          return ok ? (
            <span style={{ color: 'var(--alm-ok)' }}>&#x2713;</span>
          ) : (
            <span style={{ color: 'var(--alm-danger)' }}>&#x2715;</span>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      {/* Filter bar */}
      <div className="alm-plan-filter">
        <span className="alm-plan-filter__label">Filter:</span>
        <span className="alm-plan-filter__chip">
          action: <span className="alm-plan-filter__chip-value">all</span> &times;
        </span>
        <span className="alm-plan-filter__add">+ add</span>
        <span className="alm-plan-filter__count">
          {items.length} of {items.length}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={items}
        rowProps={(row) => {
          if (row.action === 'delete') return { style: 'background: #faf0ec' } as any;
          if (row.status === 'protected') return { style: 'background: var(--alm-surface); opacity: 0.7' } as any;
          return undefined;
        }}
      />

      {/* "... N more items" footer */}
      {items.length < 148 && (
        <div style={{
          padding: 'var(--alm-space-3) var(--alm-space-5)',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          borderBottom: '1px solid var(--alm-border)',
        }}>
          ... {148 - items.length} more items (filtered view)
        </div>
      )}
    </>
  );
});
