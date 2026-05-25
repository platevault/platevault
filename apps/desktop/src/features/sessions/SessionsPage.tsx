import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { listSessions } from '@/api/commands';
import type { AcquisitionSession } from '@/api/types';
import { Toolbar, DataTable, Pill, Confidence, Btn, EmptyState } from '@/ui';
import { GroupByBar } from './GroupByBar';
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

export function SessionsPage() {
  const { data, loading } = useQuery(sessionsStore);
  const [view, setView] = usePreference('sessionsView');
  const [groupBy] = usePreference('sessionsGroupBy');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<AcquisitionSession, any>[]>(
    () => [
      {
        id: 'warning',
        header: '',
        size: 32,
        cell: ({ row }) =>
          row.original.warnings.length > 0 ? (
            <span title={row.original.warnings.join('\n')}>⚠</span>
          ) : null,
      },
      {
        accessorFn: (r) => r.session_key.target,
        id: 'target',
        header: 'Target',
      },
      {
        accessorFn: (r) => r.session_key.filter,
        id: 'filter',
        header: 'Filter',
      },
      {
        accessorFn: (r) => r.session_key.night,
        id: 'night',
        header: 'Night',
      },
      {
        accessorKey: 'frame_count',
        header: 'Frames',
      },
      {
        accessorKey: 'total_integration_seconds',
        header: 'Integration',
        cell: ({ getValue }) => formatIntegration(getValue() as number),
      },
      {
        accessorKey: 'optical_train_id',
        header: 'Optical Train',
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return id.slice(0, 8) + '...';
        },
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Pill label={state} variant={stateVariant(state)} />;
        },
      },
      {
        accessorKey: 'confidence',
        header: 'Confidence',
        cell: ({ getValue }) => (
          <Confidence level={getValue() as AcquisitionSession['confidence']} />
        ),
      },
      {
        accessorKey: 'project_ids',
        header: 'Projects',
        cell: ({ getValue }) => {
          const ids = getValue() as string[];
          return ids.map((id) => (
            <Pill key={id} label={id.slice(0, 8)} variant="ghost" size="sm" />
          ));
        },
      },
    ],
    [],
  );

  const hasSelection = selection.size > 0;

  const groupByColumn = groupBy === 'none' ? undefined : groupBy === 'train' ? 'optical_train_id' : groupBy;

  const filteredData = useMemo(() => {
    if (!data || !selectedDay) return data;
    return data.filter((s) => s.session_key.night === selectedDay);
  }, [data, selectedDay]);

  return (
    <div className="alm-page">
      <Toolbar
        subBar={<GroupByBar />}
      >
        <Btn disabled={!hasSelection}>Confirm</Btn>
        <Btn disabled={!hasSelection}>Split</Btn>
        <Btn disabled={!hasSelection}>Merge</Btn>
        <Btn disabled={!hasSelection}>Use in project</Btn>
        <span style={{ flex: 1 }} />
        <Btn
          variant={view === 'list' ? 'primary' : undefined}
          size="sm"
          onClick={() => setView('list')}
        >
          List
        </Btn>
        <Btn
          variant={view === 'calendar' ? 'primary' : undefined}
          size="sm"
          onClick={() => setView('calendar')}
        >
          Calendar
        </Btn>
      </Toolbar>

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
