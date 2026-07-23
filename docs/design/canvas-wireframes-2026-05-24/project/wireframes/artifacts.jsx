// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Processing artifacts + outputs — observed state of a project's processing workspace
function WfArtifacts() {
  const groups = [
    { type: 'Registered frames', count: 92, size: '11.4 GB', cleanup: 'eligible', conf: 'high', tool: 'PixInsight' },
    { type: 'Calibrated frames', count: 92, size: '11.4 GB', cleanup: 'eligible', conf: 'high', tool: 'PixInsight' },
    { type: 'Debayered frames', count: 0, size: '—', cleanup: '—', conf: '—', tool: '—' },
    { type: 'Local normalized', count: 92, size: '8.2 GB', cleanup: 'eligible', conf: 'high', tool: 'PixInsight' },
    { type: 'Drizzle data', count: 14, size: '880 MB', cleanup: 'eligible', conf: 'high', tool: 'PixInsight' },
    { type: 'Integration cache', count: 6, size: '420 MB', cleanup: 'eligible', conf: 'high', tool: 'PixInsight' },
    { type: 'Temporary files', count: 4, size: '256 MB', cleanup: 'eligible', conf: 'medium', tool: '?' },
    { type: 'Logs', count: 8, size: '4.2 MB', cleanup: 'archive', conf: 'high', tool: 'PixInsight' },
    { type: 'Process icons', count: 6, size: '12 KB', cleanup: 'keep', conf: 'high', tool: 'PixInsight', prot: true },
    { type: 'Tool project files (.pxi)', count: 1, size: '8 KB', cleanup: 'keep', conf: 'confirmed', tool: 'PixInsight', prot: true },
    { type: 'Manual notes (.md)', count: 2, size: '4 KB', cleanup: 'keep', conf: 'high', tool: '—', prot: true },
    { type: 'Unknown', count: 3, size: '1.2 MB', cleanup: '—', conf: 'low', tool: '?', warn: 'needs classification' },
  ];

  const outputs = [
    { name: 'NGC7000_final_v3.tif', kind: 'final image', size: '512 MB', dt: '2025-02-14', verif: 'accepted', prot: true },
    { name: 'NGC7000_final_v2.tif', kind: 'final image', size: '498 MB', dt: '2025-01-30', verif: 'superseded' },
    { name: 'NGC7000_review_starless.tif', kind: 'preview', size: '480 MB', dt: '2025-02-13', verif: 'unreviewed' },
    { name: 'NGC7000_drizzle3x.xisf', kind: 'drizzle result', size: '4.6 GB', dt: '2025-02-12', verif: 'unreviewed' },
  ];

  return (
    <AppFrame title="Artifacts & outputs · NGC 7000 · HOO" active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> NGC 7000 · HOO <Arr/> Artifacts & outputs</>}>
      <Toolbar sub={<><span>148 artifacts observed</span><span style={{ color: W.ink4 }}>·</span><span>last sweep 12 min ago</span><span style={{ color: W.ink4 }}>·</span><span>3 unknown items need review</span><span style={{ marginLeft: 'auto', color: W.ink4 }}>Files here are <b>observed, not owned</b> — the app never modifies them.</span></>}>
        <Btn small>Re-observe workspace</Btn>
        <Btn small>Classify unknowns…</Btn>
        <Btn small>Plan cleanup</Btn>
        <div style={{ flex: 1 }} />
        <Btn primary small>+ Record output</Btn>
      </Toolbar>

      <div style={{ padding: 14, position: 'relative' }}>
        <Section title="Outputs" sub="recorded final / intermediate results · verified manually" noPad
          right={<span style={{ fontSize: 11, color: W.ink3 }}>4 recorded · 1 accepted</span>}>
          <table>
            <thead><tr><th style={{ width: 26 }}></th><th>Filename</th><th style={{ width: 130 }}>Kind</th><th style={{ width: 80 }}>Size</th><th style={{ width: 100 }}>Recorded</th><th style={{ width: 110 }}>Verification</th><th></th></tr></thead>
            <tbody>
              {outputs.map((o, i) => (
                <tr key={i}>
                  <td>{o.prot && <Lock />}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{o.name}</td>
                  <td style={{ fontSize: 11 }}>{o.kind}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{o.size}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{o.dt}</td>
                  <td>
                    {o.verif === 'accepted' && <Pill variant="ok" size="xs">accepted</Pill>}
                    {o.verif === 'superseded' && <Pill variant="ghost" size="xs">superseded</Pill>}
                    {o.verif === 'unreviewed' && <Pill variant="warn" size="xs">unreviewed</Pill>}
                  </td>
                  <td style={{ textAlign: 'right' }}><Btn small>Verify…</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <div style={{ marginTop: 16 }}>
          <Section title="Processing artifacts" sub="grouped by artifact type · what the app observed in the project's processing workspace" noPad>
            <table>
              <thead>
                <tr>
                  <th>Artifact type</th>
                  <th style={{ width: 60 }}>Count</th>
                  <th style={{ width: 80 }}>Size</th>
                  <th style={{ width: 110 }}>Cleanup eligibility</th>
                  <th style={{ width: 100 }}>Confidence</th>
                  <th style={{ width: 110 }}>Tool</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {g.prot && <Lock />}
                        <b>{g.type}</b>
                        {g.warn && <span style={{ fontSize: 10.5, color: W.warn }}>⚠ {g.warn}</span>}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{g.count || <span style={{ color: W.ink4 }}>—</span>}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{g.size}</td>
                    <td>
                      {g.cleanup === 'eligible' && <Pill variant="warn" size="xs">eligible</Pill>}
                      {g.cleanup === 'archive' && <Pill variant="info" size="xs">archive</Pill>}
                      {g.cleanup === 'keep' && <Pill variant="ok" size="xs">keep</Pill>}
                      {g.cleanup === '—' && <span style={{ color: W.ink4 }}>—</span>}
                    </td>
                    <td>{g.conf !== '—' ? <Confidence level={g.conf} /> : <span style={{ color: W.ink4 }}>—</span>}</td>
                    <td style={{ fontSize: 11, color: W.ink2 }}>{g.tool}</td>
                    <td style={{ textAlign: 'right' }}><Btn small>List files →</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <Note side="left" x={16} y={40} width={190}>Artifacts are summarized by type so 148 files don't drown the user. Drill-down to individual files via "List files →".</Note>
      </div>
    </AppFrame>
  );
}
window.WfArtifacts = WfArtifacts;
