import { useMemo, useState, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { listAuditEntries, exportAudit } from '@/api/commands';
import type { AuditEntry, AuditOutcome } from '@/api/types';
import { Toolbar, FilterBar, DataTable, Pill, Btn, EmptyState } from '@/ui';

// --- Filter definitions ---

const OUTCOME_ACTOR_FILTER_DEFS = [
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
  const [dateStart, setDateStart] = useState<string>('');
  const [dateEnd, setDateEnd] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Derive distinct event types from loaded data for dynamic event type chips
  const eventTypeFilterDefs = useMemo(() => {
    if (!data?.entries) return [];
    const seen = new Set<string>();
    const defs: { key: string; label: string }[] = [];
    for (const entry of data.entries) {
      if (!seen.has(entry.event_type)) {
        seen.add(entry.event_type);
        defs.push({ key: `eventtype:${entry.event_type}`, label: entry.event_type });
      }
    }
    defs.sort((a, b) => a.label.localeCompare(b.label));
    return defs;
  }, [data]);

  // Filter entries based on active filter chips and date range
  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];

    const hasChipFilters = activeFilters.length > 0;
    const hasDateFilter = dateStart !== '' || dateEnd !== '';

    if (!hasChipFilters && !hasDateFilter) return data.entries;

    // Parse date boundaries once (end-of-day inclusive for dateEnd)
    const startMs = dateStart !== '' ? new Date(dateStart).getTime() : -Infinity;
    const endMs = dateEnd !== '' ? new Date(`${dateEnd}T23:59:59.999Z`).getTime() : Infinity;

    return data.entries.filter((entry) => {
      const outcomeFilters = activeFilters
        .filter((f) => f.startsWith('outcome:'))
        .map((f) => f.split(':')[1]);
      const actorFilters = activeFilters
        .filter((f) => f.startsWith('actor:'))
        .map((f) => f.split(':')[1]);
      const eventTypeFilters = activeFilters
        .filter((f) => f.startsWith('eventtype:'))
        .map((f) => f.slice('eventtype:'.length));

      const matchesOutcome =
        outcomeFilters.length === 0 || outcomeFilters.includes(entry.outcome);
      const matchesActor =
        actorFilters.length === 0 || actorFilters.includes(entry.actor);
      const matchesEventType =
        eventTypeFilters.length === 0 || eventTypeFilters.includes(entry.event_type);

      const entryMs = new Date(entry.timestamp).getTime();
      const matchesDate = entryMs >= startMs && entryMs <= endMs;

      return matchesOutcome && matchesActor && matchesEventType && matchesDate;
    });
  }, [data, activeFilters, dateStart, dateEnd]);

  const handleToggleFilter = useCallback((key: string) => {
    setActiveFilters((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key],
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setActiveFilters([]);
    setDateStart('');
    setDateEnd('');
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
        filters={OUTCOME_ACTOR_FILTER_DEFS}
        active={activeFilters}
        onToggle={handleToggleFilter}
        onClear={handleClearFilters}
      />

      {eventTypeFilterDefs.length > 0 && (
        <FilterBar
          filters={eventTypeFilterDefs}
          active={activeFilters}
          onToggle={handleToggleFilter}
          onClear={() => {
            setActiveFilters((prev) => prev.filter((f) => !f.startsWith('eventtype:')));
          }}
        />
      )}

      <div className="alm-toolbar__sub">
        <label htmlFor="audit-date-start" className="alm-text-muted" style={{ fontSize: 'var(--alm-text-xs)' }}>
          From
        </label>
        <input
          id="audit-date-start"
          type="date"
          className="alm-input alm-input--sm"
          value={dateStart}
          onChange={(e) => setDateStart(e.target.value)}
          aria-label="Filter from date"
        />
        <label htmlFor="audit-date-end" className="alm-text-muted" style={{ fontSize: 'var(--alm-text-xs)' }}>
          To
        </label>
        <input
          id="audit-date-end"
          type="date"
          className="alm-input alm-input--sm"
          value={dateEnd}
          onChange={(e) => setDateEnd(e.target.value)}
          aria-label="Filter to date"
        />
        {(dateStart !== '' || dateEnd !== '') && (
          <button
            type="button"
            className="alm-btn alm-btn--ghost alm-btn--sm"
            onClick={() => { setDateStart(''); setDateEnd(''); }}
          >
            Clear dates
          </button>
        )}
      </div>

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
