import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getSession, transitionSession } from '@/api/commands';
import type { SessionDetail as SessionDetailType, ProvenanceOrigin, ConfidenceLevel } from '@/api/types';
import { KV, Pill, Confidence, Provenance, Btn, Box } from '@/ui';

const sessionStore = createParameterizedStore((id: string) =>
  getSession({ id }),
);

type TabValue = 'overview' | 'framesets' | 'calibration' | 'projects' | 'history';

/** Wireframe fixture — single session detail matching the wireframe exactly */
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
    binning: { value: '1×1', origin: 'observed', confidence: 'high' },
    gain: { value: '100', origin: 'observed', confidence: 'high' },
    night: { value: '2024-11-30 (local solar noon boundary)', origin: 'inferred', confidence: 'high' },
    optical_train: { value: 'AT130-EDT + 2600MM-Pro', origin: 'reviewed', confidence: 'confirmed' },
    camera: { value: 'ZWO ASI2600MM Pro', origin: 'observed', confidence: 'high' },
    telescope: { value: 'Astro-Tech AT130-EDT', origin: 'observed', confidence: 'high' },
    focal_length: { value: '910 mm (with 0.8× reducer)', origin: 'reviewed', confidence: 'confirmed' },
    observer_location: { value: 'Truckee, CA · 39.328°N, −120.183°W', origin: 'reviewed', confidence: 'confirmed' },
    timezone: { value: 'America/Los_Angeles', origin: 'inferred', confidence: 'high' },
    exposure: { value: '300s × 54', origin: 'observed', confidence: 'high' },
    first_last: { value: '2024-11-30 03:48 → 08:18', origin: 'observed', confidence: 'high' },
    avg_ccd_temp: { value: '−10.1 °C (σ 0.4)', origin: 'observed', confidence: 'high' },
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
  { file: 'Ha_300s_0001.fit', captured: '03:48', exposure: '300s', temp: '−10.0', hfr: '2.4', status: 'ok' as const },
  { file: 'Ha_300s_0002.fit', captured: '03:54', exposure: '300s', temp: '−10.0', hfr: '2.5', status: 'ok' as const },
  { file: 'Ha_300s_0003.fit', captured: '03:59', exposure: '300s', temp: '−10.1', hfr: '2.4', status: 'ok' as const },
  { file: 'Ha_300s_0021.fit', captured: '05:42', exposure: '300s', temp: '−10.2', hfr: '4.1', status: 'flagged' as const },
  { file: 'Ha_300s_0054.fit', captured: '08:18', exposure: '300s', temp: '−10.1', hfr: '2.6', status: 'ok' as const },
];

const CAL_MATCHES = [
  { kind: 'Master Dark', score: 0.92, conf: 'high' as ConfidenceLevel, decision: 'accepted' as const },
  { kind: 'Master Flat (Ha)', score: 0.88, conf: 'high' as ConfidenceLevel, decision: 'accepted' as const },
  { kind: 'Master Bias', score: 0.71, conf: 'medium' as ConfidenceLevel, decision: 'undecided' as const },
];

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

  const TABS: Array<{ value: TabValue; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'framesets', label: `Framesets (${data.frame_count})` },
    { value: 'calibration', label: `Calibration matches (${data.calibration_matches.length})` },
    { value: 'projects', label: `Linked projects (${data.project_ids.length})` },
    { value: 'history', label: 'History' },
  ];

  return (
    <div className="alm-page">
      {/* Toolbar with session info */}
      <div className="alm-toolbar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--alm-text-base)', fontWeight: 600 }}>
            NGC 7000 &middot; Ha &middot; 2024-11-30
          </span>
          <Pill label="DEEP SKY" variant="ghost" size="sm" />
          <Pill label="54 frames · 4.5h" variant="ghost" size="sm" />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" onClick={handleReopen} disabled={reopening}>
            {reopening ? 'Reopening...' : 'Re-open to review'}
          </Btn>
          <Btn size="sm">Split&hellip;</Btn>
          <Btn size="sm">Use in project &rarr;</Btn>
        </div>
      </div>

      {/* Sub-bar */}
      <div className="alm-toolbar__sub">
        <span>session id: <span className="alm-mono">acq_a3f7&hellip;2b</span></span>
        <span style={{ color: 'var(--alm-text-faint)' }}>&middot;</span>
        <span>created from scan #14 on 2024-12-02</span>
        <span style={{ marginLeft: 'auto' }}>
          <Pill label="CONFIRMED" variant="ok" size="sm" />
        </span>
      </div>

      {/* Two-column layout: main content + inspector sidebar */}
      <div className="alm-session-detail-grid">
        {/* Main content */}
        <div className="alm-session-detail-main">
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
          <div className="alm-session-detail-content">
            {activeTab === 'overview' && <OverviewContent data={data} />}
            {activeTab === 'framesets' && <FramesetsContent />}
            {activeTab === 'calibration' && <CalibrationContent data={data} />}
            {activeTab === 'projects' && <ProjectsContent data={data} />}
            {activeTab === 'history' && <HistoryContent data={data} />}
          </div>
        </div>

        {/* Inspector sidebar */}
        <div className="alm-session-detail-inspector">
          <div className="alm-session-detail-inspector__label">Linked</div>

          {/* Target */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>Target</div>
            <div className="alm-session-inspector-card">
              <div style={{ fontWeight: 600 }}>NGC 7000 &rarr;</div>
              <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                North America Nebula &middot; 12 sessions &middot; 14.2h total
              </div>
            </div>
          </div>

          {/* Calibration matches */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              Calibration matches
            </div>
            {CAL_MATCHES.map((c, i) => (
              <div key={i} className="alm-session-inspector-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 'var(--alm-text-sm)' }}>
                    {c.kind} &rarr;
                  </span>
                  <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)' }}>
                    {c.score.toFixed(2)}
                  </span>
                </div>
                <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Confidence level={c.conf} />
                  {c.decision === 'accepted'
                    ? <Pill label="accepted" variant="ok" size="sm" />
                    : <Pill label="undecided" variant="warn" size="sm" />
                  }
                </div>
              </div>
            ))}
          </div>

          {/* Used by projects */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              Used by projects
            </div>
            <div className="alm-session-inspector-card">
              <div style={{ fontWeight: 500 }}>NGC 7000 &middot; HOO &rarr;</div>
              <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                <Pill label="PROCESSING" variant="info" size="sm" /> &middot; selected as light source
              </div>
            </div>
            <div className="alm-session-inspector-card">
              <div style={{ fontWeight: 500 }}>NGC 7000 &middot; SHO mosaic &rarr;</div>
              <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                <Pill label="READY" variant="ghost" size="sm" /> &middot; panel 2 of 4
              </div>
            </div>
          </div>

          {/* Immutable note */}
          <div style={{
            marginTop: 14, paddingTop: 12,
            borderTop: '1px solid var(--alm-border-subtle)',
            fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)',
          }}>
            <div style={{ fontWeight: 500, color: 'var(--alm-text-secondary)' }}>Immutable</div>
            <div style={{ marginTop: 3 }}>
              Source identity is locked. Re-opening to review creates a new reviewed metadata
              record without rewriting history.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Overview Tab ---

function OverviewContent({ data }: { data: SessionDetailType }) {
  const sessionKeyMeta = [
    { k: 'Target', v: 'NGC 7000 (North America Nebula)', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Filter', v: 'Ha (Optolong 7nm)', prov: 'observed' as ProvenanceOrigin },
    { k: 'Binning', v: '1×1', prov: 'observed' as ProvenanceOrigin },
    { k: 'Gain', v: '100', prov: 'observed' as ProvenanceOrigin },
    { k: 'Night', v: '2024-11-30 (local solar noon boundary)', prov: 'inferred' as ProvenanceOrigin },
  ];

  const equipmentMeta = [
    { k: 'Optical train', v: 'AT130-EDT + 2600MM-Pro', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Camera', v: 'ZWO ASI2600MM Pro', prov: 'observed' as ProvenanceOrigin },
    { k: 'Telescope', v: 'Astro-Tech AT130-EDT', prov: 'observed' as ProvenanceOrigin },
    { k: 'Focal length', v: '910 mm (with 0.8× reducer)', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Observer location', v: 'Truckee, CA · 39.328°N, −120.183°W', prov: 'reviewed' as ProvenanceOrigin, conf: 'confirmed' as ConfidenceLevel },
    { k: 'Timezone', v: 'America/Los_Angeles', prov: 'inferred' as ProvenanceOrigin },
  ];

  const acqSummary = [
    { k: 'Frame count', v: '54 lights' },
    { k: 'Total integration', v: '4h 30m' },
    { k: 'Exposure', v: '300s × 54', prov: 'observed' as ProvenanceOrigin },
    { k: 'First / last', v: '2024-11-30 03:48 → 08:18', prov: 'observed' as ProvenanceOrigin },
    { k: 'Avg CCD temp', v: '−10.1 °C (σ 0.4)', prov: 'observed' as ProvenanceOrigin },
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
          value={<code className="alm-mono" style={{ fontSize: 10.5 }}>acq:ngc7000:Ha:1&times;1:g100:2024-11-30</code>}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--alm-space-3)', fontSize: 10.5, color: 'var(--alm-text-muted)' }}>
          &#9679; reviewed &nbsp; &#9680; inferred &nbsp; &#9675; observed
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 'var(--alm-text-xs)' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>11</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>&#9679; reviewed</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>3</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>&#9680; inferred</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>24</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>&#9675; observed</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--alm-warn)' }}>0</div>
            <div style={{ color: 'var(--alm-text-muted)' }}>&#9888; missing</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          Confirming requires <code className="alm-mono">observer_location</code> to be reviewed. &#10003; Satisfied.
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
                  <td><span style={{ color: 'var(--alm-text-faint)' }}>&middot;</span></td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{r.file}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{r.captured}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{r.exposure}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{r.temp}&deg;C</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{r.hfr}</td>
                  <td>
                    {r.status === 'flagged'
                      ? <Pill label="flagged" variant="warn" size="sm" />
                      : <Pill label="ok" variant="ghost" size="sm" />
                    }
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={7} style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
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
