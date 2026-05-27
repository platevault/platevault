/**
 * SessionDetail -- unified read-only view using PropertyTable.
 * Removes split columns, provenance badges, and confirmed badges.
 * Adds project-membership check to disable "Move to Inbox" when session
 * is used in a project.
 */

import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getSession, transitionSession } from '@/api/commands';
import type {
  SessionDetail as SessionDetailType,
  AcquisitionSession,
} from '@/bindings/types';
import { Pill, Btn, Section } from '@/ui';
import { PropertyTable } from '@/components';
import type { PropertyDef } from '@/components';

const sessionStore = createParameterizedStore((id: string) =>
  getSession({ id }),
);

/** Wireframe fixture -- single session detail */
const FIXTURE_SESSION: SessionDetailType = {
  id: 'acq-a3f7-2b',
  session_key: { target: 'NGC 7000', filter: 'Ha', binning: '1', gain: '100', night: '2024-11-30' },
  state: 'confirmed',
  confidence: 'confirmed',
  optical_train_id: 'train-1',
  frame_count: 54,
  total_integration_seconds: 16200,
  total_size_bytes: 3_758_096_384,
  metadata: {
    target: { value: 'NGC 7000 (North America Nebula)', origin: 'reviewed', confidence: 'confirmed' },
    filter: { value: 'Ha (Optolong 7nm)', origin: 'observed', confidence: 'high' },
    binning: { value: '1x1', origin: 'observed', confidence: 'high' },
    gain: { value: '100', origin: 'observed', confidence: 'high' },
    night: { value: '2024-11-30 (local solar noon boundary)', origin: 'inferred', confidence: 'high' },
    optical_train: { value: 'AT130-EDT + 2600MM-Pro', origin: 'reviewed', confidence: 'confirmed' },
    camera: { value: 'ZWO ASI2600MM Pro', origin: 'observed', confidence: 'high' },
    telescope: { value: 'Astro-Tech AT130-EDT', origin: 'observed', confidence: 'high' },
    focal_length: { value: '910 mm (with 0.8x reducer)', origin: 'reviewed', confidence: 'confirmed' },
    exposure: { value: '300s x 54', origin: 'observed', confidence: 'high' },
    first_last: { value: '2024-11-30 03:48 -> 08:18', origin: 'observed', confidence: 'high' },
    avg_ccd_temp: { value: '-10.1 C (s 0.4)', origin: 'observed', confidence: 'high' },
  },
  target_ids: ['target-ngc7000'],
  project_ids: ['proj-ngc7000-hoo', 'proj-ngc7000-sho'],
  warnings: [],
  framesets: [{ filter: 'Ha', count: 54, integration_s: 16200 }],
  calibration_matches: [
    { master_id: 'm1', kind: 'dark', score: 0.92, soft_mismatches: [] },
    { master_id: 'm2', kind: 'flat', score: 0.88, soft_mismatches: [] },
    { master_id: 'm3', kind: 'bias', score: 0.71, soft_mismatches: ['age'] },
  ],
  history: [
    { timestamp: '2024-12-02T09:00:00Z', event: 'session.discovered', actor: 'system' },
    { timestamp: '2024-12-02T09:12:00Z', event: 'session.confirmed', actor: 'user' },
  ],
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatIntegration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function stateVariant(state: string) {
  switch (state) {
    case 'confirmed': return 'ok' as const;
    case 'needs_review': return 'warn' as const;
    case 'rejected': return 'danger' as const;
    default: return 'neutral' as const;
  }
}

function buildProperties(data: SessionDetailType): PropertyDef[] {
  const props: PropertyDef[] = [];

  for (const [key, meta] of Object.entries(data.metadata)) {
    const sourceMap: Record<string, PropertyDef['source']> = {
      reviewed: 'user',
      observed: 'fits',
      inferred: 'inferred',
      generated: 'default',
      planned: 'default',
      applied: 'default',
    };
    props.push({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: meta.value != null ? String(meta.value) : null,
      source: sourceMap[meta.origin] ?? 'default',
    });
  }

  return props;
}

// ─── Inline variant (rendered inside list-detail layout) ────────────────────

interface SessionDetailInlineProps {
  session: AcquisitionSession;
}

export function SessionDetailInline({ session }: SessionDetailInlineProps) {
  const [reopening, setReopening] = useState(false);

  const data: SessionDetailType = {
    ...FIXTURE_SESSION,
    ...session,
    framesets: FIXTURE_SESSION.framesets,
    calibration_matches: FIXTURE_SESSION.calibration_matches,
    history: FIXTURE_SESSION.history,
  };

  const handleReopen = async () => {
    setReopening(true);
    try {
      await transitionSession({ id: data.id, action: 'reopen' });
    } finally {
      setReopening(false);
    }
  };

  return (
    <SessionDetailContent
      data={data}
      onReopen={handleReopen}
      reopening={reopening}
    />
  );
}

// ─── Routed variant (standalone page at /sessions/:id) ─────────────────────

export function SessionDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: remoteData, loading, error } = useParameterizedQuery(sessionStore, id);
  const [reopening, setReopening] = useState(false);

  const data = remoteData ?? FIXTURE_SESSION;

  if (loading && !remoteData) return <div className="alm-page__loading">Loading session...</div>;
  if (error && !remoteData) return <div className="alm-page__error">Error: {error.message}</div>;

  const handleReopen = async () => {
    setReopening(true);
    try {
      await transitionSession({ id: data.id, action: 'reopen' });
      sessionStore.invalidate(data.id);
    } finally {
      setReopening(false);
    }
  };

  return (
    <div className="alm-page" data-testid="SessionDetail">
      <SessionDetailContent
        data={data}
        onReopen={handleReopen}
        reopening={reopening}
      />
    </div>
  );
}

// ─── Shared content ─────────────────────────────────────────────────────────

interface SessionDetailContentProps {
  data: SessionDetailType;
  onReopen: () => void;
  reopening: boolean;
}

function SessionDetailContent({
  data,
  onReopen,
  reopening,
}: SessionDetailContentProps) {
  const isInProject = data.project_ids.length > 0;
  const properties = buildProperties(data);

  return (
    <div className="alm-session-detail">
      {/* Header */}
      <header className="alm-session-detail__header">
        <div className="alm-session-detail__header-left">
          <h2 className="alm-session-detail__title">
            {data.session_key.target} &middot; {data.session_key.filter} &middot; {data.session_key.night}
          </h2>
          <Pill label={`${data.frame_count} frames`} variant="ghost" size="sm" />
          <Pill
            label={data.state === 'needs_review' ? 'needs review' : data.state}
            variant={stateVariant(data.state)}
            size="sm"
          />
        </div>
        <div className="alm-session-detail__header-actions">
          <Btn size="sm" onClick={onReopen} disabled={reopening}>
            {reopening ? 'Reopening...' : 'Re-open to review'}
          </Btn>
          <Btn size="sm" disabled={isInProject}>
            Move to Inbox
          </Btn>
          <Btn size="sm">Use in project</Btn>
        </div>
      </header>

      {/* Summary stats */}
      <div className="alm-session-detail__summary">
        <span className="alm-session-detail__stat">
          <span className="alm-session-detail__stat-label">Integration:</span>
          <span className="alm-mono">{formatIntegration(data.total_integration_seconds)}</span>
        </span>
        <span className="alm-session-detail__stat">
          <span className="alm-session-detail__stat-label">On disk:</span>
          <span className="alm-mono">{formatBytes(data.total_size_bytes)}</span>
        </span>
        <span className="alm-session-detail__stat">
          <span className="alm-session-detail__stat-label">Projects:</span>
          <span className="alm-mono">{data.project_ids.length}</span>
        </span>
      </div>

      {/* Unified property table */}
      <Section title="Metadata">
        <PropertyTable
          properties={properties}
          mode="view"
          showSource
        />
      </Section>

      {/* Calibration matches */}
      <Section title={`Calibration matches (${data.calibration_matches.length})`}>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Score</th>
              <th>Mismatches</th>
            </tr>
          </thead>
          <tbody>
            {data.calibration_matches.map((m, i) => (
              <tr key={i}>
                <td>{m.kind}</td>
                <td className="alm-mono">{(m.score * 100).toFixed(0)}%</td>
                <td>
                  {m.soft_mismatches.length > 0 ? m.soft_mismatches.join(', ') : 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Framesets */}
      <Section title={`Framesets (${data.framesets.length})`}>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>Filter</th>
              <th>Count</th>
              <th>Integration</th>
            </tr>
          </thead>
          <tbody>
            {data.framesets.map((f, i) => (
              <tr key={i}>
                <td>{f.filter}</td>
                <td className="alm-mono">{f.count}</td>
                <td className="alm-mono">{formatIntegration(f.integration_s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* History */}
      <Section title="History">
        <ul className="alm-timeline">
          {data.history.map((h, i) => (
            <li key={i} className="alm-timeline__entry">
              <span className="alm-timeline__time">
                {new Date(h.timestamp).toLocaleString()}
              </span>
              <span className="alm-timeline__event">{h.event}</span>
              <span className="alm-timeline__actor">{h.actor}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
