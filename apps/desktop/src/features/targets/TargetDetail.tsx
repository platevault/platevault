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
import { m } from '@/lib/i18n';
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
        <EmptyState title={m.targets_legacy_select_title()} desc={m.targets_legacy_select_desc()} />
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
    { key: 'name', label: m.targets_legacy_prop_primary_name(), value: target.name },
    ...(target.common ? [{ key: 'common', label: m.targets_legacy_prop_common_name(), value: target.common }] : []),
    { key: 'kind', label: m.calibration_fp_kind(), value: target.kind },
    ...(detail
      ? [
          {
            key: 'catalog',
            label: m.targets_legacy_prop_catalog_ids(),
            value:
              Object.entries(detail.catalog_ids)
                .filter(([, v]) => v)
                .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
                .join(' · ') || '—',
          },
          {
            key: 'radec',
            label: m.targets_prop_ra_dec(),
            value:
              detail.coordinates?.ra != null
                ? `${detail.coordinates.ra}h / ${detail.coordinates.dec != null && detail.coordinates.dec >= 0 ? '+' : ''}${detail.coordinates.dec ?? '?'}°`
                : 'N/A',
          },
          { key: 'aliases', label: m.common_aliases(), value: detail.aliases.join(', ') || '—' },
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
          { value: `${target.hours.toFixed(1)}h`, label: m.targets_legacy_metric_integration() },
          { value: target.sessions, label: m.status_sessions_label() },
          { value: target.projects, label: m.status_projects_label() },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title={m.common_coverage()}>
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
                      {m.targets_legacy_no_coverage()}
                    </Banner>
                  )}
                </>
              ) : (
                <span className="alm-target-detail-legacy__no-coverage">{m.targets_legacy_no_coverage()}</span>
              )}
            </RailCard>
            <RailCard title={m.targets_legacy_totals()}>
              <KV label={m.projects_wizard_col_integration()} value={`${target.hours.toFixed(1)}h`} />
              <KV label={m.common_sessions()} value={String(target.sessions)} />
              <KV label={m.common_projects()} value={String(target.projects)} />
            </RailCard>
            <RailCard title={m.targets_legacy_obs_plans()}>
              <div className="alm-target-detail-legacy__obs-plans">
                <div>
                  {/* eslint-disable-next-line alm/no-user-string -- fixture placeholder filename, not real UI */}
                  <div className="alm-mono">NGC7000_SHO_plan.nina</div>
                  {/* eslint-disable-next-line alm/no-user-string -- fixture placeholder metadata */}
                  <div className="alm-target-detail-legacy__obs-plan-meta">NINA · linked 2024-11-29</div>
                </div>
                <div>
                  {/* eslint-disable-next-line alm/no-user-string -- fixture placeholder filename, not real UI */}
                  <div className="alm-mono">NGC7000_panel_2.nina</div>
                  {/* eslint-disable-next-line alm/no-user-string -- fixture placeholder metadata */}
                  <div className="alm-target-detail-legacy__obs-plan-meta">NINA · linked 2024-12-15</div>
                </div>
              </div>
            </RailCard>
          </Rail>
        }
      >
        <Section title={m.targets_legacy_identity_aliases()}>
          <PropertyTable mode="view" properties={identityProps} />
        </Section>

        <Section title={m.common_sessions()} count={target.sessions}>
          {detail ? (
            <Table
              columns={[
                { key: 'night', label: m.sessions_col_night() },
                { key: 'filter', label: m.common_filter() },
                { key: 'frames', label: m.projects_wizard_col_frames() },
                { key: 'integ', label: m.targets_col_integ() },
                { key: 'state', label: m.sessions_col_state() },
                { key: 'projects', label: m.common_projects() },
              ]}
              rows={detail.sessions.map((s) => ({
                night: <span className="alm-mono">{s.sessionKey.night}</span>,
                filter: <Pill variant="ghost">{s.sessionKey.filter}</Pill>,
                frames: <span className="alm-mono">{s.frameCount}</span>,
                // eslint-disable-next-line alm/no-user-string -- unit abbreviation "h" is a universal scientific symbol
                integ: <span className="alm-mono">{((s.totalIntegrationSeconds ?? 0) / 3600).toFixed(1)}h</span>,
                state: <Pill variant={sessionStateVariant(s.state)}>{sessionStateLabel(s.state)}</Pill>,
                projects:
                  s.projectIds.length === 0 ? (
                    <span className="alm-target-detail-legacy__no-projects-dash">—</span>
                  ) : (
                    // eslint-disable-next-line alm/no-user-string -- abbreviated fixture stub
                    <span>{s.projectIds.length} proj</span>
                  ),
              }))}
            />
          ) : (
            <span className="alm-target-detail-legacy__sessions-summary">
              {m.targets_legacy_sessions_summary({ sessions: target.sessions, hours: target.hours.toFixed(1) })}
            </span>
          )}
        </Section>

        <Section title={m.common_projects()} count={target.projects}>
          {detail && detail.projects.length > 0 ? (
            <Table
              columns={[
                { key: 'name', label: m.settings_datasources_category_project() },
                { key: 'profile', label: m.targets_col_profile() },
                { key: 'state', label: m.targets_col_lifecycle() },
              ]}
              rows={detail.projects.map((p) => ({
                name: <strong>{p.name}</strong>,
                profile: 'PixInsight/WBPP',
                state: <Pill variant={projectStateVariant(p.state)}>{projectStateLabel(p.state)}</Pill>,
              }))}
            />
          ) : (
            <span className="alm-target-detail-legacy__projects-empty">{m.targets_legacy_no_projects()}</span>
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
