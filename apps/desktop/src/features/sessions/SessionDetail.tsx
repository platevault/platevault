import type { SessionFixture } from '@/data/fixtures/sessions';
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
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

const CAL_MATCHES = [
  { kind: 'dark', name: 'MasterDark_300s_-10C_g100', score: 0.97, mismatch: 'none' },
  { kind: 'flat', name: 'MasterFlat_Ha_2024-11', score: 0.88, mismatch: 'age 34d > 30d threshold' },
  { kind: 'bias', name: 'MasterBias_g100', score: 0.99, mismatch: 'none' },
];

const HISTORY = [
  { ts: '04-16', detail: 'reviewed and confirmed' },
  { ts: '04-15', detail: 'metadata extraction completed' },
  { ts: '04-15', detail: 'discovered in inbox scan' },
  { ts: '04-14', detail: 'target corrected to NGC 7000' },
];

interface Props {
  session: SessionFixture | null;
}

export function SessionDetail({ session }: Props) {
  if (!session) {
    return (
      <DetailPane>
        <EmptyState title="Select a session" desc="Choose a session from the list to view its details." />
      </DetailPane>
    );
  }

  const isLinked = session.projects.length > 0;
  const path = `D:\\Astrophotography\\Inbox\\${session.date}\\${session.filter}`;

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            {isLinked && <Lock />}
            <strong>{session.target}</strong>
            {' · '}
            {session.filter}
            {' · '}
            {session.date}
          </>
        }
        titleExtra={
          <>
            <Pill variant="neutral">{session.frames} frames</Pill>
            <Pill variant={sessionStateVariant(session.state)}>{sessionStateLabel(session.state)}</Pill>
          </>
        }
        subtitle={path}
      />

      <MetricLine
        metrics={[
          { value: session.integration, label: 'integration' },
          { value: session.frames, label: 'frames' },
          { value: session.size, label: 'on disk' },
          { value: session.filter, label: 'filter' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="State">
              <Pill variant={sessionStateVariant(session.state)}>{sessionStateLabel(session.state)}</Pill>
              <div style={{ marginTop: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                {isLinked
                  ? 'Linked to a project — metadata is locked while in use.'
                  : 'Not yet linked to a project.'}
              </div>
            </RailCard>
            <RailCard title="Linked projects">
              {isLinked ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {session.projects.map((p) => (
                    <Pill key={p} variant="info">{p}</Pill>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-faint)' }}>None</span>
              )}
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
        <Section title="Metadata">
          <PropertyTable
            mode="view"
            showSource
            properties={[
              { key: 'target', label: 'Target', value: session.target, source: 'user' },
              { key: 'filter', label: 'Filter', value: session.filter, source: 'fits' },
              { key: 'date', label: 'Date', value: session.date, source: 'fits' },
              { key: 'frames', label: 'Frames', value: session.frames, source: 'fits' },
              { key: 'integration', label: 'Integration', value: session.integration, source: 'inferred' },
              { key: 'size', label: 'Size on disk', value: session.size, source: 'fits' },
            ]}
          />
        </Section>

        <Section title="Calibration matches" count={CAL_MATCHES.length}>
          <Table
            columns={[
              { key: 'kind', label: 'Kind' },
              { key: 'name', label: 'Master' },
              { key: 'score', label: 'Score' },
              { key: 'mismatch', label: 'Soft mismatches' },
            ]}
            rows={CAL_MATCHES.map((m) => ({
              kind: <Pill variant={m.kind === 'dark' ? 'info' : m.kind === 'flat' ? 'accent' : 'neutral'}>{m.kind}</Pill>,
              name: <span className="alm-mono" style={{ fontSize: 11 }}>{m.name}</span>,
              score: <span className="alm-mono">{(m.score * 100).toFixed(0)}%</span>,
              mismatch:
                m.mismatch === 'none' ? (
                  <span style={{ color: 'var(--alm-text-faint)' }}>—</span>
                ) : (
                  <span style={{ color: 'var(--alm-warn)' }}>{m.mismatch}</span>
                ),
            }))}
          />
        </Section>
      </DetailGrid>
    </DetailPane>
  );
}
