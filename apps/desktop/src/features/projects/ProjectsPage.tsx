import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { listProjects } from '@/api/commands';
import type { Project, ProjectState } from '@/api/types';
import { Toolbar, DataTable, Pill, Btn, EmptyState } from '@/ui';

const projectsStore = createQueryStore(() => listProjects());

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
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
  if (diffD === 1) return 'yesterday';
  if (diffD < 7) return `${diffD} days ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)} weeks ago`;
  const diffMo = Math.floor(diffD / 30);
  if (diffMo < 12) return `${diffMo} months ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}

function formatIntegrationHours(hours: number): string {
  if (hours === 0) return '—';
  return `${hours.toFixed(1)}h`;
}

function lifecycleVariant(state: ProjectState) {
  const map: Record<ProjectState, 'warn' | 'ghost' | 'info' | 'ok' | 'neutral' | 'danger'> = {
    setup_incomplete: 'warn',
    ready: 'ghost',
    prepared: 'info',
    processing: 'info',
    completed: 'ok',
    archived: 'neutral',
    blocked: 'danger',
  };
  return map[state];
}

function lifecycleLabel(state: ProjectState): string {
  return state.replace(/_/g, ' ');
}

// ─── Target lookup (from fixtures until live) ───────────────────────────────

function targetLabel(ids: string[]): string {
  // In the wireframe, target shows as the target name + panel info for mosaics
  // For now, derive from project name or return a placeholder
  if (ids.length === 0) return '?';
  return ids.length === 1 ? ids[0].slice(-4) : `${ids.length} targets`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { data, loading } = useQuery(projectsStore);
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.workflow_profile_id.toLowerCase().includes(q),
    );
  }, [data, search]);

  const counts = useMemo(() => {
    if (!data) return { total: 0, active: 0, completed: 0, archived: 0, blocked: 0 };
    return {
      total: data.length,
      active: data.filter((p) => !['completed', 'archived', 'blocked'].includes(p.state)).length,
      completed: data.filter((p) => p.state === 'completed').length,
      archived: data.filter((p) => p.state === 'archived').length,
      blocked: data.filter((p) => p.state === 'blocked').length,
    };
  }, [data]);

  const aggregates = useMemo(() => {
    if (!data || data.length === 0) return null;
    const totalInteg = data
      .filter((p) => !['archived', 'blocked'].includes(p.state))
      .reduce((s, p) => s + p.integration_hours, 0);
    const totalDisk = data.reduce((s, p) => s + p.cleanup_state.reclaimable_bytes, 0);
    const cleanupBytes = data
      .filter((p) => p.cleanup_state.reclaimable_bytes > 0)
      .reduce((s, p) => s + p.cleanup_state.reclaimable_bytes, 0);
    return {
      totalInteg: `${totalInteg.toFixed(1)}h`,
      totalDisk: formatBytes(totalDisk || 1), // fallback
      cleanupBytes: formatBytes(cleanupBytes),
    };
  }, [data]);

  const columns = useMemo<ColumnDef<Project, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Project',
        cell: ({ row }) => (
          <div>
            <span className="alm-projects-table__name">
              {row.original.name} <span className="alm-projects-table__arrow">&rarr;</span>
            </span>
            {row.original.blocked_reason && (
              <div className="alm-projects-table__warn">
                &#x26A0; {row.original.blocked_reason}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'target',
        header: 'Target',
        cell: ({ row }) => targetLabel(row.original.target_ids),
      },
      {
        accessorKey: 'workflow_profile_id',
        header: 'Profile',
        size: 120,
        cell: ({ getValue }) => (
          <span style={{ fontSize: 'var(--alm-text-xs)' }}>{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'Lifecycle',
        size: 110,
        cell: ({ getValue }) => {
          const state = getValue() as ProjectState;
          return <Pill label={lifecycleLabel(state)} variant={lifecycleVariant(state)} size="sm" />;
        },
      },
      {
        id: 'sessions',
        header: 'Sess.',
        size: 50,
        cell: ({ row }) => (
          <span className="alm-mono">{row.original.source_map.lights.length}</span>
        ),
      },
      {
        accessorKey: 'integration_hours',
        header: 'Integ.',
        size: 60,
        cell: ({ getValue }) => (
          <span className="alm-mono">{formatIntegrationHours(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'verification_state',
        header: 'Outputs',
        cell: ({ getValue }) => {
          const state = getValue() as Project['verification_state'];
          if (state === 'has_accepted') {
            return <Pill label="accepted" variant="ok" size="sm" />;
          }
          return <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>;
        },
      },
      {
        id: 'size',
        header: 'Size on disk',
        size: 110,
        cell: ({ row }) => {
          const bytes = row.original.cleanup_state.reclaimable_bytes;
          return <span className="alm-mono">{formatBytes(bytes)}</span>;
        },
      },
      {
        id: 'cleanup',
        header: 'Cleanup',
        size: 130,
        cell: ({ row }) => {
          const bytes = row.original.cleanup_state.reclaimable_bytes;
          if (bytes <= 0) {
            return <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>;
          }
          return <span>{formatBytes(bytes)} ready</span>;
        },
      },
      {
        accessorKey: 'updated_at',
        header: 'Updated',
        size: 100,
        cell: ({ getValue }) => (
          <span style={{ color: 'var(--alm-text-muted)' }}>
            {formatRelativeDate(getValue() as string)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="alm-page">
      <Toolbar
        subBar={
          <div className="alm-projects-sub">
            <span>{counts.total} projects</span>
            <span className="alm-projects-sub__dot">&middot;</span>
            <span>{counts.active} active &middot; {counts.completed} completed &middot; {counts.archived} archived</span>
            <span className="alm-projects-sub__dot">&middot;</span>
            <span>{counts.blocked} blocked</span>
          </div>
        }
      >
        <input
          type="text"
          className="alm-sessions-search"
          placeholder="Search projects, targets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Btn size="sm" active={viewMode === 'table'} onClick={() => setViewMode('table')}>
          Table
        </Btn>
        <Btn size="sm" active={viewMode === 'cards'} onClick={() => setViewMode('cards')}>
          Cards
        </Btn>
        <span className="alm-toolbar__separator" />
        <Btn size="sm">Filter: state &#x25BE;</Btn>
        <Btn variant="primary" size="sm" onClick={() => navigate({ to: '/projects/new' })} data-tour="new-project">
          + New project
        </Btn>
      </Toolbar>

      {loading && <div className="alm-page__loading">Loading projects...</div>}

      {!loading && filtered.length === 0 && !search && (
        <EmptyState
          title="No projects yet"
          description="Create a project to organize sessions, calibration masters, and outputs."
          action={
            <Btn variant="primary" onClick={() => navigate({ to: '/projects/new' })}>
              + New project
            </Btn>
          }
        />
      )}

      {!loading && filtered.length === 0 && search && (
        <div className="alm-page__empty">No projects match &ldquo;{search}&rdquo;</div>
      )}

      {!loading && filtered.length > 0 && (
        <DataTable
          columns={columns}
          data={filtered}
          onRowClick={(row) => navigate({ to: '/projects/$id', params: { id: row.id } })}
        />
      )}

      {!loading && aggregates && (
        <div className="alm-projects-footer">
          <span>
            Total integration across active:{' '}
            <span className="alm-mono">{aggregates.totalInteg}</span>
          </span>
          <span>
            Total on disk:{' '}
            <span className="alm-mono">{aggregates.totalDisk}</span>
          </span>
          <span>
            Cleanup-eligible:{' '}
            <span className="alm-mono">{aggregates.cleanupBytes}</span>
          </span>
        </div>
      )}
    </div>
  );
}
