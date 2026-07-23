// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Project Detail — 3 variations, all using sidebar nav, with view-toggle between them.
// A: Command center (kit-grid source map + summary panels)
// B: Pipeline view (sources → views → processing → outputs)
// C: Combined — source map + pipeline together on one page

const PROJ = {
  name: 'NGC 7000 · HOO',
  profile: 'PixInsight/WBPP',
  state: 'processing',
  root: 'D:\\Astrophotography\\Projects\\NGC7000_HOO',
  targets: ['NGC 7000 (primary)'],
  sources: [
    { role: 'light', name: 'NGC 7000 · Ha · 2024-11-30', frames: 54, hrs: '4.5h', sel: 'selected' },
    { role: 'light', name: 'NGC 7000 · OIII · 2024-11-30', frames: 38, hrs: '3.2h', sel: 'selected' },
    { role: 'light', name: 'NGC 7000 · Ha · 2024-12-15', frames: 30, hrs: '2.5h', sel: 'candidate' },
    { role: 'dark', name: 'MasterDark_300s_-10C_g100', frames: 1, hrs: '—', sel: 'selected' },
    { role: 'flat', name: 'MasterFlat_Ha_2024-11', frames: 1, hrs: '—', sel: 'selected' },
    { role: 'flat', name: 'MasterFlat_OIII_2024-11', frames: 1, hrs: '—', sel: 'selected' },
    { role: 'bias', name: 'MasterBias_g100', frames: 1, hrs: '—', sel: 'candidate' },
  ],
};
window.PROJ = PROJ;

function _ProjectHeader({ view }) {
  return (
    <Toolbar sub={<><span className="mono">{PROJ.root}</span><span style={{ color: W.ink4 }}>·</span><span>created 2024-12-02 · plan #18 applied · 47 audit entries</span><span style={{ marginLeft: 'auto' }}>NGC 7000 (primary) · {PROJ.profile}</span></>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{PROJ.name}</span>
        <Pill variant="info" size="xs">PROCESSING</Pill>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', border: `1px solid ${W.rule}`, borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ padding: '3px 10px', fontSize: 11, background: view === 'center' ? W.ink2 : W.bg, color: view === 'center' ? W.bg : W.ink2, borderRight: `1px solid ${W.rule}`, cursor: 'pointer' }}>Command center</span>
        <span style={{ padding: '3px 10px', fontSize: 11, background: view === 'pipeline' ? W.ink2 : W.bg, color: view === 'pipeline' ? W.bg : W.ink2, borderRight: `1px solid ${W.rule}`, cursor: 'pointer' }}>Pipeline</span>
        <span style={{ padding: '3px 10px', fontSize: 11, background: view === 'combined' ? W.ink2 : W.bg, color: view === 'combined' ? W.bg : W.ink2, cursor: 'pointer' }}>Combined</span>
      </div>
      <Btn small>Source views…</Btn>
      <Btn small>Observe artifacts</Btn>
      <Btn small>Record output…</Btn>
      <Btn small>Generate plan ▾</Btn>
    </Toolbar>
  );
}

// Kit grid: shared between command center and combined variants
function _KitGrid({ compact }) {
  const Col = ({ title, count, children }) => (
    <div style={{ border: `1px solid ${W.rule}`, background: W.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', background: W.bg2, borderBottom: `1px solid ${W.rule2}`, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: W.ink4, marginLeft: 'auto' }}>{count}</span>
      </div>
      <div style={{ padding: 6, flex: 1 }}>{children}</div>
    </div>
  );

  const Card = ({ title, meta, sel, warn }) => (
    <div style={{ border: `1px solid ${sel === 'selected' ? W.ink2 : W.rule}`, padding: compact ? 4 : 6, marginBottom: 4, background: sel === 'selected' ? W.bg : W.bg2, opacity: sel === 'candidate' ? 0.85 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" defaultChecked={sel === 'selected'} style={{ margin: 0 }} />
        <div style={{ fontSize: 11, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      </div>
      <div style={{ marginTop: 2, fontSize: 10, color: W.ink3, marginLeft: 18 }} className="mono">{meta}</div>
      {warn && <div style={{ marginTop: 1, fontSize: 10, color: W.warn, marginLeft: 18 }}>⚠ {warn}</div>}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      <Col title="Lights" count="3 sess · 10.2h">
        <Card title="Ha · 2024-11-30" meta="54× 300s · 4.5h" sel="selected" />
        <Card title="OIII · 2024-11-30" meta="38× 300s · 3.2h" sel="selected" />
        <Card title="Ha · 2024-12-15" meta="30× 300s · 2.5h" sel="candidate" warn="newer, review" />
        <Btn small style={{ width: '100%', marginTop: 4 }}>+ Add session</Btn>
      </Col>
      <Col title="Darks" count="1 master">
        <Card title="MasterDark 300s" meta="g100 · −10°C · 23d" sel="selected" />
        <Btn small style={{ width: '100%', marginTop: 4 }}>+ Add master</Btn>
      </Col>
      <Col title="Flats" count="2 masters">
        <Card title="MasterFlat Ha" meta="2024-11 · 12d" sel="selected" />
        <Card title="MasterFlat OIII" meta="2024-11 · 12d" sel="selected" />
        <div style={{ padding: 4, border: `1px dashed ${W.warn}`, background: '#f8f1d8', color: W.warn, fontSize: 10, marginTop: 2 }}>
          ⚠ no SII flat — add later if SII session linked
        </div>
        <Btn small style={{ width: '100%', marginTop: 4 }}>+ Add master</Btn>
      </Col>
      <Col title="Bias" count="1 candidate">
        <Card title="MasterBias g100" meta="180d old · soft mismatch" sel="candidate" warn="age > 90d" />
        <Btn small style={{ width: '100%', marginTop: 4 }}>+ Add master</Btn>
      </Col>
    </div>
  );
}

// Pipeline strip: shared between pipeline and combined variants
function _PipelineStrip({ compact }) {
  const Stage = ({ title, state, children, right, flex = 1 }) => (
    <div style={{ flex, border: `1px solid ${W.rule}`, background: W.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '5px 10px', borderBottom: `1px solid ${W.rule2}`, background: W.bg2, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: W.ink2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</span>
        {state}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: W.ink3 }}>{right}</span>
      </div>
      <div style={{ padding: compact ? 6 : 10, flex: 1, fontSize: 11 }}>{children}</div>
    </div>
  );

  const Arrow = () => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}>
      <div style={{ width: 16, height: 1, background: W.ink3, position: 'relative' }}>
        <div style={{ position: 'absolute', right: -4, top: -3, width: 0, height: 0, borderLeft: `5px solid ${W.ink3}`, borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }} />
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <Stage title="① Sources" right="3 sess · 10.2h" state={<Pill variant="ok" size="xs">selected</Pill>}>
        <div style={{ color: W.ink3, fontSize: 10, textTransform: 'uppercase' }}>Lights</div>
        <div>Ha 11-30 · 54×</div>
        <div>OIII 11-30 · 38×</div>
        <div style={{ color: W.warn }}>Ha 12-15 · 30× (cand)</div>
        <div style={{ marginTop: 6, color: W.ink3, fontSize: 10, textTransform: 'uppercase' }}>Calibration</div>
        <div>Dark 300s · Flat Ha · Flat OIII · Bias</div>
      </Stage>
      <Arrow />
      <Stage title="② Source views" right="92 links" state={<Pill variant="ok" size="xs">applied</Pill>}>
        <div className="mono" style={{ fontSize: 10.5 }}>wbpp_input/</div>
        <div style={{ fontSize: 10, color: W.ink3 }}>NTFS junction · plan #18</div>
        <div className="mono" style={{ fontSize: 10.5, marginTop: 4 }}>wbpp_input_p2/</div>
        <div style={{ fontSize: 10, color: W.ink3 }}>symlink · plan #21</div>
      </Stage>
      <Arrow />
      <Stage title="③ Processing" right="148 artifacts" state={<Pill variant="info" size="xs">observed</Pill>}>
        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>registered</span><span className="mono" style={{ color: W.ink3 }}>11.4 GB</span></div>
        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>calibrated</span><span className="mono" style={{ color: W.ink3 }}>11.4 GB</span></div>
        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>drizzle</span><span className="mono" style={{ color: W.ink3 }}>880 MB</span></div>
        <div style={{ display: 'flex' }}><span style={{ flex: 1 }}>logs / icons</span><span className="mono" style={{ color: W.ink3 }}>4 MB</span></div>
      </Stage>
      <Arrow />
      <Stage title="④ Outputs" right="1 verified" state={<Pill variant="ok" size="xs">accepted</Pill>}>
        <div style={{ padding: 5, background: W.bg2, border: `1px solid ${W.rule2}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock />
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 500 }}>NGC7000_final_v3.tif</div>
            <div style={{ fontSize: 10, color: W.ink3 }}>512 MB · 2025-02-14</div>
          </div>
        </div>
      </Stage>
    </div>
  );
}

// --- A: Command center ---
function WfProjectDetailA() {
  return (
    <AppFrame title={`Project · ${PROJ.name}`} active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> {PROJ.name} <Arr/> Command center</>}>
      <_ProjectHeader view="center" />
      <div style={{ padding: 14, position: 'relative' }}>
        {/* The kit — source map as columns by role */}
        <Section title="Source map" sub="kit view — each role is a column. Drag sessions between columns to change roles." right={<><span style={{ fontSize: 11, color: W.ink3 }}>92 links</span><Btn small>Re-run cal matching</Btn></>} noPad>
          <_KitGrid />
        </Section>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <Box title="Source views (2)">
            <KV k="wbpp_input/" v="92 junctions · plan #18" />
            <KV k="wbpp_input_p2/" v="92 symlinks · plan #21" />
            <Btn small style={{ marginTop: 6 }}>+ New view</Btn>
          </Box>
          <Box title="Processing artifacts (148)">
            <KV k="registered" v="92 files · 11.4 GB · cleanup-eligible" />
            <KV k="calibrated" v="92 files · 11.4 GB · cleanup-eligible" />
            <KV k="drizzle" v="14 files · 880 MB · cleanup-eligible" />
            <KV k="logs / icons" v="14 files · 4 MB · keep" />
          </Box>
          <Box title="Outputs (1 verified)">
            <div style={{ padding: 6, border: `1px solid ${W.rule2}`, background: W.bg2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lock />
              <div style={{ flex: 1 }}>
                <div className="mono" style={{ fontSize: 11, fontWeight: 500 }}>NGC7000_final_v3.tif</div>
                <div style={{ fontSize: 10, color: W.ink3 }}>512 MB · 2025-02-14</div>
              </div>
              <Pill variant="ok" size="xs">accepted</Pill>
            </div>
            <Btn small style={{ marginTop: 6 }}>+ Record output</Btn>
          </Box>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <Box title="Lifecycle">
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
              {['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'].map((s, i) => (
                <React.Fragment key={s}>
                  <span style={{ padding: '3px 8px', background: i <= 3 ? W.ink2 : W.bg2, color: i <= 3 ? W.bg : W.ink3, border: `1px solid ${W.rule}`, fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
                  {i < 5 && <span style={{ color: W.ink4 }}>→</span>}
                </React.Fragment>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: W.ink3 }}>To complete: record outputs → mark accepted. To archive: requires plan (at minimum manifest write).</div>
          </Box>
          <Box title="Cleanup">
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>2.1 GB</div>
            <div style={{ fontSize: 11, color: W.ink3 }}>reclaimable using global policy</div>
            <Btn small style={{ marginTop: 6 }}>Plan cleanup →</Btn>
            <div style={{ marginTop: 4, fontSize: 10.5, color: W.ink3 }}><a>Edit global policy in Settings →</a></div>
          </Box>
        </div>

        <Note side="left" x={16} y={40} width={190}>A · Command center. Kit-grid source map + summary panels. Sidebar nav, consistent with the rest of the app.</Note>
      </div>
    </AppFrame>
  );
}

// --- B: Pipeline view ---
function WfProjectDetailB() {
  return (
    <AppFrame title={`Project · ${PROJ.name}`} active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> {PROJ.name} <Arr/> Pipeline</>}>
      <_ProjectHeader view="pipeline" />
      <div style={{ padding: 14, position: 'relative' }}>
        <Section title="Project pipeline" sub="follow the data: sources → tool-friendly views → processing → outputs">
          <_PipelineStrip />
        </Section>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
          <Box title="Lifecycle">
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
              {['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'].map((s, i) => (
                <React.Fragment key={s}>
                  <span style={{ padding: '3px 8px', background: i <= 3 ? W.ink2 : W.bg2, color: i <= 3 ? W.bg : W.ink3, border: `1px solid ${W.rule}` }}>{s}</span>
                  {i < 5 && <span style={{ color: W.ink4 }}>→</span>}
                </React.Fragment>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: W.ink3 }}>1 attempt · audited 47 events · cleanup not yet run</div>
          </Box>
          <Box title="Cleanup">
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>2.1 GB</div>
            <div style={{ fontSize: 11, color: W.ink3 }}>reclaimable</div>
            <Btn small style={{ marginTop: 6 }}>Plan cleanup →</Btn>
          </Box>
          <Box title="Manifests">
            <KV k="project.json" v="current" />
            <KV k="sources.json" v="current" />
            <KV k="audit.jsonl" v="47 entries" />
          </Box>
        </div>

        <Note side="left" x={16} y={60} width={190}>B · Pipeline. Best for spotting where things stall. Click any stage to drill in.</Note>
      </div>
    </AppFrame>
  );
}

// --- C: Combined — source map + pipeline together ---
function WfProjectDetailC() {
  return (
    <AppFrame title={`Project · ${PROJ.name}`} active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> {PROJ.name} <Arr/> Overview (source + pipeline)</>}>
      <_ProjectHeader view="combined" />
      <div style={{ padding: 14, position: 'relative' }}>
        <Section title={<>Source map <PinNum n={3} /></>} sub="what feeds the pipeline" right={<><span style={{ fontSize: 11, color: W.ink3 }}>3 lights · 4 cal masters</span><Btn small>Re-run cal matching</Btn></>} noPad>
          <_KitGrid compact />
        </Section>

        {/* Connector: visual flow from sources DOWN to pipeline */}
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <PinNum n={2} />
          <div style={{ width: 1, height: 16, background: W.ink3, position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: -4, left: -3, width: 0, height: 0, borderTop: `5px solid ${W.ink3}`, borderLeft: '4px solid transparent', borderRight: '4px solid transparent' }} />
          </div>
        </div>

        <Section title={<>Pipeline <PinNum n={4} /></>} sub="flow of data through the project after sources are selected" right={<span style={{ fontSize: 11, color: W.ink3 }}>2 views · 148 artifacts · 1 output</span>}>
          <_PipelineStrip compact />
        </Section>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
          <Box title={<>Lifecycle <PinNum n={5} /></>}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
              {['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'].map((s, i) => (
                <React.Fragment key={s}>
                  <span style={{ padding: '3px 8px', background: i <= 3 ? W.ink2 : W.bg2, color: i <= 3 ? W.bg : W.ink3, border: `1px solid ${W.rule}`, fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
                  {i < 5 && <span style={{ color: W.ink4 }}>→</span>}
                </React.Fragment>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: W.ink3 }}>To complete: record outputs → mark accepted. To archive: requires plan (at minimum manifest write).</div>
          </Box>
          <Box title="Cleanup">
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>2.1 GB</div>
            <div style={{ fontSize: 11, color: W.ink3 }}>reclaimable</div>
            <Btn small style={{ marginTop: 6 }}>Plan cleanup →</Btn>
          </Box>
          <Box title="Notes & manifests">
            <KV k="Notes" v="2 markdown files" />
            <KV k="Manifests" v="3 current · 0 stale" />
            <KV k="Audit" v="47 events" />
          </Box>
        </div>

        <Note n={1} side="left" x={16} y={20} width={210}>View toggle <b>persists per project</b>. Three variants share the same toolbar + actions.</Note>
        <Note n={3} side="left" x={16} y={140} width={210}>Kit grid: 4 role columns. Drag a session between columns to change its role.</Note>
        <Note n={4} side="left" x={16} y={360} width={210}>Same data as the kit, in flow shape. Click any stage to drill into the detail.</Note>
      </div>
    </AppFrame>
  );
}

window.WfProjectDetailA = WfProjectDetailA;
window.WfProjectDetailB = WfProjectDetailB;
window.WfProjectDetailC = WfProjectDetailC;
