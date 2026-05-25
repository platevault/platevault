// Settings — multi-page. Shared shell that picks one of several panes.

const SETTINGS_CATS = [
  { id: 'sources', label: 'Data sources' },
  { id: 'ingest', label: 'Ingestion & review' },
  { id: 'naming', label: 'Naming & structure' },
  { id: 'views', label: 'Source view strategy' },
  { id: 'cal', label: 'Calibration matching' },
  { id: 'tools', label: 'Tool workflows' },
  { id: 'catalogs', label: 'Target catalogs' },
  { id: 'protect', label: 'Source protection' },
  { id: 'cleanup', label: 'Cleanup & archive' },
  { id: 'log', label: 'Application log' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'adv', label: 'Advanced / developer' },
];

function _SettingsShell({ activeId, title, sub, children, breadcrumb }) {
  return (
    <AppFrame title="Settings" active="settings" navOverride="sidebar"
      breadcrumb={breadcrumb || <>Settings <Arr/> {SETTINGS_CATS.find(c => c.id === activeId)?.label}</>}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100%' }}>
        <div style={{ borderRight: `1px solid ${W.rule}`, background: W.bg2, padding: '6px 0', overflow: 'auto' }} className="wf-scroll">
          {SETTINGS_CATS.map(c => (
            <div key={c.id} style={{ padding: '6px 14px', fontSize: 12, color: activeId === c.id ? W.ink : W.ink2, background: activeId === c.id ? W.bg3 : 'transparent', borderLeft: `2px solid ${activeId === c.id ? W.ink : 'transparent'}`, cursor: 'pointer' }}>
              {c.label}
            </div>
          ))}
        </div>
        <div style={{ padding: 16, overflow: 'auto', position: 'relative' }} className="wf-scroll">
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: W.ink3, marginTop: 4, maxWidth: 640 }}>{sub}</div>}
          <div style={{ marginTop: 14 }}>{children}</div>
        </div>
      </div>
    </AppFrame>
  );
}

// --- Data sources ---
function WfSettingsDataSources() {
  const roots = [
    { path: 'D:\\Astrophotography\\Raw', cat: 'Raw', state: 'online', files: 84231, scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Calibration', cat: 'Calibration', state: 'online', files: 12044, scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Projects', cat: 'Projects', state: 'online', files: 38112, scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Inbox', cat: 'Inbox', state: 'online', files: 1842, scan: '2h ago' },
    { path: '\\\\NAS-2025\\astro\\archive', cat: 'Inbox', state: 'offline', files: '?', scan: 'never', warn: true },
    { path: 'E:\\AstroOverflow', cat: 'Raw', state: 'online', files: 7931, scan: '2h ago' },
  ];

  return (
    <_SettingsShell activeId="sources" title="Data sources"
      sub="Library roots the app indexes. Files are read in read-only mode; nothing is modified outside an approved plan.">
      <Section title="Registered roots" sub="6 roots · 142,318 files indexed" right={<Btn small>+ Add root…</Btn>} noPad>
        <table>
          <thead><tr><th></th><th>Path</th><th style={{ width: 110 }}>Category</th><th style={{ width: 70 }}>State</th><th style={{ width: 80 }}>Files</th><th style={{ width: 110 }}>Last scan</th><th style={{ width: 130 }}></th></tr></thead>
          <tbody>
            {roots.map((r, i) => (
              <tr key={i}>
                <td style={{ width: 24 }}>{r.warn ? <span style={{ color: W.warn }}>⚠</span> : <span style={{ color: W.ok }}>●</span>}</td>
                <td style={{ minWidth: 280 }}><DirPicker value={r.path} size="sm" warn={r.warn} /></td>
                <td><Pill variant="ghost" size="xs">{r.cat}</Pill></td>
                <td>{r.state === 'online' ? <Pill variant="ok" size="xs">online</Pill> : <Pill variant="danger" size="xs">offline</Pill>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{typeof r.files === 'number' ? r.files.toLocaleString() : r.files}</td>
                <td style={{ fontSize: 11, color: W.ink3 }}>{r.scan}</td>
                <td>{r.state === 'offline' ? <Btn small>Reconnect…</Btn> : <Btn small>Re-scan</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Box title="Scan defaults">
          <KV k="Follow symlinks" v={<><input type="checkbox" /> no</>} />
          <KV k="Follow junctions" v={<><input type="checkbox" /> no</>} />
          <KV k="Hashing" v={<select style={{ fontSize: 11.5 }}><option>lazy (recommended)</option></select>} />
          <KV k="Metadata extraction" v={<select style={{ fontSize: 11.5 }}><option>FITS + XISF + sidecar</option></select>} />
        </Box>
        <Box title="What happens to new files in the inbox?">
          <div style={{ fontSize: 11.5, color: W.ink2 }}>
            Inbox roots are <b>scanned in place</b> — files are not moved or modified. New material appears in the <a>Review queue</a> as session candidates, where you confirm them. They stay where they are on disk; the app just indexes them.
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: W.ink3 }}>If you want to physically reorganize inbox files into your raw tree, do it through your filesystem — this app does not move source files.</div>
        </Box>
      </div>
    </_SettingsShell>
  );
}

// --- Naming & structure (ingestion pattern with draggable tokens) ---
function _Token({ kind, label }) {
  const tokenStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
    background: kind === 'sep' ? W.bg3 : '#dde3ea',
    color: kind === 'sep' ? W.ink2 : '#2c3a4a',
    border: `1px solid ${kind === 'sep' ? W.rule : '#b8c4d2'}`,
    borderRadius: 3, cursor: 'grab',
  };
  return (
    <span style={tokenStyle}>
      {kind !== 'sep' && <span style={{ color: '#7080a0' }}>⋮⋮</span>}
      <span>{label}</span>
      <span style={{ color: W.ink4, marginLeft: 2, cursor: 'pointer' }}>×</span>
    </span>
  );
}

function _PatternBuilder({ tokens, disabled }) {
  return (
    <div style={{ padding: 8, background: disabled ? W.bg2 : W.bg, border: `1px solid ${W.rule}`, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', opacity: disabled ? 0.5 : 1 }}>
      {tokens.map((tk, i) => <_Token key={i} kind={tk.kind} label={tk.label} />)}
      <span style={{ width: 1, height: 18, background: W.rule, margin: '0 4px' }} />
      <Btn small>+ Token</Btn>
      <Btn small>+ Separator</Btn>
    </div>
  );
}

function _FrameOverride({ label, enabled, tokens }) {
  return (
    <div style={{ padding: '12px 0', borderTop: `1px solid ${W.rule2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 18, borderRadius: 9, background: enabled ? W.ink2 : W.bg3, border: `1px solid ${W.rule}`, position: 'relative', cursor: 'pointer' }}>
          <span style={{ position: 'absolute', top: 1, left: enabled ? 15 : 1, width: 14, height: 14, borderRadius: 7, background: W.bg, border: `1px solid ${W.rule}` }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <_PatternBuilder tokens={tokens} disabled={!enabled} />
      </div>
    </div>
  );
}

function WfSettingsNaming() {
  const defaultTokens = [
    { kind: 'tok', label: '{target}' },
    { kind: 'sep', label: '/' },
    { kind: 'tok', label: '{filter}' },
    { kind: 'sep', label: '/' },
    { kind: 'tok', label: '{date}' },
    { kind: 'sep', label: '/' },
    { kind: 'tok', label: '{frame_type}' },
    { kind: 'sep', label: '/' },
  ];

  return (
    <_SettingsShell activeId="naming" title="Naming & Structure"
      sub="Pattern used when files are confirmed from Inbox to Inventory.">

      <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 8 }}>Global pattern</div>
      <div style={{ marginTop: 6 }}>
        <_PatternBuilder tokens={defaultTokens} />
      </div>

      <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 16 }}>Preview using recent fits</div>
      <div style={{ marginTop: 6, padding: 12, background: W.bg2, border: `1px solid ${W.rule}` }}>
        <div className="mono" style={{ fontSize: 11.5 }}>M101/Ha/2026-04-12/lights/</div>
        <div className="mono" style={{ fontSize: 11.5 }}>M101/OIII/2026-04-13/lights/</div>
        <div className="mono" style={{ fontSize: 11.5 }}>M101/—/2026-04/darks/</div>
      </div>

      <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 20 }}>Per-frame-type overrides</div>
      <div style={{ marginTop: 4 }}>
        <_FrameOverride label="Light" enabled={false} tokens={defaultTokens} />
        <_FrameOverride label="Dark" enabled={false} tokens={defaultTokens} />
        <_FrameOverride label="Flat" enabled={false} tokens={defaultTokens} />
        <_FrameOverride label="Bias" enabled={false} tokens={defaultTokens} />
        <_FrameOverride label="Dark flat" enabled={false} tokens={defaultTokens} />
      </div>

      <Note side="left" x={16} y={20} width={190}>Inbox → Inventory pattern. Tokens drag-and-drop; separators are static text between them.</Note>
    </_SettingsShell>
  );
}

// --- Source view strategy ---
function WfSettingsViewStrategy() {
  const strategies = [
    { id: 'manifest', label: 'Manifest-only', desc: 'Write a JSON listing source paths. No filesystem entries.', size: '~10 KB', port: '✓', tools: '✗ (needs paths)', safety: '✓', rec: false },
    { id: 'symlink', label: 'Symbolic links', desc: 'POSIX symlinks. May need admin on Windows.', size: '~10 KB', port: '✓', tools: '✓ most', safety: '~ admin', rec: false },
    { id: 'junction', label: 'NTFS junctions', desc: 'Directory junctions on Windows. WBPP-friendly, no admin.', size: '~10 KB', port: 'Windows', tools: '✓ WBPP', safety: '✓', rec: true },
    { id: 'hardlink', label: 'Hard links', desc: 'Same-volume only. Identical inode.', size: '~10 KB', port: 'same vol', tools: '✓', safety: '✓', rec: false },
    { id: 'copy', label: 'Full copy', desc: 'Duplicate every file. Use only for portable workflows.', size: '8.4 GB', port: '✓', tools: '✓', safety: '⚠ duplicates', rec: false },
    { id: 'hybrid', label: 'Hybrid', desc: 'Junction by default; fall back to symlink/copy per item.', size: 'varies', port: '✓', tools: '✓', safety: '✓', rec: false },
  ];

  return (
    <_SettingsShell activeId="views" title="Source view strategy"
      sub="How the app generates tool-friendly projections of your source map. Picked per project at creation, with this as the default.">
      <Section title="Default strategy" sub="applied when creating a new project (overridable in the wizard)" noPad>
        <table>
          <thead><tr><th></th><th>Strategy</th><th>Disk usage</th><th>Portable</th><th>Tool compat.</th><th>Safety</th></tr></thead>
          <tbody>
            {strategies.map(s => (
              <tr key={s.id} style={{ background: s.rec ? '#f5f3e8' : 'transparent' }}>
                <td><input type="radio" name="strat" defaultChecked={s.rec} /></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.label} {s.rec && <Pill variant="ok" size="xs">DEFAULT</Pill>}</div>
                  <div style={{ fontSize: 10.5, color: W.ink3 }}>{s.desc}</div>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>{s.size}</td>
                <td style={{ fontSize: 11 }}>{s.port}</td>
                <td style={{ fontSize: 11 }}>{s.tools}</td>
                <td style={{ fontSize: 11 }}>{s.safety}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Box title="Per-platform overrides">
          <KV k="Windows" v="NTFS junction" />
          <KV k="macOS" v="Symlink" />
          <KV k="Linux" v="Symlink" />
          <KV k="Across volumes" v="fall back to copy (with confirm)" />
        </Box>
        <Box title="Default conflict policy">
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" defaultChecked /> fail if exists (safest)</label>
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> rename with suffix</label>
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> skip existing</label>
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> require manual resolution</label>
        </Box>
      </div>
    </_SettingsShell>
  );
}

// --- Cleanup & archive policy (per-data-type, per processing tool) ---
function WfSettingsCleanup() {
  const ACTIONS = ['keep', 'archive', 'trash', 'DELETE'];

  // Policy table: one row per data type, one column per processing tool.
  // Rows in three groups: 1) processing artifacts (tool-specific), 2) shared categories.
  const piRow = (label, def, opts, notes) => ({ label, scope: 'pi', def, opts, notes });
  const sirilRow = (label, def, opts, notes) => ({ label, scope: 'siril', def, opts, notes });

  const rows = [
    // Per-tool processing artifact types
    { label: 'Registered frames', pi: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, planetary: { def: 'keep', opts: ['keep', 'archive', 'trash'] }, when: 'after output verified' },
    { label: 'Calibrated frames', pi: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, planetary: { def: '—', opts: [] }, when: 'after output verified' },
    { label: 'Debayered frames', pi: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, planetary: { def: '—', opts: [] }, when: 'after output verified' },
    { label: 'Local normalized', pi: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, siril: { def: '—', opts: [] }, planetary: { def: '—', opts: [] }, when: 'after output verified' },
    { label: 'Drizzle data', pi: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'trash', opts: ['keep', 'archive', 'trash'] }, planetary: { def: '—', opts: [] }, when: 'after output verified' },
    { label: 'Integration cache', pi: { def: 'trash', opts: ['keep', 'trash'] }, siril: { def: 'trash', opts: ['keep', 'trash'] }, planetary: { def: 'trash', opts: ['keep', 'trash'] }, when: 'after output verified' },
    { label: 'Stack output (intermediate)', pi: { def: 'keep', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'keep', opts: ['keep', 'archive', 'trash'] }, planetary: { def: 'keep', opts: ['keep', 'archive', 'trash'] }, when: '—' },
    { label: 'Temporary files', pi: { def: 'DELETE', opts: ['keep', 'trash', 'DELETE'], danger: true }, siril: { def: 'DELETE', opts: ['keep', 'trash', 'DELETE'], danger: true }, planetary: { def: 'DELETE', opts: ['keep', 'trash', 'DELETE'], danger: true }, when: 'always' },
    { label: 'Processing logs', pi: { def: 'archive', opts: ['keep', 'archive', 'trash'] }, siril: { def: 'archive', opts: ['keep', 'archive', 'trash'] }, planetary: { def: 'archive', opts: ['keep', 'archive', 'trash'] }, when: 'on completion' },
    { label: 'Process icons / tool config', pi: { def: 'keep', opts: ['keep'], locked: true }, siril: { def: 'keep', opts: ['keep'], locked: true }, planetary: { def: 'keep', opts: ['keep'], locked: true }, when: '—' },

    // Shared categories (apply regardless of tool)
    { label: 'Source frames (raw lights)', shared: true, def: 'keep', locked: true, when: 'never' },
    { label: 'Calibration sessions / masters', shared: true, def: 'keep', locked: true, when: 'never' },
    { label: 'Source views', shared: true, def: 'rm link', opts: ['keep', 'rm link'], when: 'on view retire' },
    { label: 'Final outputs', shared: true, def: 'keep', locked: true, when: 'never' },
    { label: 'Notes & manifests', shared: true, def: 'keep', locked: true, when: 'never' },
  ];

  const cell = (val, danger, locked) => {
    if (val === '—') return <span style={{ color: W.ink4 }}>—</span>;
    if (locked) {
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock /><span style={{ fontSize: 11 }}>keep</span></span>;
    }
    const pillFor = (a) => {
      if (a === 'keep') return <Pill variant="ok" size="xs">keep</Pill>;
      if (a === 'archive') return <Pill variant="info" size="xs">archive</Pill>;
      if (a === 'trash') return <Pill variant="warn" size="xs">trash</Pill>;
      if (a === 'rm link') return <Pill variant="ghost" size="xs">rm link</Pill>;
      if (a === 'DELETE') return <Pill variant="danger" size="xs">DELETE</Pill>;
    };
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {pillFor(val)}
        <span style={{ color: W.ink4, fontSize: 10 }}>▾</span>
      </span>
    );
  };

  return (
    <_SettingsShell activeId="cleanup" title="Cleanup & archive policy"
      sub="What happens to each kind of data when cleanup runs. Policies vary by processing tool because different tools produce different intermediates.">

      {/* Processing directory: which subfolder is treated as the processing workspace */}
      <Section title="Processing directory" sub="the subdirectory inside each project where your processing tool writes its work. Determines what the app observes as artifacts vs. final outputs." noPad>
        <div style={{ padding: 12, background: W.bg, border: `1px solid ${W.rule}` }}>
          <table>
            <thead><tr><th style={{ width: 160 }}>Workflow</th><th>Processing directory (relative to project root)</th><th style={{ width: 260 }}>Output directory</th></tr></thead>
            <tbody>
              <tr>
                <td><b>PixInsight / WBPP</b></td>
                <td><DirPicker value="processing/" size="sm" /></td>
                <td><DirPicker value="outputs/" size="sm" /></td>
              </tr>
              <tr>
                <td><b>Siril</b></td>
                <td><DirPicker value="processing/" size="sm" /></td>
                <td><DirPicker value="outputs/" size="sm" /></td>
              </tr>
              <tr>
                <td><b>Planetary / lunar</b></td>
                <td><DirPicker value="processing/" size="sm" /></td>
                <td><DirPicker value="outputs/" size="sm" /></td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 11, color: W.ink3 }}>
            Anything inside the processing directory is cleanup-eligible per the matrix below. Everything outside it (sources, manifests, outputs, notes) is protected by default.
          </div>
        </div>
      </Section>

      <div style={{ marginTop: 18 }}>
        <Section title="Policy matrix" sub="default action per data type, per processing tool — click any cell to change it" noPad>
          <table>
            <thead>
              <tr>
                <th>Data type</th>
                <th style={{ width: 130 }}>PixInsight / WBPP</th>
                <th style={{ width: 130 }}>Siril</th>
                <th style={{ width: 130 }}>Planetary</th>
                <th style={{ width: 140 }}>Trigger</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {/* Processing artifacts group */}
              <tr><td colSpan={6} style={{ padding: '6px 10px', background: W.bg2, fontSize: 10.5, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Processing artifacts (tool-specific)</td></tr>
              {rows.filter(r => !r.shared).map((r, i) => (
                <tr key={i} style={{ background: r.pi?.danger || r.siril?.danger ? '#faf0ec' : 'transparent' }}>
                  <td><b>{r.label}</b></td>
                  <td>{cell(r.pi?.def, r.pi?.danger, r.pi?.locked)}</td>
                  <td>{cell(r.siril?.def, r.siril?.danger, r.siril?.locked)}</td>
                  <td>{cell(r.planetary?.def, r.planetary?.danger, r.planetary?.locked)}</td>
                  <td style={{ fontSize: 11, color: W.ink3 }}>{r.when}</td>
                  <td>{(r.pi?.danger || r.siril?.danger || r.planetary?.danger) && <Pill variant="danger" size="xs">destructive</Pill>}</td>
                </tr>
              ))}

              {/* Shared categories */}
              <tr><td colSpan={6} style={{ padding: '6px 10px', background: W.bg2, fontSize: 10.5, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Shared categories (apply regardless of tool)</td></tr>
              {rows.filter(r => r.shared).map((r, i) => (
                <tr key={'s' + i}>
                  <td>{r.locked && <Lock />} <b>{r.label}</b></td>
                  <td colSpan={3} style={{ textAlign: 'center' }}>{cell(r.def, false, r.locked)}</td>
                  <td style={{ fontSize: 11, color: W.ink3 }}>{r.when}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Box title="When does cleanup run?">
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="when" defaultChecked /> Only when I generate a plan (manual)</label>
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="when" /> Suggest after output is verified</label>
          <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="when" /> Suggest after project transitions to completed</label>
        </Box>
        <Box title="Approval requirements">
          <KV k="Trash" v="output must be recorded" />
          <KV k="Archive" v="output must be accepted (verified)" />
          <KV k="DELETE" v="output accepted + explicit per-plan approval" />
          <KV k="Permanent delete (app-wide)" v={<span style={{ color: W.danger }}>disabled by default — enable per cell above</span>} />
        </Box>
      </div>

      <Note side="left" x={16} y={40} width={190}>Per-data-type by tool. PixInsight produces "registered/calibrated/normalized"; Siril doesn't have local-normalized; planetary produces different intermediates. Each column reflects what that tool actually outputs.</Note>
    </_SettingsShell>
  );
}

window.WfSettingsDataSources = WfSettingsDataSources;
window.WfSettingsNaming = WfSettingsNaming;
window.WfSettingsViewStrategy = WfSettingsViewStrategy;
window.WfSettingsCleanup = WfSettingsCleanup;
