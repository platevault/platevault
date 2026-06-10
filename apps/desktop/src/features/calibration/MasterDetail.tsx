import type { MasterFixture } from '@/data/fixtures/calibration';
import { focusedMaster } from '@/data/fixtures/calibration';
import {
  DetailPane,
  DetailHeader,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  PropertyTable,
} from '@/components';
import { Pill, Section, Table, EmptyState, Lock } from '@/ui';
import type { PillVariant } from '@/ui';

// ─── Local variant helpers ────────────────────────────────────────────────────

function kindVariant(kind: string): PillVariant {
  const map: Record<string, PillVariant> = { dark: 'info', flat: 'accent', bias: 'neutral' };
  return map[kind] ?? 'neutral';
}

function confVariant(conf: string): PillVariant {
  return conf === 'confirmed' ? 'ok' : conf === 'high' ? 'accent' : 'neutral';
}

function decisionVariant(decision: string): PillVariant {
  return decision === 'accepted' ? 'ok' : 'warn';
}

// ─── Sub-fixtures (same data as before, kept in this module) ─────────────────

const MATCHED_SESSIONS = [
  { session: 'NGC 7000 · Ha · 2024-11-30', filter: 'Ha', frames: 54, status: 'accepted' as const },
  { session: 'NGC 7000 · OIII · 2024-11-30', filter: 'OIII', frames: 38, status: 'accepted' as const },
  { session: 'NGC 7000 · SII · 2024-12-01', filter: 'SII', frames: 22, status: 'undecided' as const },
];

const LINKED_PROJECTS = [
  { project: 'NGC 7000 · HOO', profile: 'PixInsight/WBPP', state: 'processing' as const },
  { project: 'NGC 7000 · SHO mosaic', profile: 'PixInsight/WBPP', state: 'ready' as const },
  { project: 'IC 1396 · HOO', profile: 'PixInsight/WBPP', state: 'prepared' as const },
  { project: 'M42 · HOO', profile: 'PixInsight/WBPP', state: 'ready' as const },
];

const COMPAT_SESSIONS = [
  { check: 'ok', session: 'NGC 7000 · Ha · 2024-11-30', frames: 54, score: 0.92, softMismatch: '—', decision: 'accepted' as const },
  { check: 'ok', session: 'NGC 7000 · OIII · 2024-11-30', frames: 38, score: 0.92, softMismatch: '—', decision: 'accepted' as const },
  { check: 'ok', session: 'NGC 7000 · SII · 2024-12-01', frames: 22, score: 0.91, softMismatch: '—', decision: 'undecided' as const },
  { check: 'soft', session: 'NGC 7000 · Ha · 2024-12-15', frames: 30, score: 0.88, softMismatch: '−10.3°C vs −10°C (Δ 0.3)', decision: 'undecided' as const },
];

const HISTORY = [
  { ts: '01-30', detail: 'imported via scan #14' },
  { ts: '01-30', detail: 'matched to 4 sessions' },
  { ts: '12-18', detail: 'linked to NGC 7000 · SHO mosaic' },
  { ts: '12-02', detail: 'linked to NGC 7000 · HOO' },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  master: MasterFixture | null;
}

export function MasterDetail({ master }: Props) {
  if (!master) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a master"
          desc="Choose a calibration master from the list to view its details."
        />
      </DetailPane>
    );
  }

  const isAging1Year = master.age >= 365;
  const isAgingWarn = master.aging && !isAging1Year;

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            <Lock />
            <span className="alm-mono">{master.name}</span>
          </>
        }
        titleExtra={
          <>
            <Pill variant={kindVariant(master.kind)}>{master.kind.toUpperCase()}</Pill>
            {isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
            {isAgingWarn && <Pill variant="warn">aging {master.age}d</Pill>}
          </>
        }
        subtitle={`${master.name}.xisf · ${master.size}`}
      />

      <MetricLine
        metrics={[
          { value: master.size, label: 'on disk' },
          { value: `${master.age}d`, label: 'age' },
          { value: master.sessions, label: 'sessions' },
          { value: master.projects, label: 'projects' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Master facts">
              <PropertyTable
                mode="view"
                properties={[
                  { key: 'kind', label: 'Kind', value: master.kind },
                  { key: 'exposure', label: 'Exposure', value: master.exposure },
                  { key: 'temp', label: 'Temperature', value: master.temp },
                  { key: 'gain', label: 'Gain', value: String(master.gain) },
                  { key: 'camera', label: 'Camera', value: master.camera },
                  { key: 'binning', label: 'Binning', value: master.binning },
                  { key: 'size', label: 'Size', value: master.size },
                ]}
              />
            </RailCard>

            <RailCard title="Reuse">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-xs)' }}>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Sessions matched</span>{' '}
                  <strong>{master.sessions}</strong>
                </div>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Projects linked</span>{' '}
                  <strong>{master.projects}</strong>
                </div>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Last used in</span>{' '}
                  {focusedMaster.lastUsedProject}
                </div>
                <div style={{ marginTop: 'var(--alm-sp-1)' }}>
                  <Pill variant={confVariant(focusedMaster.conf)}>{focusedMaster.conf}</Pill>
                </div>
              </div>
            </RailCard>

            <RailCard title="Recent history">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-xs)' }}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={{ color: 'var(--alm-text-secondary)' }}>
                    <span className="alm-mono" style={{ color: 'var(--alm-text-faint)' }}>{h.ts}</span> · {h.detail}
                  </div>
                ))}
              </div>
            </RailCard>
          </Rail>
        }
      >
        <Section title="Matching fingerprint" count={focusedMaster.fingerprint.length}>
          <PropertyTable
            mode="view"
            showSource
            properties={focusedMaster.fingerprint.map((row) => ({
              key: row.k,
              label: row.k,
              value: row.v,
              source: row.prov === 'reviewed' ? 'user' : row.prov === 'inferred' ? 'inferred' : 'fits',
            }))}
          />
          <div style={{ marginTop: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            Binary match:{' '}
            <span className="alm-mono">exact ({focusedMaster.fingerprint.length}/{focusedMaster.fingerprint.length} fields)</span>
          </div>
        </Section>

        <Section title="Compatible acquisition sessions" count={COMPAT_SESSIONS.length}>
          <Table
            columns={[
              { key: 'check', label: '', style: { width: 24 } },
              { key: 'session', label: 'Session' },
              { key: 'frames', label: 'Frames', style: { width: 72 } },
              { key: 'score', label: 'Score', style: { width: 64 } },
              { key: 'softMismatch', label: 'Soft mismatches' },
              { key: 'decision', label: 'Decision', style: { width: 100 } },
            ]}
            rows={COMPAT_SESSIONS.map((s) => ({
              check:
                s.check === 'ok'
                  ? <span style={{ color: 'var(--alm-ok)' }}>✓</span>
                  : <span style={{ color: 'var(--alm-warn)' }}>~</span>,
              session: <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{s.session}</span>,
              frames: <span className="alm-mono">{s.frames}</span>,
              score: <span className="alm-mono">{s.score.toFixed(2)}</span>,
              softMismatch:
                s.softMismatch === '—'
                  ? <span style={{ color: 'var(--alm-text-faint)' }}>—</span>
                  : <span style={{ color: 'var(--alm-warn)' }}>{s.softMismatch}</span>,
              decision: <Pill variant={decisionVariant(s.decision)}>{s.decision}</Pill>,
            }))}
          />
        </Section>

        <Section title="Matched sessions" count={MATCHED_SESSIONS.length}>
          <Table
            columns={[
              { key: 'session', label: 'Session' },
              { key: 'filter', label: 'Filter', style: { width: 60 } },
              { key: 'frames', label: 'Frames', style: { width: 72 } },
              { key: 'status', label: 'Match status', style: { width: 100 } },
            ]}
            rows={MATCHED_SESSIONS.map((s) => ({
              session: <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{s.session}</span>,
              filter: <Pill variant="ghost">{s.filter}</Pill>,
              frames: <span className="alm-mono">{s.frames}</span>,
              status: <Pill variant={s.status === 'accepted' ? 'ok' : 'warn'}>{s.status}</Pill>,
            }))}
          />
        </Section>

        <Section title="Linked projects" count={LINKED_PROJECTS.length}>
          <Table
            columns={[
              { key: 'project', label: 'Project' },
              { key: 'profile', label: 'Workflow profile' },
              { key: 'state', label: 'Lifecycle' },
            ]}
            rows={LINKED_PROJECTS.map((p) => ({
              project: <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{p.project}</span>,
              profile: p.profile,
              state: (
                <Pill variant={p.state === 'processing' ? 'info' : p.state === 'prepared' ? 'accent' : 'neutral'}>
                  {p.state}
                </Pill>
              ),
            }))}
          />
        </Section>
      </DetailGrid>
    </DetailPane>
  );
}
