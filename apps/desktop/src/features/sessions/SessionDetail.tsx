import { useState } from 'react';
import type { SessionFixture } from '@/data/fixtures/sessions';
import { DetailPane, DetailHeader } from '@/components';
import { Pill, Btn, Section, Box, Table, EmptyState, Lock } from '@/ui';

// Calibration match fixture for detail view
const CAL_MATCHES = [
  { kind: 'dark', name: 'MasterDark_300s_-10C_g100', score: 0.97, mismatch: 'none' },
  { kind: 'flat', name: 'MasterFlat_Ha_2024-11', score: 0.88, mismatch: 'age 34d > 30d threshold' },
  { kind: 'bias', name: 'MasterBias_g100', score: 0.99, mismatch: 'none' },
];

const HISTORY_ROWS = [
  { ts: '2026-04-16T09:12:00Z', event: 'session.confirmed', actor: 'user', detail: 'Reviewed and confirmed' },
  { ts: '2026-04-15T21:06:00Z', event: 'session.candidate', actor: 'system', detail: 'Metadata extraction completed' },
  { ts: '2026-04-15T21:05:00Z', event: 'session.discovered', actor: 'system', detail: 'Inbox scan detected new FITS files' },
  { ts: '2026-04-14T18:30:00Z', event: 'session.metadata_updated', actor: 'user', detail: 'Target name corrected to NGC 7000' },
  { ts: '2026-04-14T17:55:00Z', event: 'session.filter_set', actor: 'user', detail: 'Filter manually set to Ha' },
  { ts: '2026-04-13T10:22:00Z', event: 'session.project_linked', actor: 'user', detail: 'Linked to NGC 7000 · HOO' },
  { ts: '2026-04-12T08:04:00Z', event: 'session.cal_matched', actor: 'system', detail: 'Calibration auto-matched: dark, flat' },
  { ts: '2026-04-11T22:15:00Z', event: 'session.needs_review', actor: 'system', detail: 'Soft mismatch detected on flat age' },
  { ts: '2026-04-10T19:40:00Z', event: 'session.rescan', actor: 'user', detail: 'Manual rescan triggered' },
];

const PAGE_SIZE = 5;

const stateVariant = (s: string) =>
  (({ confirmed: 'ok', needs_review: 'warn', rejected: 'danger', discovered: 'ghost', candidate: 'neutral', ignored: 'neutral' } as Record<string, 'ok' | 'warn' | 'danger' | 'ghost' | 'neutral'>)[s] ?? 'neutral');

interface Props {
  session: SessionFixture | null;
}

export function SessionDetail({ session }: Props) {
  const [historyPage, setHistoryPage] = useState(0);

  if (!session) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a session"
          desc="Choose a session from the list to view its details."
        />
      </DetailPane>
    );
  }

  const isLinked = session.projects.length > 0;
  const totalPages = Math.ceil(HISTORY_ROWS.length / PAGE_SIZE);
  const historySlice = HISTORY_ROWS.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);

  return (
    <DetailPane>
      {/* Header */}
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
            <Pill variant={stateVariant(session.state)}>{session.state.replace(/_/g, ' ')}</Pill>
          </>
        }
        actions={
          <>
            <Btn size="sm">Re-open to review</Btn>
            <Btn size="sm" disabled={isLinked}>Move to Inbox</Btn>
            <Btn size="sm">Use in project</Btn>
          </>
        }
      />

      {/* Stats bar */}
      <div className="alm-detail__stats">
        <div className="alm-detail__stat">
          <span className="alm-detail__stat-value">{session.integration}</span>
          <span className="alm-detail__stat-label">integration</span>
        </div>
        <div className="alm-detail__stat">
          <span className="alm-detail__stat-value">{session.size}</span>
          <span className="alm-detail__stat-label">on disk</span>
        </div>
        <div className="alm-detail__stat">
          <span className="alm-detail__stat-value">{session.projects.length}</span>
          <span className="alm-detail__stat-label">projects</span>
        </div>
      </div>

      {/* Metadata section */}
      <Section title="Metadata">
        <Box>
          <table className="alm-prop-table">
            <tbody>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Target</td>
                <td className="alm-prop-table__value">{session.target}</td>
                <td className="alm-prop-table__source">reviewed</td>
              </tr>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Filter</td>
                <td className="alm-prop-table__value">{session.filter}</td>
                <td className="alm-prop-table__source">observed</td>
              </tr>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Date</td>
                <td className="alm-prop-table__value">{session.date}</td>
                <td className="alm-prop-table__source">observed</td>
              </tr>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Frames</td>
                <td className="alm-prop-table__value">{session.frames}</td>
                <td className="alm-prop-table__source">observed</td>
              </tr>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Integration</td>
                <td className="alm-prop-table__value">{session.integration}</td>
                <td className="alm-prop-table__source">computed</td>
              </tr>
              <tr className="alm-prop-table__row">
                <td className="alm-prop-table__label">Size on disk</td>
                <td className="alm-prop-table__value">{session.size}</td>
                <td className="alm-prop-table__source">observed</td>
              </tr>
            </tbody>
          </table>
        </Box>
      </Section>

      {/* Calibration matches */}
      <Section title="Calibration matches" count={CAL_MATCHES.length}>
        <Table
          columns={[
            { key: 'kind', label: 'Kind' },
            { key: 'name', label: 'Master' },
            { key: 'score', label: 'Score' },
            { key: 'mismatch', label: 'Soft mismatches' },
          ]}
          rows={CAL_MATCHES.map(m => ({
            kind: <Pill variant={m.kind === 'dark' ? 'info' : m.kind === 'flat' ? 'accent' : 'neutral'}>{m.kind}</Pill>,
            name: <span className="alm-mono" style={{ fontSize: 11 }}>{m.name}</span>,
            score: <span className="alm-mono">{(m.score * 100).toFixed(0)}%</span>,
            mismatch: m.mismatch === 'none'
              ? <span style={{ color: 'var(--alm-text-faint)' }}>—</span>
              : <span style={{ color: 'var(--alm-warn)' }}>{m.mismatch}</span>,
          }))}
        />
      </Section>

      {/* Linked projects */}
      <Section title="Linked projects" count={session.projects.length}>
        {session.projects.length === 0 ? (
          <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>Not linked to any project</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0' }}>
            {session.projects.map(p => (
              <Pill key={p} variant="info">{p}</Pill>
            ))}
          </div>
        )}
      </Section>

      {/* History with pagination */}
      <Section
        title="History"
        count={`page ${historyPage + 1} of ${totalPages}`}
        right={
          <span style={{ display: 'flex', gap: 4 }}>
            <Btn size="sm" disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}>Previous</Btn>
            <Btn size="sm" disabled={historyPage >= totalPages - 1} onClick={() => setHistoryPage(p => p + 1)}>Next</Btn>
          </span>
        }
      >
        <Table
          columns={[
            { key: 'ts', label: 'Timestamp', className: 'alm-mono' },
            { key: 'event', label: 'Event' },
            { key: 'actor', label: 'Actor' },
            { key: 'detail', label: 'Detail' },
          ]}
          rows={historySlice.map(h => ({
            ts: <span className="alm-mono" style={{ fontSize: 11 }}>{h.ts}</span>,
            event: h.event,
            actor: h.actor,
            detail: h.detail,
          }))}
        />
      </Section>
    </DetailPane>
  );
}
