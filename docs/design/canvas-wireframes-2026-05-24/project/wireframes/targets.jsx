// Targets — list + detail (single page covers both with selected target visible)
function WfTargets() {
  const targets = [
    { name: 'NGC 7000', alias: 'North America Nebula', cat: 'NGC 7000, C 20', kind: 'deep sky', sess: 12, hrs: '14.2h', proj: 2, filt: ['Ha', 'OIII', 'SII'] },
    { name: 'M31', alias: 'Andromeda Galaxy', cat: 'M 31, NGC 224', kind: 'deep sky', sess: 8, hrs: '11.8h', proj: 1, filt: ['L', 'R', 'G', 'B'] },
    { name: 'IC 1396', alias: 'Elephant\'s Trunk', cat: 'IC 1396', kind: 'deep sky', sess: 4, hrs: '9.3h', proj: 1, filt: ['Ha', 'OIII'] },
    { name: 'Jupiter', alias: '', cat: '—', kind: 'planetary', sess: 6, hrs: '2.5h', proj: 1, filt: ['—'] },
    { name: 'M42', alias: 'Orion Nebula', cat: 'M 42, NGC 1976', kind: 'deep sky', sess: 5, hrs: '3.4h', proj: 0, filt: ['Ha'] },
    { name: '(unresolved)', alias: '', cat: '—', kind: '?', sess: 3, hrs: '4.2h', proj: 0, filt: ['Ha'], warn: true },
  ];

  return (
    <AppFrame title="Targets" active="targets" navOverride="three-pane"
      breadcrumb={<>Targets <Arr/> NGC 7000 <Arr/> Overview</>}
      listPane={
        <div>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}` }}>
            <input placeholder="Search targets…" style={{ width: '100%', padding: '3px 6px', border: `1px solid ${W.rule}`, fontSize: 11 }} />
          </div>
          {targets.map((t, i) => (
            <div key={i} style={{ padding: '7px 12px', borderBottom: `1px solid ${W.rule2}`, background: i === 0 ? W.bg3 : 'transparent', borderLeft: `2px solid ${i === 0 ? W.ink : 'transparent'}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: i === 0 ? 600 : 500, fontSize: 12, flex: 1 }}>{t.name}</span>
                {t.warn && <span style={{ color: W.warn, fontSize: 10 }}>⚠</span>}
              </div>
              {t.alias && <div style={{ fontSize: 10.5, color: W.ink3 }}>{t.alias}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 10.5, color: W.ink3 }}>
                <span>{t.sess} sess</span>·<span>{t.hrs}</span>·<span>{t.proj} proj</span>
              </div>
            </div>
          ))}
          <div style={{ padding: '8px 12px', fontSize: 10.5, color: W.ink3, borderTop: `1px solid ${W.rule2}` }}>+ new target</div>
        </div>
      }>
      {/* Target detail */}
      <div style={{ padding: 14, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>NGC 7000</div>
          <div style={{ fontSize: 13, color: W.ink3 }}>North America Nebula</div>
          <Pill variant="ghost" size="xs">DEEP SKY</Pill>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Btn small>Edit aliases…</Btn>
            <Btn small>Link plan…</Btn>
            <Btn primary small>New project →</Btn>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14 }}>
          <div>
            <Box title="Identity">
              <KV k="Primary name" v="NGC 7000" prov="reviewed" />
              <KV k="Aliases" v="North America Nebula, Caldwell 20" prov="reviewed" />
              <KV k="Catalog IDs" v="NGC 7000 · C 20" />
              <KV k="Kind" v="Deep sky · emission nebula" prov="reviewed" />
              <KV k="RA / Dec" v="20h 59m / +44° 31′" prov="inferred" />
              <KV k="Constellation" v="Cygnus" prov="inferred" />
            </Box>

            <div style={{ marginTop: 14 }}>
              <Box title="Coverage at a glance">
                <div style={{ fontSize: 11, color: W.ink3, marginBottom: 6 }}>integration hours by filter</div>
                {[['Ha', 6.3, 100], ['OIII', 4.8, 76], ['SII', 1.8, 28], ['L', 0, 0]].map(([f, h, p]) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, marginBottom: 4 }}>
                    <span style={{ width: 24 }}>{f}</span>
                    <span style={{ flex: 1, height: 8, background: W.rule2 }}>
                      <span style={{ display: 'block', width: `${p}%`, height: '100%', background: W.ink2 }} />
                    </span>
                    <span className="mono" style={{ width: 40, textAlign: 'right', color: W.ink2 }}>{h}h</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 11, color: W.warn }}>⚠ SII coverage below recommended for SHO (target: 3h+)</div>
              </Box>
            </div>

            <div style={{ marginTop: 14 }}>
              <Box title="Observing plans">
                <div style={{ fontSize: 11.5 }}>
                  <div style={{ padding: '4px 0', borderBottom: `1px dotted ${W.rule2}` }}>
                    <span style={{ color: W.ink4 }}>📄</span> NGC7000_SHO_plan.nina
                    <div style={{ fontSize: 10.5, color: W.ink3, marginLeft: 16 }}>NINA · linked 2024-11-29</div>
                  </div>
                  <div style={{ padding: '4px 0' }}>
                    <span style={{ color: W.ink4 }}>📄</span> NGC7000_panel_2.nina
                    <div style={{ fontSize: 10.5, color: W.ink3, marginLeft: 16 }}>NINA · linked 2024-12-15</div>
                  </div>
                </div>
                <Btn small style={{ marginTop: 6 }}>+ Link plan file</Btn>
              </Box>
            </div>
          </div>

          <div>
            <Section title="Sessions" sub="12 acquisition sessions · 14.2h total" right={<Btn small>Open sessions view →</Btn>} noPad>
              <table>
                <thead><tr><th>Night</th><th>Filter</th><th>Frames</th><th>Integ.</th><th>Train</th><th>State</th><th>In project</th></tr></thead>
                <tbody>
                  {[
                    ['2024-11-30', 'Ha', 54, '4.5h', '2600MM', 'confirmed', 'HOO'],
                    ['2024-11-30', 'OIII', 38, '3.2h', '2600MM', 'confirmed', 'HOO'],
                    ['2024-12-01', 'SII', 22, '1.8h', '2600MM', 'needs_review', '—'],
                    ['2024-12-15', 'Ha', 30, '2.5h', '2600MM', 'confirmed', 'SHO mosaic p2'],
                  ].map((r, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: 11 }}>{r[0]}</td>
                      <td><Pill variant="ghost" size="xs">{r[1]}</Pill></td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[2]}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r[3]}</td>
                      <td style={{ fontSize: 11 }}>{r[4]}</td>
                      <td>{r[5] === 'confirmed' ? <Pill variant="ok" size="xs">confirmed</Pill> : <Pill variant="warn" size="xs">needs review</Pill>}</td>
                      <td style={{ fontSize: 11 }}>{r[6] === '—' ? <span style={{ color: W.ink4 }}>—</span> : r[6]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <div style={{ marginTop: 14 }}>
              <Section title="Projects" sub="2 projects use NGC 7000 data" noPad>
                <table>
                  <thead><tr><th>Project</th><th>Profile</th><th>Lifecycle</th><th>Sessions</th><th>Outputs</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><b>NGC 7000 · HOO</b></td>
                      <td>PixInsight/WBPP</td>
                      <td><Pill variant="info" size="xs">processing</Pill></td>
                      <td className="mono" style={{ fontSize: 11 }}>2</td>
                      <td>1 accepted</td>
                    </tr>
                    <tr>
                      <td><b>NGC 7000 · SHO mosaic</b></td>
                      <td>PixInsight/WBPP</td>
                      <td><Pill variant="ghost" size="xs">ready</Pill></td>
                      <td className="mono" style={{ fontSize: 11 }}>3 / 4 panels</td>
                      <td>—</td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            </div>

            <div style={{ marginTop: 14 }}>
              <Box title="Outputs (across all projects)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {['final v3', 'final v2', 'review'].map((label, i) => (
                    <div key={i} style={{ border: `1px solid ${W.rule}`, background: W.bg2, padding: 0 }}>
                      <div style={{ aspectRatio: '16 / 10', background: `repeating-linear-gradient(45deg, ${W.bg2}, ${W.bg2} 6px, ${W.bg3} 6px, ${W.bg3} 12px)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: W.ink3, fontSize: 11 }} className="mono">final output</div>
                      <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ flex: 1 }}>{label}</span>
                        {i === 0 ? <Pill variant="ok" size="xs">accepted</Pill> : <Pill variant="ghost" size="xs">unreviewed</Pill>}
                      </div>
                    </div>
                  ))}
                </div>
              </Box>
            </div>
          </div>
        </div>

        <Note side="left" x={16} y={20} width={190}>Target is the planning anchor — "what data do I have / what's missing?" lives here, not on projects.</Note>
      </div>
    </AppFrame>
  );
}
window.WfTargets = WfTargets;
