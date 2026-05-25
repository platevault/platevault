import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Tabs } from '@base-ui-components/react/tabs';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getSession, transitionSession } from '@/api/commands';
import type { SessionDetail as SessionDetailType, ProvenanceOrigin } from '@/api/types';
import { KV, Pill, Confidence, Provenance, Btn, Section } from '@/ui';

const sessionStore = createParameterizedStore((id: string) =>
  getSession({ id }),
);

type TabValue = 'overview' | 'framesets' | 'calibration' | 'projects' | 'history';

const TAB_ITEMS: Array<{ value: TabValue; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'framesets', label: 'Framesets' },
  { value: 'calibration', label: 'Calibration matches' },
  { value: 'projects', label: 'Linked projects' },
  { value: 'history', label: 'History' },
];

export function SessionDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, loading, error } = useParameterizedQuery(sessionStore, id);
  const [reopening, setReopening] = useState(false);

  if (loading) return <div className="alm-page__loading">Loading session...</div>;
  if (error) return <div className="alm-page__error">Error: {error.message}</div>;
  if (!data) return null;

  const isConfirmed = data.state === 'confirmed';

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
    <div className="alm-page">
      <header className="alm-detail-header">
        <h1 className="alm-detail-header__title">
          {data.session_key.target} — {data.session_key.filter}
        </h1>
        <Pill label={data.state} variant={data.state === 'confirmed' ? 'ok' : 'warn'} />
        {isConfirmed && (
          <Btn size="sm" variant="ghost" onClick={handleReopen} disabled={reopening}>
            {reopening ? 'Reopening...' : 'Re-open to review'}
          </Btn>
        )}
      </header>

      <Tabs.Root defaultValue="overview" className="alm-tabs-root">
        <Tabs.List className="alm-tabs" aria-label="Session tabs">
          {TAB_ITEMS.map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className="alm-tabs__tab"
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="overview" className="alm-detail-body">
          <OverviewTab data={data} />
        </Tabs.Panel>
        <Tabs.Panel value="framesets" className="alm-detail-body">
          <FramesetsTab data={data} />
        </Tabs.Panel>
        <Tabs.Panel value="calibration" className="alm-detail-body">
          <CalibrationTab data={data} />
        </Tabs.Panel>
        <Tabs.Panel value="projects" className="alm-detail-body">
          <ProjectsTab data={data} />
        </Tabs.Panel>
        <Tabs.Panel value="history" className="alm-detail-body">
          <HistoryTab data={data} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function OverviewTab({ data }: { data: SessionDetailType }) {
  const provenanceCounts = Object.values(data.metadata).reduce(
    (acc, v) => {
      acc[v.origin] = (acc[v.origin] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="alm-detail-overview">
      <Section title="Session Key">
        <KV label="Target" value={data.session_key.target} />
        <KV label="Filter" value={data.session_key.filter} />
        <KV label="Binning" value={data.session_key.binning} />
        <KV label="Gain" value={data.session_key.gain} />
        <KV label="Night" value={data.session_key.night} />
      </Section>

      <Section title="Metadata">
        {Object.entries(data.metadata).map(([key, mv]) => (
          <KV
            key={key}
            label={key}
            value={String(mv.value)}
            origin={mv.origin}
            confidence={mv.confidence}
          />
        ))}
      </Section>

      <Section title="Provenance Summary">
        <div className="alm-provenance-summary">
          {(['reviewed', 'inferred', 'observed', 'generated'] as ProvenanceOrigin[]).map(
            (origin) => (
              <div key={origin} className="alm-provenance-summary__item">
                <Provenance origin={origin} />
                <span>{provenanceCounts[origin] || 0}</span>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title="Stats">
        <KV label="Frames" value={data.frame_count} />
        <KV label="Integration" value={formatSeconds(data.total_integration_seconds)} />
        <KV label="Size" value={formatBytes(data.total_size_bytes)} />
        <KV label="Confidence" value={<Confidence level={data.confidence} />} />
      </Section>
    </div>
  );
}

function FramesetsTab({ data }: { data: SessionDetailType }) {
  return (
    <table className="alm-simple-table">
      <thead>
        <tr>
          <th>Filter</th>
          <th>Count</th>
          <th>Integration</th>
        </tr>
      </thead>
      <tbody>
        {data.framesets.map((fs, i) => (
          <tr key={i}>
            <td>{fs.filter}</td>
            <td>{fs.count}</td>
            <td>{formatSeconds(fs.integration_s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CalibrationTab({ data }: { data: SessionDetailType }) {
  return (
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
            <td>{(m.score * 100).toFixed(0)}%</td>
            <td>
              {m.soft_mismatches.length > 0
                ? m.soft_mismatches.join(', ')
                : 'None'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProjectsTab({ data }: { data: SessionDetailType }) {
  if (data.project_ids.length === 0) {
    return <p className="alm-empty">No linked projects</p>;
  }
  return (
    <div className="alm-detail-pills">
      {data.project_ids.map((pid) => (
        <Pill key={pid} label={pid.slice(0, 8)} variant="info" />
      ))}
    </div>
  );
}

function HistoryTab({ data }: { data: SessionDetailType }) {
  return (
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
  );
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
