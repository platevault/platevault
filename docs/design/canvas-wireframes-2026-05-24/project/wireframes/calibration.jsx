// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Calibration — masters as primary content, with details and project linkage.
// Three-pane: masters list (left), selected master detail (right), with calibration sessions as a tab.
function WfCalibration() {
  const masters = [
    { id: 'm-1', name: 'MasterDark_300s_-10C_g100', kind: 'dark', exp: '300s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 4, age: '23d', conf: 'confirmed', focus: true, size: '128 MB' },
    { id: 'm-2', name: 'MasterDark_180s_-10C_g100', kind: 'dark', exp: '180s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 3, projects: 6, age: '23d', conf: 'confirmed', size: '128 MB' },
    { id: 'm-3', name: 'MasterDark_120s_-10C_g100', kind: 'dark', exp: '120s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 1, projects: 2, age: '60d', conf: 'high', size: '128 MB' },
    { id: 'm-4', name: 'MasterDark_300s_-10C_g100_MC', kind: 'dark', exp: '300s', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 1, projects: 1, age: '90d', conf: 'high', warn: 'aging', size: '128 MB' },
    { id: 'm-5', name: 'MasterFlat_Ha_2024-12', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 2, age: '8d', conf: 'confirmed', size: '128 MB' },
    { id: 'm-6', name: 'MasterFlat_OIII_2024-12', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 2, age: '8d', conf: 'confirmed', size: '128 MB' },
    { id: 'm-7', name: 'MasterFlat_Ha_2024-11', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 4, projects: 1, age: '37d', conf: 'confirmed', size: '128 MB' },
    { id: 'm-8', name: 'MasterFlat_OIII_2024-11', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 3, projects: 1, age: '37d', conf: 'confirmed', size: '128 MB' },
    { id: 'm-9', name: 'MasterFlat_L_2024-10', kind: 'flat', exp: '2s', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 8, projects: 2, age: '50d', conf: 'high', size: '128 MB' },
    { id: 'm-10', name: 'MasterBias_g100', kind: 'bias', exp: '—', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 18, projects: 12, age: '180d', conf: 'high', warn: 'aging', size: '64 MB' },
    { id: 'm-11', name: 'MasterBias_g100_MC', kind: 'bias', exp: '—', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 8, projects: 3, age: '180d', conf: 'high', warn: 'aging', size: '64 MB' },
  ];

  const focus = masters.find(m => m.focus);

  const listPane = (
    <div>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${W.rule2}` }}>
        <div style={{ fontWeight: 600, color: W.ink2, fontSize: 12 }}>Calibration masters</div>
        <div style={{ marginTop: 2, fontSize: 10.5, color: W.ink3 }}>{masters.length} masters · 4 darks · 5 flats · 2 bias</div>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${W.rule2}`, display: 'flex', gap: 4 }}>
        <select style={{ flex: 1, padding: '3px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}>
          <option>Group: kind</option>
          <option>Group: camera</option>
          <option>Group: age</option>
          <option>Group: none</option>
        </select>
      </div>
      {['dark', 'flat', 'bias'].map(kind => (
        <React.Fragment key={kind}>
          <div style={{ padding: '4px 12px', background: W.bg3, fontSize: 10.5, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>
            {kind === 'dark' ? 'Darks' : kind === 'flat' ? 'Flats' : 'Bias'}
          </div>
          {masters.filter(m => m.kind === kind).map(m => (
            <div key={m.id} style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: m.focus ? W.bg3 : 'transparent', borderLeft: `2px solid ${m.focus ? W.ink : 'transparent'}`, cursor: 'pointer' }}>
              <div className="mono" style={{ fontSize: 10.5, color: m.focus ? W.ink : W.ink2, fontWeight: m.focus ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
              <div style={{ marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: W.ink3 }}>
                <span className="mono">{m.exp} · g{m.gain}</span>
                <span>{m.cam.replace('ASI', '')}</span>
                {m.warn && <span style={{ color: W.warn, marginLeft: 'auto' }}>⚠ {m.age}</span>}
              </div>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <AppFrame title="Calibration" active="calibration" navOverride="three-pane" listPane={listPane}
      breadcrumb={<>Calibration <Arr/> Masters <Arr/> {focus.name}</>}>
      <Toolbar sub={<><span>11 masters tracked · 5 darks · 4 flats · 2 bias</span><span style={{ color: W.ink4 }}>·</span><span>2 masters older than 90d</span><span style={{ marginLeft: 'auto', color: W.ink4 }}>Masters are tracked, not produced — generate them in PixInsight</span></>}>
        <Btn small active>Masters</Btn>
        <Btn small>Calibration sessions</Btn>
        <Btn small>Match candidates</Btn>
        <div style={{ flex: 1 }} />
        <Btn small>Import master…</Btn>
        <Btn small>Re-run matching</Btn>
      </Toolbar>

      <div style={{ padding: 14, position: 'relative' }}>
        {/* Detail header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <Lock />
          <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{focus.name}</div>
          <Pill variant="info" size="xs">MASTER · DARK</Pill>
          <Confidence level={focus.conf} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Btn small>Reveal in Explorer</Btn>
            <Btn small>Use in project →</Btn>
            <Btn small>Mark superseded</Btn>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: W.ink3, marginTop: 4 }} className="mono">
          D:\Astrophotography\Calibration\masters\{focus.name}.xisf · {focus.size} · created from cal-sess #14
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Box title="Compatibility fingerprint">
            <KV k="Frame type" v="dark" prov="reviewed" />
            <KV k="Exposure" v={focus.exp} prov="observed" />
            <KV k="Sensor temperature" v={focus.temp + ' (σ 0.4)'} prov="observed" />
            <KV k="Gain" v={focus.gain} prov="observed" />
            <KV k="Offset" v="10" prov="observed" />
            <KV k="Binning" v="1×1" prov="observed" />
            <KV k="Camera" v={focus.cam} prov="reviewed" />
            <KV k="Sensor mode" v="Mono" prov="inferred" />
          </Box>

          <Box title="Provenance">
            <KV k="Source session" v={<a>cal-sess #14 · 50 darks → master</a>} prov="reviewed" />
            <KV k="Created" v="2025-01-30 02:14" prov="observed" />
            <KV k="Created in" v="PixInsight 1.8.9 · ImageIntegration" prov="observed" />
            <KV k="Imported by" v="user · scan #14" prov="reviewed" />
            <KV k="Age" v={focus.age + ' (still within 90d window)'} prov="generated" />
            <KV k="Hash" v={<span className="mono" style={{ fontSize: 10 }}>sha256:a3f7…2bd1</span>} />
          </Box>

          <Box title="Usage">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
              <div><div style={{ fontSize: 22, fontWeight: 600 }} className="mono">{focus.sessions}</div><div style={{ color: W.ink3 }}>acquisition sessions matched</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600 }} className="mono">{focus.projects}</div><div style={{ color: W.ink3 }}>projects use this master</div></div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: W.ink3 }}>Last used by project:</div>
            <div className="mono" style={{ fontSize: 11 }}>NGC 7000 · HOO</div>
            <Btn small style={{ marginTop: 8 }}>See all usage →</Btn>
          </Box>
        </div>

        {/* Used by projects */}
        <div style={{ marginTop: 16 }}>
          <Section title="Linked to projects" sub="acquisition sessions whose project source map includes this master" right={<Btn small>+ Add to project…</Btn>} noPad>
            <table>
              <thead><tr><th>Project</th><th>Workflow profile</th><th>Lifecycle</th><th>Role</th><th>Selected by</th><th>Selected at</th></tr></thead>
              <tbody>
                <tr><td><b>NGC 7000 · HOO</b></td><td>PixInsight/WBPP</td><td><Pill variant="info" size="xs">processing</Pill></td><td>dark (lights)</td><td style={{ fontSize: 11 }}>auto-match (score 0.92)</td><td className="mono" style={{ fontSize: 11 }}>2024-12-02</td></tr>
                <tr><td><b>NGC 7000 · SHO mosaic</b></td><td>PixInsight/WBPP</td><td><Pill variant="ghost" size="xs">ready</Pill></td><td>dark (lights)</td><td style={{ fontSize: 11 }}>auto-match (score 0.92)</td><td className="mono" style={{ fontSize: 11 }}>2024-12-18</td></tr>
                <tr><td><b>IC 1396 · HOO</b></td><td>PixInsight/WBPP</td><td><Pill variant="info" size="xs">prepared</Pill></td><td>dark (lights)</td><td style={{ fontSize: 11 }}>user override</td><td className="mono" style={{ fontSize: 11 }}>2024-09-22</td></tr>
                <tr><td><b>M42 · HOO</b></td><td>PixInsight/WBPP</td><td><Pill variant="ghost" size="xs">ready</Pill></td><td>dark (lights)</td><td style={{ fontSize: 11 }}>auto-match (score 0.88)</td><td className="mono" style={{ fontSize: 11 }}>2024-12-12</td></tr>
              </tbody>
            </table>
          </Section>
        </div>

        {/* Matching sessions */}
        <div style={{ marginTop: 16 }}>
          <Section title="Compatible acquisition sessions" sub="sessions whose fingerprint matches this master (score ≥ 0.6)" right={<Btn small>Match all →</Btn>} noPad>
            <table>
              <thead><tr><th></th><th>Session</th><th>Frames</th><th>Score</th><th>Soft mismatches</th><th>Decision</th><th></th></tr></thead>
              <tbody>
                {[
                  ['NGC 7000 · Ha · 2024-11-30', 54, 0.92, '—', 'accepted'],
                  ['NGC 7000 · OIII · 2024-11-30', 38, 0.92, '—', 'accepted'],
                  ['NGC 7000 · SII · 2024-12-01', 22, 0.91, '—', 'undecided'],
                  ['NGC 7000 · Ha · 2024-12-15', 30, 0.88, '−10.3°C vs −10°C (Δ 0.3)', 'undecided'],
                  ['IC 1396 · Ha · 2024-09-18', 72, 0.85, 'temperature stability', 'accepted'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td style={{ width: 24 }}>{r[3] >= 0.9 ? <span style={{ color: W.ok }}>✓</span> : <span style={{ color: W.warn }}>~</span>}</td>
                    <td><b>{r[0]}</b></td>
                    <td className="mono" style={{ fontSize: 11 }}>{r[1]}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{r[2].toFixed(2)}</td>
                    <td style={{ fontSize: 11, color: r[3] === '—' ? W.ink4 : W.warn }}>{r[3]}</td>
                    <td>{r[4] === 'accepted' ? <Pill variant="ok" size="xs">accepted</Pill> : <Pill variant="warn" size="xs">undecided</Pill>}</td>
                    <td style={{ textAlign: 'right' }}><Btn small>Override…</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <Note side="left" x={16} y={40} width={190}>No matrix. Pick a master on the left, see its details, fingerprint, and every session/project it's linked to. Mirror view on a session shows the same data from the other side.</Note>
      </div>
    </AppFrame>
  );
}
window.WfCalibration = WfCalibration;
