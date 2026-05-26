import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useParameterizedQuery,
  createParameterizedStore,
} from '@/data/store';
import { getTarget } from '@/api/commands';
import type { TargetDetail as TargetDetailType, AcquisitionSession, ProjectState } from '@/bindings/types';
import { KV, Pill, Btn, Box } from '@/ui';
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
      return 'info' as const;
    case 'ready':
    case 'prepared':
      return 'ghost' as const;
    default:
      return 'neutral' as const;
  }
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, ' ').toUpperCase();
}

function formatCoord(ra?: number, dec?: number): string {
  if (ra == null && dec == null) return 'N/A';
  // Format RA as hours/minutes and Dec as degrees/arcmin (simplified)
  const raH = ra != null ? Math.floor(ra) : 0;
  const raM = ra != null ? Math.round((ra - raH) * 60) : 0;
  const decDeg = dec != null ? Math.floor(Math.abs(dec)) : 0;
  const decMin = dec != null ? Math.round((Math.abs(dec) - decDeg) * 60) : 0;
  const decSign = dec != null && dec >= 0 ? '+' : '-';
  return `${raH}h ${raM}m / ${decSign}${decDeg}° ${decMin}′`;
}

/** Map session to the project name it belongs to (for the "In project" column). */
function projectNameForSession(session: AcquisitionSession, projects: { id: string; name: string }[]): string {
  if (session.project_ids.length === 0) return '--';
  const p = projects.find((pr) => session.project_ids.includes(pr.id));
  return p ? p.name.replace(/^NGC 7000 · /, '') : session.project_ids[0];
}

// Fake optical train lookup for display
function trainLabel(_id: string): string {
  return '2600MM';
}

export function TargetDetailPane({ targetId }: TargetDetailPaneProps) {
  const { data, loading, error } = useParameterizedQuery(targetDetailStore, targetId);
  const navigate = useNavigate();

  if (loading) return <div className="alm-page__loading">Loading target...</div>;
  if (error) return <div className="alm-page__error">Error: {error.message}</div>;
  if (!data) return null;

  const catalogEntries = Object.entries(data.catalog_ids).filter(
    ([, v]) => v != null && v !== '',
  );
  const catalogStr = catalogEntries
    .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
    .join(' · ');

  // Constellation lookup (simplified)
  const constellation = data.coordinates?.ra != null && data.coordinates.ra > 20 ? 'Cygnus' : undefined;

  // Total hours and session count
  const totalHours = data.total_integration_hours;
  const sessionCount = data.sessions.length;

  // Determine if SII coverage is below recommended
  const coverageWarnings: string[] = [];
  for (const [filter, actual] of Object.entries(data.coverage)) {
    const target = data.recommended_hours[filter];
    if (target && target > 0 && actual < target) {
      coverageWarnings.push(`${filter} coverage below recommended (target: ${target}h+)`);
    }
  }

  return (
    <div className="alm-target-detail" data-testid="TargetDetailPane">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="alm-target-header">
        <div className="alm-target-header__left">
          <h1 className="alm-target-header__name">{data.name}</h1>
          {data.aliases.length > 0 && (
            <span className="alm-target-header__alias">{data.aliases[0]}</span>
          )}
          <Pill label={formatKind(data.kind)} variant="ghost" size="sm" />
        </div>
        <div className="alm-target-header__actions">
          <Btn size="sm">Edit aliases...</Btn>
          <Btn size="sm">Link plan...</Btn>
          <Btn variant="primary" size="sm" onClick={() => navigate({ to: '/projects/new', search: { target: targetId } })}>
            New project &rarr;
          </Btn>
        </div>
      </header>

      {/* ── Two-column layout ───────────────────────────────────────────── */}
      <div className="alm-target-columns">
        {/* ── Left column (320px) ── */}
        <div className="alm-target-columns__left">
          {/* Identity box */}
          <Box heading="Identity">
            <KV label="Primary name" value={data.name} origin="reviewed" />
            <KV label="Aliases" value={data.aliases.join(', ') || '--'} origin="reviewed" />
            <KV label="Catalog IDs" value={catalogStr || '--'} />
            <KV
              label="Kind"
              value={`${data.kind.replace(/_/g, ' ')}${data.kind === 'deep_sky' ? ' · emission nebula' : ''}`}
              origin="reviewed"
            />
            <KV
              label="RA / Dec"
              value={formatCoord(data.coordinates?.ra, data.coordinates?.dec)}
              origin="inferred"
            />
            {constellation && (
              <KV label="Constellation" value={constellation} origin="inferred" />
            )}
          </Box>

          {/* Coverage box */}
          <Box heading="Coverage at a glance">
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-2)' }}>
              integration hours by filter
            </div>
            <CoverageChart coverage={data.coverage} recommended={data.recommended_hours} />
            {coverageWarnings.length > 0 && (
              <div style={{ marginTop: 'var(--alm-space-3)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-warn)' }}>
                &#x26A0; {coverageWarnings[0]}
              </div>
            )}
          </Box>

          {/* Observing plans box */}
          <Box heading="Observing plans">
            <div className="alm-target-plans-list">
              <div className="alm-target-plans-list__item">
                <span style={{ color: 'var(--alm-text-faint)' }}>&#x1F4C4;</span>
                <div>
                  <div>NGC7000_SHO_plan.nina</div>
                  <div className="alm-target-plans-list__meta">NINA &middot; linked 2024-11-29</div>
                </div>
              </div>
              <div className="alm-target-plans-list__item">
                <span style={{ color: 'var(--alm-text-faint)' }}>&#x1F4C4;</span>
                <div>
                  <div>NGC7000_panel_2.nina</div>
                  <div className="alm-target-plans-list__meta">NINA &middot; linked 2024-12-15</div>
                </div>
              </div>
            </div>
            <Btn size="sm">+ Link plan file</Btn>
          </Box>
        </div>

        {/* ── Right column ── */}
        <div className="alm-target-columns__right">
          {/* Sessions section */}
          <div className="alm-target-section">
            <div className="alm-target-section__header">
              <div>
                <span className="alm-target-section__title">Sessions</span>
                <span className="alm-target-section__sub">
                  {sessionCount} acquisition session{sessionCount !== 1 ? 's' : ''} &middot; {totalHours.toFixed(1)}h total
                </span>
              </div>
              <Btn size="sm" onClick={() => navigate({ to: '/sessions' })}>
                Open sessions view &rarr;
              </Btn>
            </div>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th>Night</th>
                  <th>Filter</th>
                  <th>Frames</th>
                  <th>Integ.</th>
                  <th>Train</th>
                  <th>State</th>
                  <th>In project</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {s.session_key.night}
                    </td>
                    <td>
                      <Pill label={s.session_key.filter} variant="ghost" size="sm" />
                    </td>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {s.frame_count}
                    </td>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {formatHours(s.total_integration_seconds)}
                    </td>
                    <td style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {trainLabel(s.optical_train_id)}
                    </td>
                    <td>
                      {s.state === 'confirmed' ? (
                        <Pill label="confirmed" variant="ok" size="sm" />
                      ) : (
                        <Pill label="needs review" variant="warn" size="sm" />
                      )}
                    </td>
                    <td style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {projectNameForSession(s, data.projects) === '--' ? (
                        <span style={{ color: 'var(--alm-text-faint)' }}>--</span>
                      ) : (
                        projectNameForSession(s, data.projects)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Projects section */}
          <div className="alm-target-section">
            <div className="alm-target-section__header">
              <div>
                <span className="alm-target-section__title">Projects</span>
                <span className="alm-target-section__sub">
                  {data.projects.length} project{data.projects.length !== 1 ? 's' : ''} use{data.projects.length === 1 ? 's' : ''} {data.name} data
                </span>
              </div>
            </div>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Profile</th>
                  <th>Lifecycle</th>
                  <th>Sessions</th>
                  <th>Outputs</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>PixInsight/WBPP</td>
                    <td>
                      <Pill
                        label={p.state.replace(/_/g, ' ')}
                        variant={projectStateVariant(p.state)}
                        size="sm"
                      />
                    </td>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                      {p.state === 'ready' ? '3 / 4 panels' : '2'}
                    </td>
                    <td>{p.state === 'processing' ? '1 accepted' : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Outputs section */}
          <Box heading="Outputs (across all projects)">
            <div className="alm-target-outputs">
              {['final v3', 'final v2', 'review'].map((label, i) => (
                <div key={i} className="alm-target-output-card">
                  <div className="alm-target-output-card__thumb alm-mono">
                    final output
                  </div>
                  <div className="alm-target-output-card__footer">
                    <span style={{ flex: 1 }}>{label}</span>
                    {i === 0 ? (
                      <Pill label="accepted" variant="ok" size="sm" />
                    ) : (
                      <Pill label="unreviewed" variant="ghost" size="sm" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Box>
        </div>
      </div>
    </div>
  );
}
