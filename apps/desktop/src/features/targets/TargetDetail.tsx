import type { TargetFixture } from '@/data/fixtures/targets';
import { TARGETS_DATA, targetDetail } from '@/data/fixtures/targets';
import {
  DetailPane,
  DetailHeader,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  PropertyTable,
} from '@/components';
import { Pill, KV, Section, Table, CoverageBar, Banner, EmptyState } from '@/ui';
import type { PropertyDef } from '@/components';
import {
  sessionStateLabel,
  sessionStateVariant,
  projectStateLabel,
  projectStateVariant,
} from '@/lib/lifecycle';

interface TargetDetailPaneInlineProps {
  target: TargetFixture | null;
}

export function TargetDetailPaneInline({ target }: TargetDetailPaneInlineProps) {
  if (!target) {
    return (
      <DetailPane>
        <EmptyState title="Select a target" desc="Choose a target from the list to view its details." />
      </DetailPane>
    );
  }

  // Rich fixture data exists for NGC 7000; simplified view otherwise.
  const detail = target.name === 'NGC 7000' ? targetDetail : null;

  const coverageWarning = detail
    ? Object.entries(detail.recommended_hours).some(([f, rec]) => (detail.coverage[f] ?? 0) < rec)
    : false;

  const coverageFilters = detail
    ? Array.from(new Set([...Object.keys(detail.coverage), ...Object.keys(detail.recommended_hours)]))
    : [];

  const identityProps: PropertyDef[] = [
    { key: 'name', label: 'Primary name', value: target.name },
    ...(target.common ? [{ key: 'common', label: 'Common name', value: target.common }] : []),
    { key: 'kind', label: 'Kind', value: target.kind },
    ...(detail
      ? [
          {
            key: 'catalog',
            label: 'Catalog IDs',
            value:
              Object.entries(detail.catalog_ids)
                .filter(([, v]) => v)
                .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
                .join(' · ') || '—',
          },
          {
            key: 'radec',
            label: 'RA / Dec',
            value:
              detail.coordinates?.ra != null
                ? `${detail.coordinates.ra}h / ${detail.coordinates.dec != null && detail.coordinates.dec >= 0 ? '+' : ''}${detail.coordinates.dec ?? '?'}°`
                : 'N/A',
          },
          { key: 'aliases', label: 'Aliases', value: detail.aliases.join(', ') || '—' },
        ]
      : []),
  ];

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            <strong>{target.name}</strong>
            {target.common && (
              <span className="alm-target-detail-legacy__common-name"> — {target.common}</span>
            )}
          </>
        }
        titleExtra={<Pill variant="ghost">{target.kind}</Pill>}
      />

      <MetricLine
        metrics={[
          { value: `${target.hours.toFixed(1)}h`, label: 'integration' },
          { value: target.sessions, label: 'sessions' },
          { value: target.projects, label: 'projects' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Coverage">
              {detail && coverageFilters.length > 0 ? (
                <>
                  {coverageFilters.map((f) => (
                    <CoverageBar
                      key={f}
                      label={f}
                      value={detail.coverage[f] ?? 0}
                      max={Math.max(detail.recommended_hours[f] ?? 0, detail.coverage[f] ?? 0, 1)}
                    />
                  ))}
                  {coverageWarning && (
                    <Banner variant="warn" className="alm-target-detail-legacy__coverage-warn">
                      Some filters are below the recommended integration.
                    </Banner>
                  )}
                </>
              ) : (
                <span className="alm-target-detail-legacy__no-coverage">No coverage data</span>
              )}
            </RailCard>
            <RailCard title="Totals">
              <KV label="Integration" value={`${target.hours.toFixed(1)}h`} />
              <KV label="Sessions" value={String(target.sessions)} />
              <KV label="Projects" value={String(target.projects)} />
            </RailCard>
            <RailCard title="Observing plans">
              <div className="alm-target-detail-legacy__obs-plans">
                <div>
                  <div className="alm-mono">NGC7000_SHO_plan.nina</div>
                  <div className="alm-target-detail-legacy__obs-plan-meta">NINA · linked 2024-11-29</div>
                </div>
                <div>
                  <div className="alm-mono">NGC7000_panel_2.nina</div>
                  <div className="alm-target-detail-legacy__obs-plan-meta">NINA · linked 2024-12-15</div>
                </div>
              </div>
            </RailCard>
          </Rail>
        }
      >
        <Section title="Identity & aliases">
          <PropertyTable mode="view" properties={identityProps} />
        </Section>

        <Section title="Sessions" count={target.sessions}>
          {detail ? (
            <Table
              columns={[
                { key: 'night', label: 'Night' },
                { key: 'filter', label: 'Filter' },
                { key: 'frames', label: 'Frames' },
                { key: 'integ', label: 'Integ.' },
                { key: 'state', label: 'State' },
                { key: 'projects', label: 'Projects' },
              ]}
              rows={detail.sessions.map((s) => ({
                night: <span className="alm-mono">{s.sessionKey.night}</span>,
                filter: <Pill variant="ghost">{s.sessionKey.filter}</Pill>,
                frames: <span className="alm-mono">{s.frameCount}</span>,
                integ: <span className="alm-mono">{((s.totalIntegrationSeconds ?? 0) / 3600).toFixed(1)}h</span>,
                state: <Pill variant={sessionStateVariant(s.state)}>{sessionStateLabel(s.state)}</Pill>,
                projects:
                  s.projectIds.length === 0 ? (
                    <span className="alm-target-detail-legacy__no-projects-dash">—</span>
                  ) : (
                    <span>{s.projectIds.length} proj</span>
                  ),
              }))}
            />
          ) : (
            <span className="alm-target-detail-legacy__sessions-summary">
              {target.sessions} session{target.sessions !== 1 ? 's' : ''} · {target.hours.toFixed(1)}h total
            </span>
          )}
        </Section>

        <Section title="Projects" count={target.projects}>
          {detail && detail.projects.length > 0 ? (
            <Table
              columns={[
                { key: 'name', label: 'Project' },
                { key: 'profile', label: 'Profile' },
                { key: 'state', label: 'Lifecycle' },
              ]}
              rows={detail.projects.map((p) => ({
                name: <strong>{p.name}</strong>,
                profile: 'PixInsight/WBPP',
                state: <Pill variant={projectStateVariant(p.state)}>{projectStateLabel(p.state)}</Pill>,
              }))}
            />
          ) : (
            <span className="alm-target-detail-legacy__projects-empty">No projects</span>
          )}
        </Section>
      </DetailGrid>
    </DetailPane>
  );
}

export function TargetDetail() {
  const target = TARGETS_DATA[0] ?? null;
  return <TargetDetailPaneInline target={target} />;
}
