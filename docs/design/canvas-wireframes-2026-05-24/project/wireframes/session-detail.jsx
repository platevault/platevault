// Session detail — single acquisition session with provenance, framesets, cal matches, linked projects
function WfSessionDetail() {
  return (
    <AppFrame title="Session · NGC 7000 · Ha · 2024-11-30" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> NGC 7000 <Arr/> Ha · 2024-11-30 (54 frames)</>}>
      <Toolbar sub={<><span>session id: <span className="mono">acq_a3f7…2b</span></span><span style={{ color: W.ink4 }}>·</span><span>created from scan #14 on 2024-12-02</span><span style={{ marginLeft: 'auto' }}><Pill variant="ok" size="xs">CONFIRMED</Pill></span></>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>NGC 7000 · Ha · 2024-11-30</span>
          <Pill variant="ghost" size="xs">DEEP SKY</Pill>
          <Pill variant="ghost" size="xs">54 frames · 4.5h</Pill>
        </div>
        <div style={{ flex: 1 }} />
        <Btn small>Re-open to review</Btn>
        <Btn small>Split…</Btn>
        <Btn small>Use in project →</Btn>
      </Toolbar>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, height: 'calc(100% - 80px)' }}>
        <div style={{ padding: 14, overflow: 'auto', borderRight: `1px solid ${W.rule}` }} className="wf-scroll">

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${W.rule}`, marginBottom: 14 }}>
            {['Overview', 'Framesets (54)', 'Calibration matches (3)', 'Linked projects (2)', 'History'].map((t, i) => (
              <div key={t} style={{ padding: '6px 14px', borderBottom: `2px solid ${i === 0 ? W.ink : 'transparent'}`, fontSize: 12, color: i === 0 ? W.ink : W.ink3, cursor: 'pointer', marginBottom: -1 }}>{t}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Box title={<>Session key <PinNum n={3} /></>}>
              <KV k="Target" v="NGC 7000 (North America Nebula)" prov="reviewed" />
              <KV k="Filter" v="Ha (Optolong 7nm)" prov="observed" />
              <KV k="Binning" v="1×1" prov="observed" />
              <KV k="Gain" v="100" prov="observed" />
              <KV k="Night" v="2024-11-30 (local solar noon boundary)" prov="inferred" />
              <KV k="Fingerprint" v={<span className="mono" style={{ fontSize: 10.5 }}>acq:ngc7000:Ha:1×1:g100:2024-11-30</span>} />
            </Box>

            <Box title={<>Equipment & site <PinNum n={4} /></>}>
              <KV k="Optical train" v="AT130-EDT + 2600MM-Pro" prov="reviewed" />
              <KV k="Camera" v="ZWO ASI2600MM Pro" prov="observed" />
              <KV k="Telescope" v="Astro-Tech AT130-EDT" prov="observed" />
              <KV k="Focal length" v="910 mm (with 0.8× reducer)" prov="reviewed" />
              <KV k="Observer location" v="Truckee, CA · 39.328°N, −120.183°W" prov="reviewed" conf="confirmed" />
              <KV k="Timezone" v="America/Los_Angeles" prov="inferred" />
            </Box>

            <Box title="Acquisition summary">
              <KV k="Frame count" v="54 lights" />
              <KV k="Total integration" v="4h 30m" />
              <KV k="Exposure" v="300s × 54" prov="observed" />
              <KV k="First / last" v="2024-11-30 03:48 → 08:18" prov="observed" />
              <KV k="Avg CCD temp" v="−10.1 °C (σ 0.4)" prov="observed" />
              <KV k="Total size on disk" v="3.50 GB" />
            </Box>

            <Box title={<>Provenance summary <PinNum n={5} /></>} right={<span style={{ fontSize: 10.5, color: W.ink3 }}>● reviewed  ◐ inferred  ○ observed</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11 }}>
                <div><div style={{ fontSize: 18, fontWeight: 600 }}>11</div><div style={{ color: W.ink3 }}>● reviewed</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600 }}>3</div><div style={{ color: W.ink3 }}>◐ inferred</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600 }}>24</div><div style={{ color: W.ink3 }}>○ observed</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 600, color: W.warn }}>0</div><div style={{ color: W.ink3 }}>⚠ missing</div></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: W.ink3 }}>Confirming requires <span className="mono">observer_location</span> to be reviewed. ✓ Satisfied.</div>
            </Box>
          </div>

          <div style={{ marginTop: 14 }}>
            <Box title={<>Frames (54) <PinNum n={6} /></>} right={<Btn small>View all in inventory →</Btn>}>
              <table>
                <thead><tr><th style={{ width: 26 }}></th><th>File</th><th style={{ width: 80 }}>Captured</th><th style={{ width: 60 }}>EXPTIME</th><th style={{ width: 70 }}>CCD-TEMP</th><th style={{ width: 60 }}>HFR</th><th style={{ width: 70 }}>Status</th></tr></thead>
                <tbody>
                  {[
                    ['Ha_300s_0001.fit', '03:48', '300s', '−10.0', '2.4', 'ok'],
                    ['Ha_300s_0002.fit', '03:54', '300s', '−10.0', '2.5', 'ok'],
                    ['Ha_300s_0003.fit', '03:59', '300s', '−10.1', '2.4', 'ok'],
                    ['Ha_300s_0021.fit', '05:42', '300s', '−10.2', '4.1', 'flagged'],
                    ['Ha_300s_0054.fit', '08:18', '300s', '−10.1', '2.6', 'ok'],
                  ].map((r, i) => (
                    <tr key={i}>
                      <td><span style={{ color: W.ink4 }}>·</span></td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[0]}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[1]}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[2]}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[3]}°C</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[4]}</td>
                      <td>{r[5] === 'flagged' ? <Pill variant="warn" size="xs">flagged</Pill> : <Pill variant="ghost" size="xs">ok</Pill>}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={7} style={{ fontSize: 11, color: W.ink3 }}>… 49 more</td></tr>
                </tbody>
              </table>
            </Box>
          </div>
        </div>

        {/* Inspector */}
        <div style={{ padding: 14, background: W.bg2, overflow: 'auto' }} className="wf-scroll">
          <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em' }}>Linked</div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, color: W.ink3 }}>Target</div>
            <div style={{ marginTop: 4, padding: 8, background: W.bg, border: `1px solid ${W.rule}` }}>
              <div style={{ fontWeight: 600 }}>NGC 7000 →</div>
              <div style={{ fontSize: 11, color: W.ink3 }}>North America Nebula · 12 sessions · 14.2h total</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, color: W.ink3 }}>Calibration matches <PinNum n={7} /></div>
            {[
              { kind: 'Master Dark', score: 0.92, conf: 'high', dec: 'accepted' },
              { kind: 'Master Flat (Ha)', score: 0.88, conf: 'high', dec: 'accepted' },
              { kind: 'Master Bias', score: 0.71, conf: 'medium', dec: 'undecided' },
            ].map((c, i) => (
              <div key={i} style={{ marginTop: 4, padding: 8, background: W.bg, border: `1px solid ${W.rule}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 12 }}>{c.kind} →</span>
                  <span className="mono" style={{ fontSize: 11, color: W.ink2 }}>{c.score.toFixed(2)}</span>
                </div>
                <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Confidence level={c.conf} />
                  {c.dec === 'accepted' ? <Pill variant="ok" size="xs">accepted</Pill> : <Pill variant="warn" size="xs">undecided</Pill>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, color: W.ink3 }}>Used by projects <PinNum n={8} /></div>
            <div style={{ marginTop: 4, padding: 8, background: W.bg, border: `1px solid ${W.rule}` }}>
              <div style={{ fontWeight: 500 }}>NGC 7000 · HOO →</div>
              <div style={{ fontSize: 11, color: W.ink3 }}><Pill variant="info" size="xs">PROCESSING</Pill> · selected as light source</div>
            </div>
            <div style={{ marginTop: 4, padding: 8, background: W.bg, border: `1px solid ${W.rule}` }}>
              <div style={{ fontWeight: 500 }}>NGC 7000 · SHO mosaic →</div>
              <div style={{ fontSize: 11, color: W.ink3 }}><Pill variant="ghost" size="xs">READY</Pill> · panel 2 of 4</div>
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${W.rule2}`, fontSize: 11, color: W.ink3 }}>
            <div style={{ fontWeight: 500, color: W.ink2 }}>Immutable <PinNum n={9} /></div>
            <div style={{ marginTop: 3 }}>Source identity is locked. Re-opening to review creates a new reviewed metadata record without rewriting history.</div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
window.WfSessionDetail = WfSessionDetail;
