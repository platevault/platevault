// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Review queue — session-centric. Walk through sessions that need review, not individual files.
function WfReviewQueue() {
  const queue = [
    { id: 'sess-7', label: 'NGC 7000 · SII · 2024-12-01', conf: 'low', reason: 'observer_location not reviewed', focus: true, kind: 'acquisition' },
    { id: 'sess-12', label: '(unresolved) · 2024-12-08', conf: 'low', reason: 'OBJECT keyword missing on all 22 frames', kind: 'acquisition' },
    { id: 'sess-14', label: 'NGC 7000 · Ha · 2024-12-15', conf: 'medium', reason: 'new night — confirm equipment train', kind: 'acquisition' },
    { id: 'sess-15', label: 'NGC 7000 · OIII · 2024-12-15', conf: 'medium', reason: 'new night — confirm equipment train', kind: 'acquisition' },
    { id: 'cal-22', label: 'Calibration: Flats Ha · 2024-12-14', conf: 'medium', reason: 'temperature drift across frames', kind: 'calibration' },
    { id: 'sess-31', label: 'M42 · Ha · 2024-12-10', conf: 'medium', reason: 'session spans two nights — split?', kind: 'acquisition' },
  ];

  const listPane = (
    <div>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${W.rule2}` }}>
        <div style={{ fontWeight: 600, color: W.ink2, fontSize: 12 }}>Sessions to review</div>
        <div style={{ marginTop: 2, fontSize: 10.5, color: W.ink3 }}>42 acquisition · 6 calibration</div>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${W.rule2}` }}>
        <select style={{ width: '100%', padding: '3px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}>
          <option>Sorted: confidence ↑</option>
          <option>Sorted: date ↓</option>
          <option>Sorted: target</option>
        </select>
      </div>
      {queue.map((q, i) => (
        <div key={q.id} style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: q.focus ? W.bg3 : 'transparent', borderLeft: `2px solid ${q.focus ? W.ink : 'transparent'}`, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill variant={q.kind === 'calibration' ? 'info' : 'ghost'} size="xs">{q.kind === 'calibration' ? 'cal' : 'acq'}</Pill>
            <span style={{ fontSize: 11.5, color: q.focus ? W.ink : W.ink2, fontWeight: q.focus ? 600 : 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.label}</span>
          </div>
          <div style={{ marginTop: 3 }}><Confidence level={q.conf} /></div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: W.ink3 }}>↳ {q.reason}</div>
        </div>
      ))}
    </div>
  );

  return (
    <AppFrame title="Review queue" active="review" navOverride="three-pane" listPane={listPane}
      breadcrumb={<>Review queue <Arr/> Session 1 of 48 <Arr/> NGC 7000 · SII · 2024-12-01</>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100%' }}>
        {/* Focus pane */}
        <div style={{ padding: 14, borderRight: `1px solid ${W.rule}`, overflow: 'auto' }} className="wf-scroll">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>NGC 7000 · SII · 2024-12-01</div>
            <Pill variant="warn" size="xs">NEEDS REVIEW</Pill>
            <Pill variant="ghost" size="xs">acquisition session</Pill>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: W.ink3 }}>← K / J → · ⌘1 confirm · ⌘2 reject · ⌘S split</span>
          </div>
          <div style={{ fontSize: 11.5, color: W.ink3, marginTop: 2 }}>22 frames · 1.8h integration · AT130-EDT + 2600MM Pro · derived from 22 FITS files in D:\…\Raw\2024-12-01\NGC7000\</div>

          {/* What's blocking */}
          <div style={{ marginTop: 14, padding: 12, background: '#f8f1d8', border: `1px solid ${W.warn}` }}>
            <div style={{ fontWeight: 600, color: W.warn, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚠</span>Confirmation blocked
            </div>
            <div style={{ fontSize: 11.5, marginTop: 4, color: W.ink2 }}>
              <span className="mono">observer_location</span> needs reviewed provenance before this session can be marked confirmed. Currently inferred from FITS sitelong/sitelat headers.
            </div>
            <Btn small style={{ marginTop: 8 }}>Review location →</Btn>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Box title="Session key (derived)">
              <KV k="Target" v="NGC 7000" prov="reviewed" />
              <KV k="Filter" v="SII (Optolong 7nm)" prov="observed" />
              <KV k="Binning" v="1×1" prov="observed" />
              <KV k="Gain" v="100" prov="observed" />
              <KV k="Night" v="2024-12-01 (local solar noon)" prov="inferred" />
              <KV k="Optical train" v="AT130-EDT + 2600MM" prov="reviewed" />
            </Box>

            <Box title="Equipment & site">
              <KV k="Camera" v="ZWO ASI2600MM Pro" prov="observed" />
              <KV k="Telescope" v="AT130-EDT" prov="observed" />
              <KV k="Focal length" v="910 mm" prov="reviewed" />
              <KV k="Observer location" v={<span style={{ color: W.warn }}>Truckee, CA (inferred from SITELAT/SITELONG)</span>} prov="inferred" conf="medium" />
              <KV k="Timezone" v="America/Los_Angeles" prov="inferred" />
            </Box>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Box title="Frames summary (22)">
              <div style={{ fontSize: 11.5 }}>
                <div style={{ padding: '3px 0', display: 'flex', borderBottom: `1px dotted ${W.rule2}` }}><span style={{ flex: 1 }}>Time span</span><span className="mono">03:11 → 05:02</span></div>
                <div style={{ padding: '3px 0', display: 'flex', borderBottom: `1px dotted ${W.rule2}` }}><span style={{ flex: 1 }}>EXPTIME (consistent)</span><span className="mono">300 s × 22</span></div>
                <div style={{ padding: '3px 0', display: 'flex', borderBottom: `1px dotted ${W.rule2}` }}><span style={{ flex: 1 }}>CCD-TEMP range</span><span className="mono">−10.0 → −10.3 °C</span></div>
                <div style={{ padding: '3px 0', display: 'flex', borderBottom: `1px dotted ${W.rule2}` }}><span style={{ flex: 1 }}>HFR mean / max</span><span className="mono">2.7 / 4.4</span></div>
                <div style={{ padding: '3px 0', display: 'flex' }}><span style={{ flex: 1 }}>Frames flagged</span><span className="mono" style={{ color: W.warn }}>1 (HFR &gt; 4.0)</span></div>
              </div>
              <Btn small style={{ marginTop: 6 }}>View frame stats →</Btn>
            </Box>

            <Box title="What about calibration?">
              <div style={{ fontSize: 11.5 }}>
                <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex', alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>Master Dark 300s</span>
                  <Pill variant="ok" size="xs">match</Pill>
                </div>
                <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex', alignItems: 'center' }}>
                  <span style={{ flex: 1, color: W.danger }}>Master Flat SII</span>
                  <Pill variant="danger" size="xs">none in library</Pill>
                </div>
                <div style={{ padding: '3px 0', display: 'flex', alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>Master Bias</span>
                  <Pill variant="ok" size="xs">match</Pill>
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: W.warn }}>⚠ This session cannot be fully calibrated until SII flats are captured.</div>
            </Box>
          </div>
        </div>

        {/* Decision panel */}
        <div style={{ padding: 14, background: W.bg2, overflow: 'auto' }} className="wf-scroll">
          <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em' }}>Decisions</div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500 }}>Lifecycle</div>
            <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
              <Btn primary>Confirm ⌘1</Btn>
              <Btn>Reject ⌘2</Btn>
              <Btn>Skip (review later) ⌘3</Btn>
              <Btn small style={{ marginTop: 6 }}>Re-open existing confirmation</Btn>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500 }}>Corrections</div>
            <Btn small style={{ marginTop: 6, width: '100%' }}>Reassign target…</Btn>
            <Btn small style={{ marginTop: 4, width: '100%' }}>Reassign optical train…</Btn>
            <Btn small style={{ marginTop: 4, width: '100%' }}>Split this session…</Btn>
            <Btn small style={{ marginTop: 4, width: '100%' }}>Merge with another…</Btn>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500 }}>Notes</div>
            <textarea placeholder="Optional notes for future reviewers…" style={{ width: '100%', minHeight: 50, marginTop: 4, padding: 6, border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11.5, fontFamily: 'inherit' }} />
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${W.rule2}`, fontSize: 11, color: W.ink3 }}>
            <div style={{ fontWeight: 500, color: W.ink2 }}>Queue progress</div>
            <div style={{ marginTop: 4, height: 6, background: W.rule2 }}>
              <div style={{ width: '4%', height: '100%', background: W.ink2 }} />
            </div>
            <div style={{ marginTop: 3 }}>2 reviewed · 46 remaining</div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
window.WfReviewQueue = WfReviewQueue;
