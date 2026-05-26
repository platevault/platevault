import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getSession, transitionSession } from '@/api/commands';
import type { SessionDetail as SessionDetailType, ProvenanceOrigin, ConfidenceLevel, AcquisitionSession } from '@/bindings/types';
import { KV, Pill, Confidence, Provenance, Btn, Box } from '@/ui';

const sessionStore = createParameterizedStore((id: string) =>
  getSession({ id }),
);

type TabValue = 'overview' | 'framesets' | 'calibration' | 'projects' | 'history';

/** Wireframe fixture -- single session detail matching the wireframe exactly */
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
    observer_location: { value: 'Truckee, CA', origin: 'reviewed', confidence: 'confirmed' },
    timezone: { value: 'America/Los_Angeles', origin: 'inferred', confidence: 'high' },
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

const FIXTURE_FRAMES = [
  { file: 'Ha_300s_0001.fit', captured: '03:48', exposure: '300s', temp: '-10.0', hfr: '2.4', status: 'ok' as const },
  { file: 'Ha_300s_0002.fit', captured: '03:54', exposure: '300s', temp: '-10.0', hfr: '2.5', status: 'ok' as const },
  { file: 'Ha_300s_0003.fit', captured: '03:59', exposure: '300s', temp: '-10.1', hfr: '2.4', status: 'ok' as const },
  { file: 'Ha_300s_0021.fit', captured: '05:42', exposure: '300s', temp: '-10.2', hfr: '4.1', status: 'flagged' as const },
  { file: 'Ha_300s_0054.fit', captured: '08:18', exposure: '300s', temp: '-10.1', hfr: '2.6', status: 'ok' as const },
];

// ─── Inline variant (rendered inside ThreePane center pane) ────────────────

interface SessionDetailInlineProps {
  session: AcquisitionSession;
}

export function SessionDetailInline({ session }: SessionDetailInlineProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('overview');
  const [reopening, setReopening] = useState(false);

  // Build a full detail object from the list-level session + fixture enrichment
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
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onReopen={handleReopen}
      reopening={reopening}
    />
  );
}

// ─── Routed variant (standalone page at /sessions/:id) ─────────────────────

export function SessionDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: remoteData, loading, error } = useParameterizedQuery(sessionStore, id);
  const [activeTab, setActiveTab] = useState<TabValue>('overview');
  const [reopening, setReopening] = useState(false);

  // Use fixture if no real data
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
    <div className="alm-page">
      <SessionDetailContent
        data={data}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onReopen={handleReopen}
        reopening={reopening}
        showToolbar
      />
    </div>
  );
}

// ─── Shared content renderer ───────────────────────────────────────────────

interface SessionDetailContentProps {
  data: SessionDetailType;
  activeTab: TabValue;
  setActiveTab: (tab: TabValue) => void;
  onReopen: () => void;
  reopening: boolean;
  /** When true, render the toolbar bar above the content (routed variant) */
  showToolbar?: boolean;
}

function SessionDetailContent({
  data,
  activeTab,
  setActiveTab,
  onReopen,
  reopening,
  showToolbar,
}: SessionDetailContentProps) {
  const TABS: Array<{ value: TabValue; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'framesets', label: `Framesets (${data.frame_count})` },
    { value: 'calibration', label: `Calibration (${data.calibration_matches.length})` },
    { value: 'projects', label: `Projects (${data.project_ids.length})` },
    { value: 'history', label: 'History' },
  ];

  return (
    <div className="alm-session-detail-inline">
      {/* Header */}
      <div className="alm-session-detail-inline__header">
        <div className="alm-session-detail-inline__header-left">
          <span className="alm-session-detail-inline__title">
            {data.session_key.target} &middot; {data.session_key.filter} &middot; {data.session_key.night}
          </span>
          <Pill label={`${data.frame_count} frames`} variant="ghost" size="sm" />
          <Pill
            label={data.state === 'needs_review' ? 'needs review' : data.state}
            variant={
              data.state === 'confirmed'
                ? 'ok'
                : data.state === 'needs_review'
                  ? 'warn'
                  : data.state === 'rejected'
                    ? 'danger'
                    : 'neutral'
            }
            size="sm"
          />
        </div>
        {showToolbar && (
          <div className="alm-session-detail-inline__header-actions">
            <Btn size="sm" onClick={onReopen} disabled={reopening}>
              {reopening ? 'Reopening...' : 'Re-open to review'}
            </Btn>
            <Btn size="sm">Split&hellip;</Btn>
            <Btn size="sm">Use in project &rarr;</Btn>
          </div>
        )}
      </div>

      {/* Sub-bar */}
      <div className="alm-session-detail-inline__sub">
        <span>
          id: <span className="alm-mono">{data.id.slice(0, 12)}&hellip;</span>
        </span>
        <span style={{ color: 'var(--alm-text-faint)' }}>&middot;</span>
        <Confidence level={data.confidence} />
      </div>

      {/* Tabs */}
      <div className="alm-tabs" style={{ paddingLeft: 0 }}>
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`alm-tabs__tab${activeTab === tab.value ? ' alm-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="alm-session-detail-inline__body">
        {activeTab === 'overview' && <OverviewContent data={data} />}
        {activeTab === 'framesets' && <FramesetsContent />}
        {activeTab === 'calibration' && <CalibrationContent data={data} />}
        {activeTab === 'projects' && <ProjectsContent data={data} />}
        {activeTab === 'history' && <HistoryContent data={data} />}
      </div>
    </div>
  );
}

// --- Overview Tab ---

function OverviewContent({ data }: { data: SessionDetailType }) {
  const sessionKeyMeta = [
    { k: 'Target', v: 'NGC 7000 (North America Nebula)', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Filter', v: 'Ha (Optolong 7nm)', prov: 'observed' as ProvenanceOrigin },
    { k: 'Binning', v: '1x1', prov: 'observed' as ProvenanceOrigin },
    { k: 'Gain', v: '100', prov: 'observed' as ProvenanceOrigin },
    { k: 'Night', v: '2024-11-30 (local solar noon boundary)', prov: 'inferred' as ProvenanceOrigin },
  ];

  const equipmentMeta = [
    { k: 'Optical train', v: 'AT130-EDT + 2600MM-Pro', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Camera', v: 'ZWO ASI2600MM Pro', prov: 'observed' as ProvenanceOrigin },
    { k: 'Telescope', v: 'Astro-Tech AT130-EDT', prov: 'observed' as ProvenanceOrigin },
    { k: 'Focal length', v: '910 mm (with 0.8x reducer)', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Observer location', v: 'Truckee, CA', prov: 'reviewed' as ProvenanceOrigin, conf: 'confirmed' as ConfidenceLevel },
    { k: 'Timezone', v: 'America/Los_Angeles', prov: 'inferred' as ProvenanceOrigin },
  ];

  const acqSummary = [
    { k: 'Frame count', v: '54 lights' },
    { k: 'Total integration', v: '4h 30m' },
    { k: 'Exposure', v: '300s x 54', prov: 'observed' as ProvenanceOrigin },
    { k: 'First / last', v: '2024-11-30 03:48 -> 08:18', prov: 'observed' as ProvenanceOrigin },
    { k: 'Avg CCD temp', v: '-10.1 C (s 0.4)', prov: 'observed' as ProvenanceOrigin },
    { k: 'Total size on disk', v: '3.50 GB' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Box heading="Session key">
        {sessionKeyMeta.map((m, i) => (
          <KV key={i} label={m.k} value={m.v} origin={m.prov} />
        ))}
        <KV
          label="Fingerprint"
          value={
            <code className="alm-mono" style={{ fontSize: 10.5 }}>
              acq:ngc7000:Ha:1x1:g100:2024-11-30
            </code>
          }
        />
      </Box>

      <Box heading="Equipment & site">
        {equipmentMeta.map((m, i) => (
          <KV key={i} label={m.k} value={m.v} origin={m.prov} confidence={m.conf} />
        ))}
      </Box>

      <Box heading="Acquisition summary">
        {acqSummary.map((m, i) => (
          <KV key={i} label={m.k} value={m.v} origin={m.prov} />
        ))}
      </Box>

      <Box heading="Provenance summary">
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 'var(--alm-space-3)',
            fontSize: 10.5,
            color: 'var(--alm-text-muted)',
          }}
        >
          reviewed &nbsp; inferred &nbsp; observed
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            fontSize: 'var(--alm-text-xs)',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>11</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>reviewed</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>3</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>inferred</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>24</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>observed</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--alm-warn)' }}>0</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>missing</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
          }}
        >
          Confirming requires <code className="alm-mono">observer_location</code> to be reviewed.
          Satisfied.
        </div>
      </Box>

      {/* Frames table spanning full width */}
      <div style={{ gridColumn: '1 / -1' }}>
        <Box heading="Frames (54)">
          <table className="alm-simple-table">
            <thead>
              <tr>
                <th style={{ width: 26 }}></th>
                <th>File</th>
                <th style={{ width: 80 }}>Captured</th>
                <th style={{ width: 60 }}>EXPTIME</th>
                <th style={{ width: 70 }}>CCD-TEMP</th>
                <th style={{ width: 60 }}>HFR</th>
                <th style={{ width: 70 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {FIXTURE_FRAMES.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ color: 'var(--alm-text-faint)' }}>&middot;</span>
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {r.file}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {r.captured}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {r.exposure}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {r.temp}&deg;C
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {r.hfr}
                  </td>
                  <td>
                    {r.status === 'flagged' ? (
                      <Pill label="flagged" variant="warn" size="sm" />
                    ) : (
                      <Pill label="ok" variant="ghost" size="sm" />
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td
                  colSpan={7}
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text-muted)',
                  }}
                >
                  &hellip; 49 more
                </td>
              </tr>
            </tbody>
          </table>
        </Box>
      </div>
    </div>
  );
}

// --- Framesets Tab ---

function FramesetsContent() {
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
        <tr>
          <td>Ha</td>
          <td>54</td>
          <td>4h 30m</td>
        </tr>
      </tbody>
    </table>
  );
}

// --- Calibration Tab ---

function CalibrationContent({ data }: { data: SessionDetailType }) {
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
              {m.soft_mismatches.length > 0 ? m.soft_mismatches.join(', ') : 'None'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Projects Tab ---

function ProjectsContent({ data }: { data: SessionDetailType }) {
  if (data.project_ids.length === 0) {
    return <p className="alm-empty">No linked projects</p>;
  }
  return (
    <div className="alm-detail-pills">
      {data.project_ids.map((pid) => (
        <Pill key={pid} label={pid.slice(0, 16)} variant="info" />
      ))}
    </div>
  );
}

// --- History Tab ---

function HistoryContent({ data }: { data: SessionDetailType }) {
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
