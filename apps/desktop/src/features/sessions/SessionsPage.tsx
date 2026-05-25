import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { listSessions } from '@/api/commands';
import type { AcquisitionSession } from '@/api/types';
import { Toolbar, DataTable, Pill, Confidence, Btn, EmptyState } from '@/ui';
import { GroupByBar } from './GroupByBar';
import { SessionsFilterBar } from './SessionsFilterBar';
import { CalendarView } from './CalendarView';

const sessionsStore = createQueryStore(() => listSessions());

function formatIntegration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function stateVariant(state: string) {
  switch (state) {
    case 'confirmed': return 'ok' as const;
    case 'needs_review': return 'warn' as const;
    case 'rejected': return 'danger' as const;
    case 'discovered': return 'info' as const;
    default: return 'neutral' as const;
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'needs_review': return 'needs review';
    case 'confirmed': return 'confirmed';
    case 'rejected': return 'rejected';
    case 'discovered': return 'discovered';
    case 'candidate': return 'candidate';
    case 'ignored': return 'ignored';
    default: return state;
  }
}

export function SessionsPage() {
  const { data, loading } = useQuery(sessionsStore);
  const [view, setView] = usePreference('sessionsView');
  const [groupBy] = usePreference('sessionsGroupBy');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<AcquisitionSession, any>[]>(
    () => [
      {
        id: 'warning',
        header: '',
        size: 24,
        cell: ({ row }) =>
          row.original.warnings.length > 0 ? (
            <span
              title={row.original.warnings.join('\n')}
              style={{ color: 'var(--alm-warn)' }}
            >
              &#x26A0;
            </span>
          ) : (
            <span style={{ color: 'var(--alm-gray-400)' }}>&middot;</span>
          ),
      },
      {
        accessorFn: (r) => r.session_key.target,
        id: 'target',
        header: 'Target',
        cell: ({ getValue }) => (
          <strong>{getValue() as string}</strong>
        ),
      },
      {
        accessorFn: (r) => r.session_key.filter,
        id: 'filter',
        header: 'Filter',
        size: 50,
        cell: ({ getValue }) => (
          <Pill label={getValue() as string} variant="ghost" size="sm" />
        ),
      },
      {
        accessorFn: (r) => r.session_key.night,
        id: 'night',
        header: 'Night',
        size: 90,
        cell: ({ getValue }) => (
          <span className="alm-mono">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'frame_count',
        header: 'Frames',
        size: 60,
        cell: ({ getValue }) => (
          <span className="alm-mono">
            {(getValue() as number).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: 'total_integration_seconds',
        header: 'Integration',
        size: 50,
        cell: ({ getValue }) => (
          <span className="alm-mono">
            {formatIntegration(getValue() as number)}
          </span>
        ),
      },
      {
        accessorKey: 'optical_train_id',
        header: 'Optical train',
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return (
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-gray-600)' }}>
              {id.slice(0, 8)}...
            </span>
          );
        },
      },
      {
        accessorKey: 'state',
        header: 'State',
        size: 110,
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Pill label={stateLabel(state)} variant={stateVariant(state)} size="sm" />;
        },
      },
      {
        accessorKey: 'confidence',
        header: 'Confidence',
        size: 90,
        cell: ({ getValue }) => (
          <Confidence level={getValue() as AcquisitionSession['confidence']} />
        ),
      },
      {
        accessorKey: 'project_ids',
        header: 'Projects',
        cell: ({ getValue }) => {
          const ids = getValue() as string[];
          if (ids.length === 0) {
            return (
              <span style={{ color: 'var(--alm-gray-400)', fontSize: 'var(--alm-text-xs)' }}>
                &mdash;
              </span>
            );
          }
          return (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {ids.map((id) => (
                <Pill key={id} label={id.slice(0, 8)} variant="info" size="sm" />
              ))}
            </span>
          );
        },
      },
    ],
    [],
  );

  const hasSelection = selection.size > 0;

  const groupByColumn = groupBy === 'none' ? undefined : groupBy === 'train' ? 'optical_train_id' : groupBy;

  // Compute session counts for the sub-toolbar
  const sessionCounts = useMemo(() => {
    if (!data) return { total: 0, confirmed: 0, needsReview: 0 };
    return {
      total: data.length,
      confirmed: data.filter((s) => s.state === 'confirmed').length,
      needsReview: data.filter((s) => s.state === 'needs_review').length,
    };
  }, [data]);

  // Filter data by selected day and search query
  const filteredData = useMemo(() => {
    if (!data) return data;
    let result = data;
    if (selectedDay) {
      result = result.filter((s) => s.session_key.night === selectedDay);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.session_key.target.toLowerCase().includes(q) ||
          s.session_key.filter.toLowerCase().includes(q) ||
          s.optical_train_id.toLowerCase().includes(q),
      );
    }
    return result;
  }, [data, selectedDay, searchQuery]);

  return (
    <div className="alm-page">
      {/* Primary toolbar: search, view toggles, separator, action buttons */}
      <Toolbar
        subBar={
          <div className="alm-sessions-sub">
            <span className="alm-sessions-sub__counts">
              <span>{sessionCounts.total} sessions</span>
              <span className="alm-sessions-sub__dot">&middot;</span>
              <span>{sessionCounts.confirmed} confirmed</span>
              <span className="alm-sessions-sub__dot">&middot;</span>
              <span>{sessionCounts.needsReview} needs review</span>
            </span>
            <span className="alm-sessions-sub__keys">
              n = new session &middot; &#x23CE; open &middot; &#x2318;D dupe in project
            </span>
          </div>
        }
      >
        <input
          type="text"
          className="alm-sessions-search"
          placeholder="Search target, filter, train..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search sessions"
        />
        <Btn
          size="sm"
          active={view === 'list'}
          onClick={() => setView('list')}
        >
          List
        </Btn>
        <Btn
          size="sm"
          active={view === 'calendar'}
          onClick={() => setView('calendar')}
        >
          Calendar
        </Btn>
        <span className="alm-toolbar__separator" />
        <Btn size="sm" disabled={!hasSelection}>Confirm</Btn>
        <Btn size="sm" disabled={!hasSelection}>Split&hellip;</Btn>
        <Btn size="sm" disabled={!hasSelection}>Merge</Btn>
        <Btn size="sm" disabled={!hasSelection}>Use in project &rarr;</Btn>
      </Toolbar>

      {/* Group-by bar + filter bar */}
      <div className="alm-sessions-bars">
        <GroupByBar />
        <span className="alm-toolbar__separator" />
        <SessionsFilterBar />
      </div>

      {selectedDay && (
        <div className="alm-page__filter-bar">
          <span>Filtered by night: {selectedDay}</span>
          <Btn size="sm" variant="ghost" onClick={() => setSelectedDay(null)}>
            Clear
          </Btn>
        </div>
      )}

      {loading && <div className="alm-page__loading">Loading sessions...</div>}

      {!loading && view === 'list' && filteredData && filteredData.length === 0 && (
        <EmptyState
          title="No sessions found"
          description={
            selectedDay
              ? `No sessions for night ${selectedDay}.`
              : 'Sessions will appear here after scanning your library roots.'
          }
        />
      )}

      {!loading && view === 'list' && filteredData && filteredData.length > 0 && (
        <DataTable
          columns={columns}
          data={filteredData}
          groupBy={groupByColumn}
          selectable
          onRowClick={(row) => navigate({ to: '/sessions/$id', params: { id: row.id } })}
          rowProps={(row, index) =>
            index === 0 && (row.state === 'discovered' || row.state === 'candidate' || row.state === 'needs_review')
              ? { 'data-tour': 'first-session' }
              : undefined
          }
        />
      )}

      {!loading && view === 'calendar' && (
        <CalendarView onDaySelect={(day) => { setSelectedDay(day); setView('list'); }} />
      )}
    </div>
  );
}
