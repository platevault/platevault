// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// First-run setup — register library roots
function WfSetup() {
  const sources = [
    { cat: 'Raw sources', req: true, paths: ['D:\\Astrophotography\\Raw', 'E:\\Astro\\Lights'], note: 'where light frames live' },
    { cat: 'Calibration sources', req: false, paths: ['D:\\Astrophotography\\Calibration'], note: 'darks, flats, biases' },
    { cat: 'Project sources', req: true, paths: ['D:\\Astrophotography\\Projects'], note: 'processing projects' },
    { cat: 'Inbox sources', req: false, paths: [], note: 'new / unprocessed' },
  ];

  return (
    <div className={`wf comfortable`} style={{ width: '100%', height: '100%', background: W.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${W.rule}` }}>
      <div style={{ height: 28, background: '#d8d6d1', borderBottom: `1px solid ${W.rule}`, padding: '0 10px', display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0,1,2].map(i => <span key={i} style={{ width: 11, height: 11, borderRadius: 6, background: '#c8c6c1', border: `1px solid ${W.rule}` }} />)}
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: W.ink3 }}>Welcome to Astro Library Manager</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 28 }} className="wf-scroll">
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 11, color: W.ink3, letterSpacing: '.06em', textTransform: 'uppercase' }}>Setup · Step 2 of 4</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>Where does your astrophotography data live?</div>
          <div style={{ fontSize: 12.5, color: W.ink3, marginTop: 6, maxWidth: 540 }}>
            Add the folders the app should index. Nothing is moved or modified. You can add more later.
          </div>

          {/* progress bar */}
          <div style={{ display: 'flex', gap: 4, marginTop: 20 }}>
            {['Welcome','Sources','Scan settings','Confirm'].map((s, i) => (
              <div key={s} style={{ flex: 1, padding: '6px 8px', border: `1px solid ${W.rule}`, background: i <= 1 ? W.bg3 : W.bg, fontSize: 11, textAlign: 'center', color: i === 1 ? W.ink : W.ink3 }}>
                {i+1}. {s}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, position: 'relative' }}>
            {sources.map((src, i) => (
              <Box key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{src.cat}</div>
                  {src.req ? <Pill variant="warn" size="xs">REQUIRED</Pill> : <Pill variant="ghost" size="xs">OPTIONAL</Pill>}
                  <div style={{ fontSize: 11, color: W.ink3 }}>{src.note}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  {src.paths.length === 0 && (
                    <div style={{ padding: 12, border: `1px dashed ${W.rule}`, color: W.ink4, fontSize: 12, textAlign: 'center' }}>
                      No folders added
                    </div>
                  )}
                  {src.paths.map((p, j) => (
                    <div key={j} style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1 }}><DirPicker value={p} size="sm" /></div>
                      <span style={{ color: W.ink3, fontSize: 11 }}>~{[42, 12, 8, 0][i]}k files (est.)</span>
                      <Btn small>remove</Btn>
                    </div>
                  ))}
                  <Btn small>+ Add folder…</Btn>
                </div>
              </Box>
            ))}
            <Note side="left" x={16} y={20} width={200}>1. Sources are categorized so calibration & project material can be discovered separately.</Note>
            <Note side="left" x={16} y={170} width={200}>2. "Estimated" count is shown pre-scan to help user catch wrong folder picks early.</Note>
          </div>

          <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${W.rule}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Btn>← Back</Btn>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: W.ink3 }}>3 folders selected · ~62k files</div>
            <Btn primary>Continue to scan settings →</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
window.WfSetup = WfSetup;
