import { useMemo, memo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import type { PlanItem, PlanItemAction, PlanItemStatus } from '@/api/types';
import { DataTable, Pill, Provenance } from '@/ui';

export interface PlanTableProps {
  items: PlanItem[];
}

function actionVariant(action: PlanItemAction) {
  switch (action) {
    case 'mkdir':
    case 'link':
    case 'junction':
      return 'info' as const;
    case 'move':
    case 'copy':
    case 'write':
      return 'neutral' as const;
    case 'archive':
    case 'trash':
      return 'warn' as const;
    case 'delete':
      return 'danger' as const;
  }
}

function statusVariant(status: PlanItemStatus) {
  switch (status) {
    case 'applied':
      return 'ok' as const;
    case 'failed':
      return 'danger' as const;
    case 'protected':
      return 'warn' as const;
    case 'skipped':
      return 'ghost' as const;
    default:
      return 'neutral' as const;
  }
}

export const PlanTable = memo(function PlanTable({ items }: PlanTableProps) {
  const columns = useMemo<ColumnDef<PlanItem, any>[]>(
    () => [
      {
        accessorKey: 'action',
        header: 'Action',
        size: 100,
        cell: ({ getValue }) => {
          const action = getValue() as PlanItemAction;
          return <Pill label={action} variant={actionVariant(action)} size="sm" />;
        },
      },
      {
        accessorKey: 'source_path',
        header: 'Source',
        cell: ({ getValue }) => {
          const path = getValue() as string;
          return path ? (
            <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>
              {path}
            </span>
          ) : (
            <span style={{ color: 'var(--alm-text-muted)' }}>—</span>
          );
        },
      },
      {
        accessorKey: 'dest_path',
        header: 'Destination',
        cell: ({ getValue }) => {
          const path = getValue() as string;
          return path ? (
            <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>
              {path}
            </span>
          ) : (
            <span style={{ color: 'var(--alm-text-muted)' }}>—</span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 100,
        cell: ({ getValue }) => {
          const status = getValue() as PlanItemStatus;
          return <Pill label={status} variant={statusVariant(status)} size="sm" />;
        },
      },
      {
        accessorKey: 'dry_run_ok',
        header: 'Dry run',
        size: 72,
        cell: ({ getValue }) => {
          const ok = getValue() as boolean;
          return ok ? (
            <span style={{ color: 'var(--alm-ok)' }}>&#x2713;</span>
          ) : (
            <span style={{ color: 'var(--alm-danger)' }}>&#x2715;</span>
          );
        },
      },
      {
        accessorKey: 'provenance',
        header: 'Prov',
        size: 48,
        cell: ({ row }) => <Provenance origin={row.original.provenance} />,
      },
    ],
    [],
  );

  return <DataTable columns={columns} data={items} />;
});
