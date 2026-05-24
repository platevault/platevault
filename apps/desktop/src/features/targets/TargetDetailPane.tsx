import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import {
  useParameterizedQuery,
  createParameterizedStore,
} from '@/data/store';
import { getTarget } from '@/api/commands';
import type { TargetDetail as TargetDetailType, AcquisitionSession, ProjectState } from '@/api/types';
import { KV, Pill, Section, Btn, DataTable } from '@/ui';
import { CoverageChart } from './CoverageChart';

const targetDetailStore = createParameterizedStore((id: string) =>
  getTarget({ id }),
);

export interface TargetDetailPaneProps {
  targetId: string;
}

function formatHours(seconds: number): string {
  const h = (seconds / 3600).toFixed(1);
  return `${h}h`;
}

function stateVariant(state: string) {
  switch (state) {
    case 'confirmed':
      return 'ok' as const;
    case 'needs_review':
      return 'warn' as const;
    case 'rejected':
      return 'danger' as const;
    case 'discovered':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

function projectStateVariant(state: ProjectState) {
  switch (state) {
    case 'completed':
      return 'ok' as const;
    case 'blocked':
      return 'danger' as const;
    case 'processing':
      return 'warn' as const;
    case 'ready':
    case 'prepared':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

function formatCoord(ra?: number, dec?: number): string {
  if (ra == null && dec == null) return 'N/A';
  const raStr = ra != null ? `RA ${ra.toFixed(3)}h` : '';
  const decStr = dec != null ? `Dec ${dec.toFixed(2)}deg` : '';
  return [raStr, decStr].filter(Boolean).join(', ');
}

export function TargetDetailPane({ targetId }: TargetDetailPaneProps) {
  const { data, loading, error } = useParameterizedQuery(targetDetailStore, targetId);
  const navigate = useNavigate();

  const sessionColumns = useMemo<ColumnDef<AcquisitionSession, any>[]>(
    () => [
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
        accessorKey: 'total_integration_seconds',
        header: 'Integration',
        cell: ({ getValue }) => formatHours(getValue() as number),
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Pill label={state} variant={stateVariant(state)} size="sm" />;
        },
      },
    ],
    [],
  );

  if (loading) return <div className="alm-page__loading">Loading target...</div>;
  if (error) return <div className="alm-page__error">Error: {error.message}</div>;
  if (!data) return null;

  const catalogEntries = Object.entries(data.catalog_ids).filter(
    ([, v]) => v != null,
  );

  return (
    <div className="alm-target-detail" data-testid="TargetDetailPane">
      <header className="alm-detail-header">
        <h1 className="alm-detail-header__title">{data.name}</h1>
        <Pill label={data.kind.replace(/_/g, ' ')} variant="info" />
      </header>

      <Section title="Identification">
        <KV label="Name" value={data.name} />
        {data.aliases.length > 0 && (
          <KV label="Aliases" value={data.aliases.join(', ')} />
        )}
        {catalogEntries.length > 0 && (
          <KV
            label="Catalog IDs"
            value={catalogEntries
              .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
              .join(', ')}
          />
        )}
        <KV label="Coordinates" value={formatCoord(data.coordinates?.ra, data.coordinates?.dec)} />
      </Section>

      <Section title="Filter Coverage">
        <CoverageChart
          coverage={data.coverage}
          recommended={data.recommended_hours}
        />
      </Section>

      <Section title="Linked Sessions">
        {data.sessions.length > 0 ? (
          <DataTable
            columns={sessionColumns}
            data={data.sessions}
            onRowClick={(row) =>
              navigate({ to: '/sessions/$id', params: { id: row.id } })
            }
          />
        ) : (
          <p className="alm-empty">No linked sessions</p>
        )}
      </Section>

      <Section title="Linked Projects">
        {data.projects.length > 0 ? (
          <ul className="alm-target-detail__projects">
            {data.projects.map((p) => (
              <li key={p.id} className="alm-target-detail__project-row">
                <span className="alm-target-detail__project-name">{p.name}</span>
                <Pill
                  label={p.state.replace(/_/g, ' ')}
                  variant={projectStateVariant(p.state)}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="alm-empty">No linked projects</p>
        )}
        <div className="alm-target-detail__actions">
          <Btn
            variant="primary"
            size="sm"
            onClick={() =>
              navigate({ to: '/projects/new', search: { target: targetId } })
            }
          >
            New project &rarr;
          </Btn>
        </div>
      </Section>
    </div>
  );
}
