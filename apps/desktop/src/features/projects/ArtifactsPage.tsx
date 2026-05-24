import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getProject } from '@/api/commands';
import type { ProjectDetail } from '@/api/types';
import { Toolbar, DataTable, Pill, Btn, Section, Box } from '@/ui';

const projectStore = createParameterizedStore<string, ProjectDetail>((id) =>
  getProject({ id }),
);

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

function verificationVariant(state: string) {
  switch (state) {
    case 'accepted':
      return 'ok' as const;
    case 'superseded':
      return 'warn' as const;
    default:
      return 'ghost' as const;
  }
}

type OutputRow = ProjectDetail['outputs'][number];

export function ArtifactsPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, loading } = useParameterizedQuery(projectStore, id);

  const outputColumns = useMemo<ColumnDef<OutputRow, any>[]>(
    () => [
      {
        accessorKey: 'filename',
        header: 'Filename',
        cell: ({ getValue }) => (
          <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: 'kind',
        header: 'Kind',
        cell: ({ getValue }) => <Pill label={getValue() as string} variant="ghost" size="sm" />,
      },
      {
        accessorKey: 'size_bytes',
        header: 'Size',
        cell: ({ getValue }) => formatBytes(getValue() as number),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ getValue }) => formatRelativeDate(getValue() as string),
      },
      {
        accessorKey: 'verification',
        header: 'Verification',
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Pill label={state} variant={verificationVariant(state)} size="sm" />;
        },
      },
      {
        accessorKey: 'protected',
        header: '',
        size: 32,
        cell: ({ getValue }) =>
          (getValue() as boolean) ? (
            <span title="Protected" style={{ color: 'var(--alm-text-muted)' }}>
              &#x1F512;
            </span>
          ) : null,
      },
      {
        id: 'actions',
        header: '',
        size: 80,
        cell: ({ row }) =>
          row.original.verification === 'unreviewed' ? (
            <Btn size="sm" variant="ghost">
              Verify...
            </Btn>
          ) : null,
      },
    ],
    [],
  );

  if (loading || !project) {
    return <div className="alm-page__loading">Loading artifacts...</div>;
  }

  // Group artifacts by type
  const artifactGroups = project.artifacts;

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Toolbar>
        <span style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}>
          {project.name} — Artifacts
        </span>
      </Toolbar>

      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--alm-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
        {/* Observed banner */}
        <div
          style={{
            padding: 'var(--alm-space-3) var(--alm-space-4)',
            background: 'var(--alm-gray-100)',
            border: '1px solid var(--alm-border)',
            borderRadius: 6,
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-space-2)',
          }}
        >
          <span style={{ fontSize: 14 }}>&#x2139;</span>
          <span>Observed, not owned — these files are produced by your processing tool, not managed by Astro Library Manager.</span>
        </div>

        {/* Outputs section */}
        <Section title={`Outputs (${project.outputs.length})`}>
          {project.outputs.length > 0 ? (
            <DataTable columns={outputColumns} data={project.outputs} />
          ) : (
            <div style={{ padding: 'var(--alm-space-4)', color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)', textAlign: 'center' }}>
              No outputs observed yet
            </div>
          )}
        </Section>

        {/* Artifacts grouped by type */}
        <Section title="Artifacts by Type">
          {artifactGroups.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--alm-space-3)' }}>
              {artifactGroups.map((group) => (
                <Box key={group.type} heading={group.type}>
                  <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-1)' }}>
                    <span><strong>{group.count}</strong> files</span>
                    <span>{formatBytes(group.total_size_bytes)} total</span>
                  </div>
                </Box>
              ))}
            </div>
          ) : (
            <div style={{ padding: 'var(--alm-space-4)', color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)', textAlign: 'center' }}>
              No artifacts observed yet
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
