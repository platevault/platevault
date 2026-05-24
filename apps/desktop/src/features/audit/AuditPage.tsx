import { useMemo, useState, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { listAuditEntries, exportAudit } from '@/api/commands';
import type { AuditEntry, AuditOutcome } from '@/api/types';
import { Toolbar, FilterBar, DataTable, Pill, Btn, EmptyState } from '@/ui';

// --- Filter definitions ---

const FILTER_DEFS = [
  { key: 'outcome:applied', label: 'Applied' },
  { key: 'outcome:ok', label: 'OK' },
  { key: 'outcome:refused', label: 'Refused' },
  { key: 'outcome:failed', label: 'Failed' },
  { key: 'outcome:paused', label: 'Paused' },
  { key: 'actor:user', label: 'User' },
  { key: 'actor:system', label: 'System' },
];

function outcomeVariant(outcome: AuditOutcome): 'ok' | 'danger' | 'warn' | 'neutral' {
  switch (outcome) {
    case 'applied':
    case 'ok':
      return 'ok';
    case 'refused':
    case 'failed':
      return 'danger';
    case 'paused':
      return 'warn';
    default:
      return 'neutral';
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

// --- Store ---

const auditStore = createQueryStore(() =>
  listAuditEntries({ pagination: { offset: 0, limit: 500 } }),
);

// --- Component ---

export function AuditPage() {
  const { data, loading } = useQuery(auditStore);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter entries based on active filter chips
  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (activeFilters.length === 0) return data.entries;

    return data.entries.filter((entry) => {
      const outcomeFilters = activeFilters
        .filter((f) => f.startsWith('outcome:'))
        .map((f) => f.split(':')[1]);
      const actorFilters = activeFilters
        .filter((f) => f.startsWith('actor:'))
        .map((f) => f.split(':')[1]);

      const matchesOutcome =
        outcomeFilters.length === 0 || outcomeFilters.includes(entry.outcome);
      const matchesActor =
        actorFilters.length === 0 || actorFilters.includes(entry.actor);

      return matchesOutcome && matchesActor;
    });
  }, [data, activeFilters]);

  const handleToggleFilter = useCallback((key: string) => {
    setActiveFilters((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key],
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setActiveFilters([]);
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const jsonlContent = await exportAudit({
        filters: activeFilters.length > 0
          ? Object.fromEntries(
              activeFilters.map((f) => {
                const [category, value] = f.split(':');
                return [category, value];
              }),
            )
          : undefined,
      });

      const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-export-${new Date().toISOString().split('T')[0]}.jsonl`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Audit export failed:', err);
    }
  }, [activeFilters]);

  const columns = useMemo<ColumnDef<AuditEntry, any>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Timestamp',
        cell: ({ getValue }) => (
          <span className="alm-mono">{formatTimestamp(getValue() as string)}</span>
        ),
      },
      {
        accessorKey: 'event_type',
        header: 'Event',
        cell: ({ getValue }) => (
          <span className="alm-mono">{getValue() as string}</span>
        ),
      },
      {
        id: 'entity',
        header: 'Entity',
        accessorFn: (row) => `${row.entity_type}:${row.entity_id}`,
        cell: ({ row }) => (
          <span>
            {row.original.entity_type}{' '}
            <span className="alm-mono">{truncate(row.original.entity_id, 12)}</span>
          </span>
        ),
      },
      {
        id: 'state_change',
        header: 'State Change',
        accessorFn: (row) => row.from_state ?? '',
        cell: ({ row }) => {
          const { from_state, to_state } = row.original;
          if (!from_state && !to_state) {
            return <span className="alm-text-muted">&mdash;</span>;
          }
          return (
            <span>
              {from_state ?? '?'} &rarr; {to_state ?? '?'}
            </span>
          );
        },
      },
      {
        accessorKey: 'actor',
        header: 'Actor',
        cell: ({ getValue }) => {
          const actor = getValue() as 'user' | 'system';
          return (
            <Pill
              label={actor}
              variant={actor === 'user' ? 'info' : 'ghost'}
              size="sm"
            />
          );
        },
      },
      {
        accessorKey: 'outcome',
        header: 'Outcome',
        cell: ({ getValue }) => {
          const outcome = getValue() as AuditOutcome;
          return <Pill label={outcome} variant={outcomeVariant(outcome)} size="sm" />;
        },
      },
      {
        accessorKey: 'detail',
        header: 'Detail',
        cell: ({ row }) => {
          const detail = row.original.detail;
          const isExpanded = expandedId === row.original.id;
          if (!detail) return <span className="alm-text-muted">&mdash;</span>;

          return (
            <button
              type="button"
              className="alm-audit-detail-btn"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedId(isExpanded ? null : row.original.id);
              }}
              title={isExpanded ? 'Collapse' : 'Expand detail'}
            >
              {isExpanded ? detail : truncate(detail, 40)}
            </button>
          );
        },
      },
    ],
    [expandedId],
  );

  return (
    <div className="alm-page" data-testid="AuditPage">
      <Toolbar>
        <span style={{ flex: 1 }} />
        <Btn variant="ghost" size="sm" onClick={handleExport}>
          Export JSONL
        </Btn>
      </Toolbar>

      <FilterBar
        filters={FILTER_DEFS}
        active={activeFilters}
        onToggle={handleToggleFilter}
        onClear={handleClearFilters}
      />

      {loading && <div className="alm-page__loading">Loading audit log...</div>}

      {!loading && filteredEntries.length === 0 && (
        <EmptyState
          title="No events recorded"
          description="Audit entries will appear here as operations are performed on your library."
        />
      )}

      {!loading && filteredEntries.length > 0 && (
        <DataTable<AuditEntry>
          columns={columns}
          data={filteredEntries}
        />
      )}
    </div>
  );
}
