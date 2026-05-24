// Density study — same screen rendered at 3 densities. Wraps in custom frame, not AppFrame, so 3 fit side-by-side.

function _MiniSessionTable({ density }) {
  const rows = [
    ['NGC 7000', 'Ha', '2024-11-30', 54, '4.5h', '2600MM', 'confirmed'],
    ['NGC 7000', 'OIII', '2024-11-30', 38, '3.2h', '2600MM', 'confirmed'],
    ['NGC 7000', 'SII', '2024-12-01', 22, '1.8h', '2600MM', 'needs_review'],
    ['M31', 'L', '2024-10-04', 60, '2.5h', '2600MC', 'confirmed'],
    ['M31', 'L', '2024-10-05', 48, '2.0h', '2600MC', 'confirmed'],
    ['IC 1396', 'Ha', '2024-09-18', 72, '6.0h', '2600MM', 'confirmed'],
    ['IC 1396', 'OIII', '2024-09-19', 40, '3.3h', '2600MM', 'discovered'],
  ];

  return (
    <div className={`wf ${density}`} style={{ background: W.bg, border: `1px solid ${W.rule}`, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule}`, background: W.bg2 }}>
        <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em' }}>{density}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>Sessions · 7 of 247</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th style={{ width: 50 }}>Filter</th>
              <th style={{ width: 80 }}>Night</th>
              <th style={{ width: 55 }}>Frames</th>
              <th style={{ width: 50 }}>Integ.</th>
              <th>Train</th>
              <th style={{ width: 100 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><b>{r[0]}</b></td>
                <td><Pill variant="ghost" size="xs">{r[1]}</Pill></td>
                <td className="mono">{r[2]}</td>
                <td className="mono">{r[3]}</td>
                <td className="mono">{r[4]}</td>
                <td style={{ fontSize: 11 }}>{r[5]}</td>
                <td>
                  {r[6] === 'confirmed' && <Pill variant="ok" size="xs">confirmed</Pill>}
                  {r[6] === 'needs_review' && <Pill variant="warn" size="xs">needs review</Pill>}
                  {r[6] === 'discovered' && <Pill variant="ghost" size="xs">discovered</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '6px 12px', borderTop: `1px solid ${W.rule2}`, background: W.bg2, fontSize: 10.5, color: W.ink3, display: 'flex' }}>
        <span>row height: {density === 'compact' ? '24px' : density === 'spacious' ? '40px' : '32px'}</span>
        <span style={{ marginLeft: 'auto' }}>visible: {density === 'compact' ? '~24 rows' : density === 'spacious' ? '~11 rows' : '~16 rows'} per screen</span>
      </div>
    </div>
  );
}

function WfDensityStudy() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f0eee9' }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid #d4d4d2`, background: '#fafaf8' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Density study · Sessions list</div>
        <div style={{ fontSize: 11.5, color: '#6a6a6a', marginTop: 2 }}>The same data at three densities. Choose by user preference (settings) and override per-context with the toolbar density toggle.</div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: 12, minHeight: 0 }}>
        <_MiniSessionTable density="compact" />
        <_MiniSessionTable density="comfortable" />
        <_MiniSessionTable density="spacious" />
      </div>
    </div>
  );
}
window.WfDensityStudy = WfDensityStudy;
