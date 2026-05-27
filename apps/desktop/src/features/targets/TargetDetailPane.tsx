/**
 * TargetDetailPane -- target detail view.
 * Updated per spec 030 T078: optical train dropdown on coverage chart,
 * stacked project names in sessions table, removed outputs grid.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useParameterizedQuery,
  createParameterizedStore,
} from '@/data/store';
import { getTarget } from '@/api/commands';
import type { TargetDetail as TargetDetailType, AcquisitionSession, ProjectState } from '@/bindings/types';
import { Select } from '@base-ui-components/react/select';
import { KV, Pill, Btn, Box, Section } from '@/ui';
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
  const raH = ra != null ? Math.floor(ra) : 0;
  const raM = ra != null ? Math.round((ra - raH) * 60) : 0;
  const decDeg = dec != null ? Math.floor(Math.abs(dec)) : 0;
  const decMin = dec != null ? Math.round((Math.abs(dec) - decDeg) * 60) : 0;
  const decSign = dec != null && dec >= 0 ? '+' : '-';
  return `${raH}h ${raM}m / ${decSign}${decDeg}° ${decMin}′`;
}

/** Build stacked project names for a session row. */
function projectNamesForSession(
  session: AcquisitionSession,
  projects: { id: string; name: string }[],
): string[] {
  if (session.project_ids.length === 0) return [];
  return session.project_ids
    .map((pid) => {
      const p = projects.find((pr) => pr.id === pid);
      return p ? p.name : pid.slice(0, 8);
    });
}

// Mock optical trains for the dropdown
const OPTICAL_TRAINS = [
  { value: 'all', label: 'All trains' },
  { value: 'ot-2600mm', label: 'AT130-EDT + 2600MM' },
  { value: 'ot-533mc', label: 'GT81 + ASI533MC' },
];

export function TargetDetailPane({ targetId }: TargetDetailPaneProps) {
  const { data, loading, error } = useParameterizedQuery(targetDetailStore, targetId);
  const navigate = useNavigate();
  const [selectedTrain, setSelectedTrain] = useState<string>('all');

  if (loading) return <div className="alm-page__loading">Loading target...</div>;
  if (error) return <div className="alm-page__error">Error: {error.message}</div>;
  if (!data) return null;

  const catalogEntries = Object.entries(data.catalog_ids).filter(
    ([, v]) => v != null && v !== '',
  );
  const catalogStr = catalogEntries
    .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
    .join(' · ');

  const constellation = data.coordinates?.ra != null && data.coordinates.ra > 20 ? 'Cygnus' : undefined;

  const totalHours = data.total_integration_hours;
  const sessionCount = data.sessions.length;

  const coverageWarnings: string[] = [];
  for (const [filter, actual] of Object.entries(data.coverage)) {
    const target = data.recommended_hours[filter];
    if (target && target > 0 && actual < target) {
      coverageWarnings.push(`${filter} coverage below recommended (target: ${target}h+)`);
    }
  }

  const handleTrainChange = (value: string | null) => {
    if (value !== null) setSelectedTrain(value);
  };

  return (
    <div className="alm-target-detail" data-testid="TargetDetailPane">
      {/* Header */}
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
            New project
          </Btn>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="alm-target-columns">
        {/* Left column */}
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

          {/* Coverage box with optical train dropdown */}
          <Box heading="Coverage at a glance">
            <div className="alm-target-coverage-controls">
              <span className="alm-target-coverage-controls__label">Optical train:</span>
              <Select.Root value={selectedTrain} onValueChange={handleTrainChange}>
                <Select.Trigger className="alm-select alm-select--sm" aria-label="Filter by optical train">
                  <Select.Value />
                  <Select.Icon className="alm-select__icon" />
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner>
                    <Select.Popup className="alm-select__popup">
                      {OPTICAL_TRAINS.map((opt) => (
                        <Select.Item key={opt.value} value={opt.value} className="alm-select__item">
                          <Select.ItemText>{opt.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
            </div>
            <CoverageChart coverage={data.coverage} recommended={data.recommended_hours} />
            {coverageWarnings.length > 0 && (
              <div className="alm-target-coverage-warn">
                &#x26A0; {coverageWarnings[0]}
              </div>
            )}
          </Box>

          {/* Observing plans box */}
          <Box heading="Observing plans">
            <div className="alm-target-plans-list">
              <div className="alm-target-plans-list__item">
                <div>
                  <div>NGC7000_SHO_plan.nina</div>
                  <div className="alm-target-plans-list__meta">NINA &middot; linked 2024-11-29</div>
                </div>
              </div>
              <div className="alm-target-plans-list__item">
                <div>
                  <div>NGC7000_panel_2.nina</div>
                  <div className="alm-target-plans-list__meta">NINA &middot; linked 2024-12-15</div>
                </div>
              </div>
            </div>
            <Btn size="sm">+ Link plan file</Btn>
          </Box>
        </div>

        {/* Right column */}
        <div className="alm-target-columns__right">
          {/* Sessions section with stacked project names */}
          <Section title={`Sessions (${sessionCount} · ${totalHours.toFixed(1)}h total)`}>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th>Night</th>
                  <th>Filter</th>
                  <th>Frames</th>
                  <th>Integ.</th>
                  <th>State</th>
                  <th>Projects</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => {
                  const projectNames = projectNamesForSession(s, data.projects);
                  return (
                    <tr key={s.id}>
                      <td className="alm-mono">{s.session_key.night}</td>
                      <td>
                        <Pill label={s.session_key.filter} variant="ghost" size="sm" />
                      </td>
                      <td className="alm-mono">{s.frame_count}</td>
                      <td className="alm-mono">{formatHours(s.total_integration_seconds)}</td>
                      <td>
                        <Pill
                          label={s.state === 'needs_review' ? 'needs review' : s.state}
                          variant={stateVariant(s.state)}
                          size="sm"
                        />
                      </td>
                      <td>
                        {projectNames.length === 0 ? (
                          <span className="alm-target-detail__no-project">--</span>
                        ) : (
                          <div className="alm-target-detail__stacked-projects">
                            {projectNames.map((name) => (
                              <span key={name} className="alm-target-detail__project-name">
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          {/* Projects section */}
          <Section title={`Projects (${data.projects.length})`}>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Profile</th>
                  <th>Lifecycle</th>
                  <th>Sessions</th>
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
                    <td className="alm-mono">
                      {p.state === 'ready' ? '3 / 4 panels' : '2'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </div>
  );
}
