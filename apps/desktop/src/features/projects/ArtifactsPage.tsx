import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getProject } from '@/api/commands';
import type { ProjectDetail, ProjectOutput, ProjectArtifactGroup } from '@/bindings/types';
import { Toolbar, Pill, Btn, Lock, Confidence } from '@/ui';

const projectStore = createParameterizedStore<string, ProjectDetail>((id) =>
  getProject({ id }),
);

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function verificationPill(state: ProjectOutput['verification']) {
  switch (state) {
    case 'accepted':
      return <Pill label="accepted" variant="ok" size="sm" />;
    case 'superseded':
      return <Pill label="superseded" variant="ghost" size="sm" />;
    default:
      return <Pill label="unreviewed" variant="warn" size="sm" />;
  }
}

function cleanupPill(eligibility: ProjectArtifactGroup['cleanup_eligibility']) {
  switch (eligibility) {
    case 'eligible':
      return <Pill label="eligible" variant="warn" size="sm" />;
    case 'archive':
      return <Pill label="archive" variant="info" size="sm" />;
    case 'keep':
      return <Pill label="keep" variant="ok" size="sm" />;
    default:
      return <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>;
  }
}

export function ArtifactsPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, loading } = useParameterizedQuery(projectStore, id);

  if (loading || !project) {
    return <div className="alm-page__loading">Loading artifacts...</div>;
  }

  const unknownCount = project.artifacts.filter((a) => a.warning).length;

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Toolbar
        subBar={
          <div className="alm-project-sub">
            <span>{project.artifacts.reduce((s, a) => s + a.count, 0)} artifacts observed</span>
            <span className="alm-project-sub__dot">&middot;</span>
            <span>last sweep 12 min ago</span>
            <span className="alm-project-sub__dot">&middot;</span>
            <span>{unknownCount} unknown items need review</span>
            <span style={{ marginLeft: 'auto', color: 'var(--alm-text-faint)' }}>
              Files here are <strong>observed, not owned</strong> &mdash; the app never modifies them.
            </span>
          </div>
        }
      >
        <Btn size="sm">Re-observe workspace</Btn>
        <Btn size="sm">Classify unknowns&hellip;</Btn>
        <Btn size="sm">Plan cleanup</Btn>
        <span style={{ flex: 1 }} />
        <Btn variant="primary" size="sm">+ Record output</Btn>
      </Toolbar>

      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--alm-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
        {/* Outputs section */}
        <div className="alm-project-section">
          <div className="alm-project-section__header">
            <span className="alm-project-section__title">Outputs</span>
            <span className="alm-project-section__sub">
              recorded final / intermediate results &middot; verified manually
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {project.outputs.length} recorded &middot;{' '}
              {project.outputs.filter((o) => o.verification === 'accepted').length} accepted
            </span>
          </div>
          <table className="alm-simple-table">
            <thead>
              <tr>
                <th style={{ width: 26 }} />
                <th>Filename</th>
                <th style={{ width: 130 }}>Kind</th>
                <th style={{ width: 80 }}>Size</th>
                <th style={{ width: 100 }}>Recorded</th>
                <th style={{ width: 110 }}>Verification</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {project.outputs.map((o) => (
                <tr key={o.id}>
                  <td>{o.protected && <Lock />}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {o.filename}
                  </td>
                  <td style={{ fontSize: 'var(--alm-text-xs)' }}>{o.kind}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {formatSize(o.size_bytes)}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {o.date}
                  </td>
                  <td>{verificationPill(o.verification)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Btn size="sm">Verify&hellip;</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Processing artifacts section */}
        <div className="alm-project-section">
          <div className="alm-project-section__header">
            <span className="alm-project-section__title">Processing artifacts</span>
            <span className="alm-project-section__sub">
              grouped by artifact type &middot; what the app observed in the project&rsquo;s processing workspace
            </span>
          </div>
          <table className="alm-simple-table">
            <thead>
              <tr>
                <th>Artifact type</th>
                <th style={{ width: 60 }}>Count</th>
                <th style={{ width: 80 }}>Size</th>
                <th style={{ width: 110 }}>Cleanup eligibility</th>
                <th style={{ width: 100 }}>Confidence</th>
                <th style={{ width: 110 }}>Tool</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {project.artifacts.map((g) => (
                <tr key={g.type}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-2)' }}>
                      {g.protected && <Lock />}
                      <strong>{g.type}</strong>
                      {g.warning && (
                        <span style={{ fontSize: '10.5px', color: 'var(--alm-warn)' }}>
                          &#x26A0; {g.warning}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {g.count || <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {formatSize(g.total_size_bytes)}
                  </td>
                  <td>{cleanupPill(g.cleanup_eligibility)}</td>
                  <td>
                    {g.confidence !== 'unknown' ? (
                      <Confidence level={g.confidence} />
                    ) : (
                      <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>
                    )}
                  </td>
                  <td style={{ fontSize: 'var(--alm-text-xs)' }}>{g.tool}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Btn size="sm">List files &rarr;</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
