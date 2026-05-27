import type { TargetFixture } from '@/data/fixtures/targets';
import { TARGETS_DATA, targetDetail } from '@/data/fixtures/targets';
import { DetailPane, DetailHeader } from '@/components';
import { Pill, Box, KV, Section, Table, CoverageBar, Banner, EmptyState } from '@/ui';

// Session state variant helper
const sessVariant = (s: string) =>
  (({ confirmed: 'ok', needs_review: 'warn', rejected: 'danger', discovered: 'ghost', candidate: 'neutral', ignored: 'neutral' } as Record<string, 'ok' | 'warn' | 'danger' | 'ghost' | 'neutral'>)[s] ?? 'neutral');

const projVariant = (s: string) =>
  (({ processing: 'info', ready: 'ghost', prepared: 'info', archived: 'neutral', rejected: 'danger' } as Record<string, 'info' | 'ghost' | 'neutral' | 'danger'>)[s] ?? 'neutral');

interface TargetDetailPaneInlineProps {
  target: TargetFixture | null;
}

export function TargetDetailPaneInline({ target }: TargetDetailPaneInlineProps) {
  if (!target) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a target"
          desc="Choose a target from the list to view its details."
        />
      </DetailPane>
    );
  }

  // Use rich fixture data for NGC 7000; simplified view for others
  const detail = target.name === 'NGC 7000' ? targetDetail : null;

  // Coverage warning: any filter below recommended
  const coverageWarning = detail
    ? Object.entries(detail.recommended_hours).some(([f, rec]) => (detail.coverage[f] ?? 0) < rec)
    : false;

  // Coverage entries for bars
  const coverageFilters = detail
    ? Array.from(new Set([...Object.keys(detail.coverage), ...Object.keys(detail.recommended_hours)]))
    : [];

  const sessionRows = detail
    ? detail.sessions.map(s => ({
        night: <span className="alm-mono">{s.session_key.night}</span>,
        filter: <Pill variant="ghost">{s.session_key.filter}</Pill>,
        frames: <span className="alm-mono">{s.frame_count}</span>,
        integ: <span className="alm-mono">{(s.total_integration_seconds / 3600).toFixed(1)}h</span>,
        state: <Pill variant={sessVariant(s.state)}>{s.state.replace(/_/g, ' ')}</Pill>,
        projects: s.project_ids.length === 0
          ? <span style={{ color: 'var(--alm-text-faint)' }}>—</span>
          : <span>{s.project_ids.length} proj</span>,
      }))
    : [];

  const projectRows = detail
    ? detail.projects.map(p => ({
        name: <strong>{p.name}</strong>,
        profile: 'PixInsight/WBPP',
        state: <Pill variant={projVariant(p.state)}>{p.state}</Pill>,
      }))
    : [];

  return (
    <DetailPane>
      {/* Header — no action buttons (they're in TopActionBar) */}
      <DetailHeader
        title={
          <>
            <strong>{target.name}</strong>
            {target.common && (
              <span style={{ color: 'var(--alm-text-muted)', fontWeight: 400 }}> — {target.common}</span>
            )}
          </>
        }
        titleExtra={<Pill variant="ghost">{target.kind}</Pill>}
        subtitle={`${target.sessions} sessions · ${target.hours.toFixed(1)}h · ${target.projects} projects`}
      />

      {/* Two-column grid layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, marginTop: 12 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Identity */}
          <Box title="Identity">
            <KV label="Primary name" value={target.name} />
            {target.common && <KV label="Common name" value={target.common} />}
            <KV label="Kind" value={target.kind} />
            {detail && (
              <>
                <KV
                  label="Catalog IDs"
                  value={
                    Object.entries(detail.catalog_ids)
                      .filter(([, v]) => v)
                      .map(([cat, val]) => `${cat.toUpperCase()} ${val}`)
                      .join(' · ') || '—'
                  }
                />
                <KV
                  label="RA / Dec"
                  value={
                    detail.coordinates?.ra != null
                      ? `${detail.coordinates.ra}h / ${detail.coordinates.dec != null && detail.coordinates.dec >= 0 ? '+' : ''}${detail.coordinates.dec ?? '?'}°`
                      : 'N/A'
                  }
                />
                <KV label="Aliases" value={detail.aliases.join(', ') || '—'} />
              </>
            )}
          </Box>

          {/* Coverage */}
          <Box title="Coverage at a glance">
            {detail && coverageFilters.length > 0 ? (
              <>
                {coverageFilters.map(f => (
                  <CoverageBar
                    key={f}
                    label={f}
                    value={detail.coverage[f] ?? 0}
                    max={Math.max(detail.recommended_hours[f] ?? 0, detail.coverage[f] ?? 0, 1)}
                  />
                ))}
                {coverageWarning && (
                  <Banner variant="warn" style={{ marginTop: 8 }}>
                    Some filters are below the recommended integration threshold.
                  </Banner>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
                No coverage data
              </span>
            )}
          </Box>

          {/* Observing plans */}
          <Box title="Observing plans">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <div>NGC7000_SHO_plan.nina</div>
                <div style={{ fontSize: 11, color: 'var(--alm-text-muted)' }}>NINA · linked 2024-11-29</div>
              </div>
              <div>
                <div>NGC7000_panel_2.nina</div>
                <div style={{ fontSize: 11, color: 'var(--alm-text-muted)' }}>NINA · linked 2024-12-15</div>
              </div>
            </div>
          </Box>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Sessions table */}
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
                rows={sessionRows}
              />
            ) : (
              <span style={{ color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
                {target.sessions} session{target.sessions !== 1 ? 's' : ''} · {target.hours.toFixed(1)}h total
              </span>
            )}
          </Section>

          {/* Projects table */}
          <Section title="Projects" count={target.projects}>
            {detail && detail.projects.length > 0 ? (
              <Table
                columns={[
                  { key: 'name', label: 'Project' },
                  { key: 'profile', label: 'Profile' },
                  { key: 'state', label: 'Lifecycle' },
                ]}
                rows={projectRows}
              />
            ) : (
              <span style={{ color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
                No projects
              </span>
            )}
          </Section>
        </div>
      </div>
    </DetailPane>
  );
}

// ─── Route-level component for /targets/$id ────────────────────────────────
// Reads the first target from fixture data as a fallback (route params not used in V3 mock).

export function TargetDetail() {
  const target = TARGETS_DATA[0] ?? null;
  return <TargetDetailPaneInline target={target} />;
}
