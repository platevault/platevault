import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery, createQueryStore } from '@/data/store';
import { listProjects } from '@/api/commands';
import type { Project, ProjectState } from '@/api/types';
import { Toolbar, DataTable, Pill, Btn, EmptyState } from '@/ui';

const projectsStore = createQueryStore(() => listProjects());

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
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

function projectStateVariant(state: ProjectState) {
  switch (state) {
    case 'completed':
      return 'ok' as const;
    case 'ready':
    case 'prepared':
      return 'info' as const;
    case 'processing':
      return 'neutral' as const;
    case 'setup_incomplete':
      return 'ghost' as const;
    case 'blocked':
      return 'danger' as const;
    case 'archived':
      return 'warn' as const;
  }
}

function verificationLabel(state: Project['verification_state']): string {
  switch (state) {
    case 'has_accepted':
      return 'Verified';
    case 'all_rejected':
      return 'Rejected';
    default:
      return 'Unreviewed';
  }
}

function verificationVariant(state: Project['verification_state']) {
  switch (state) {
    case 'has_accepted':
      return 'ok' as const;
    case 'all_rejected':
      return 'danger' as const;
    default:
      return 'ghost' as const;
  }
}

export function ProjectsPage() {
  const { data, loading } = useQuery(projectsStore);
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Project, any>[]>(
    () => [
      {
        id: 'warning',
        header: '',
        size: 32,
        cell: ({ row }) =>
          row.original.state === 'blocked' ? (
            <span title={row.original.blocked_reason || 'Blocked'} style={{ color: 'var(--alm-warn)' }}>
              &#x26A0;
            </span>
          ) : null,
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <span>
            {row.original.name}
            {row.original.state === 'setup_incomplete' && (
              <span style={{ marginLeft: 'var(--alm-space-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                (draft)
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'Lifecycle',
        cell: ({ getValue }) => {
          const state = getValue() as ProjectState;
          return <Pill label={state.replace(/_/g, ' ')} variant={projectStateVariant(state)} size="sm" />;
        },
      },
      {
        accessorKey: 'verification_state',
        header: 'Verification',
        cell: ({ getValue }) => {
          const state = getValue() as Project['verification_state'];
          return <Pill label={verificationLabel(state)} variant={verificationVariant(state)} size="sm" />;
        },
      },
      {
        id: 'on_disk_size',
        header: 'On-disk',
        accessorFn: (r) => r.cleanup_state.reclaimable_bytes,
        cell: ({ getValue }) => formatBytes(getValue() as number),
      },
      {
        id: 'cleanup',
        header: 'Cleanup',
        cell: ({ row }) => {
          const bytes = row.original.cleanup_state.reclaimable_bytes;
          return bytes > 0 ? (
            <Pill label="Eligible" variant="warn" size="sm" />
          ) : (
            <span style={{ color: 'var(--alm-text-muted)' }}>—</span>
          );
        },
      },
      {
        accessorKey: 'updated_at',
        header: 'Updated',
        cell: ({ getValue }) => formatRelativeDate(getValue() as string),
      },
      {
        accessorKey: 'workflow_profile_id',
        header: 'Workflow',
        cell: ({ getValue }) => {
          const profile = getValue() as string;
          return <Pill label={profile} variant="ghost" size="sm" />;
        },
      },
      {
        id: 'actions',
        header: '',
        size: 80,
        cell: ({ row }) => {
          if (row.original.state === 'setup_incomplete') {
            return (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => navigate({ to: '/projects/new' })}
              >
                Resume
              </Btn>
            );
          }
          return null;
        },
      },
    ],
    [navigate],
  );

  return (
    <div className="alm-page">
      <Toolbar>
        <span style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}>Projects</span>
        <span style={{ flex: 1 }} />
        <Btn variant="primary" onClick={() => navigate({ to: '/projects/new' })} data-tour="new-project">
          + New project
        </Btn>
      </Toolbar>

      {loading && <div className="alm-page__loading">Loading projects...</div>}

      {!loading && data && data.length === 0 && (
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

      {!loading && data && data.length > 0 && (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate({ to: '/projects/$id', params: { id: row.id } })}
        />
      )}
    </div>
  );
}
