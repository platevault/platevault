// shell.jsx — Shared primitives + AppFrame (desktop window chrome + nav variants)
// Mid-fi grayscale style. Tweak-aware (density, sketchy, annotations, nav pattern).

const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

// --- Tweak context (set in app.jsx) ---
const TweakCtx = createContext({ density: 'comfortable', sketchy: false, annotations: true, nav: 'sidebar' });
const useT = () => useContext(TweakCtx);

// --- Tokens / styles ---
const W = {
  ink: '#1a1a1a',
  ink2: '#3a3a3a',
  ink3: '#6a6a6a',
  ink4: '#9a9a9a',
  rule: '#d4d4d2',
  rule2: '#e4e3e0',
  bg: '#fafaf8',
  bg2: '#f3f2ee',
  bg3: '#ebeae5',
  chip: '#ebeae5',
  warn: '#7a5a1a',
  danger: '#8a2a1a',
  ok: '#1f5a3a',
  note: '#fff3b0',
  noteInk: '#5a4a10',
};

// One-time inject of utility CSS scoped to wireframes
if (!document.getElementById('wf-styles')) {
  const s = document.createElement('style');
  s.id = 'wf-styles';
  s.textContent = `
    .wf { font-family: 'Inter', system-ui, sans-serif; color: ${W.ink}; background: ${W.bg}; font-size: 12px; line-height: 1.45; }
    .wf.sketchy { font-family: 'Architects Daughter', 'Caveat', system-ui, sans-serif; }
    .wf.sketchy .mono { font-family: 'Architects Daughter', monospace; }
    .wf.sketchy * { border-radius: 4px !important; }
    .wf.sketchy .wf-box, .wf.sketchy .wf-card, .wf.sketchy .wf-row { filter: url(#wf-sketch); }
    .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .wf table { border-collapse: collapse; width: 100%; }
    .wf th, .wf td { text-align: left; padding: 6px 10px; border-bottom: 1px solid ${W.rule2}; vertical-align: top; }
    .wf th { font-weight: 500; color: ${W.ink3}; background: ${W.bg2}; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid ${W.rule}; position: sticky; top: 0; }
    .wf tr:hover td { background: ${W.bg2}; }
    .wf.compact th, .wf.compact td { padding: 3px 8px; font-size: 11.5px; }
    .wf.spacious th, .wf.spacious td { padding: 10px 14px; }
    .wf button { font: inherit; cursor: pointer; }
    .wf input, .wf select { font: inherit; color: inherit; }
    .wf-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
    .wf-scroll::-webkit-scrollbar-thumb { background: #c8c6c2; border-radius: 5px; border: 2px solid ${W.bg}; }
    .wf-scroll { scrollbar-width: thin; }
  `;
  document.head.appendChild(s);
  // sketchy SVG filter
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs><filter id="wf-sketch"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.2"/></filter></defs>
  `;
  document.body.appendChild(svg);
}

// --- Annotation post-it (sticky note attached to a specific UI element) ---
function Note({ children, x, y, width = 200, side = 'right', n }) {
  const t = useT();
  if (!t.annotations) return null;
  const style = { position: 'absolute', top: y, width, zIndex: 50, pointerEvents: 'none' };
  if (side === 'right') style.left = x; else style.right = x;
  return (
    <div style={style}>
      <div style={{
        background: '#fffbe6', color: '#3a2e08', padding: '8px 10px',
        fontSize: 11, lineHeight: 1.45,
        boxShadow: '2px 3px 8px rgba(60, 50, 10, .18), 0 0 0 1px rgba(120, 100, 30, .25)',
        borderLeft: '3px solid #d8c860',
        transform: 'rotate(-0.4deg)',
        position: 'relative',
      }}>
        {n != null && (
          <span style={{
            position: 'absolute', top: -8, left: -8,
            width: 18, height: 18, borderRadius: 9,
            background: '#f3d860', color: '#3a2e08', border: '1px solid #c5a73a',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10.5, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
            boxShadow: '1px 1px 2px rgba(0,0,0,.1)',
          }}>{n}</span>
        )}
        {children}
      </div>
    </div>
  );
}

// Inline annotation pin (number + tooltip-style note)
function Pin({ n, children }) {
  const t = useT();
  if (!t.annotations) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, fontFamily: "'Caveat', cursive", color: W.noteInk, fontSize: 13 }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: W.note, border: '1px solid #d8c860', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontFamily: 'Inter', fontWeight: 600 }}>{n}</span>
      {children && <span>{children}</span>}
    </span>
  );
}

// --- Primitive: Pill (status badge) ---
function Pill({ children, variant = 'neutral', size = 'sm' }) {
  const variants = {
    neutral: { bg: W.chip, ink: W.ink2, bd: W.rule },
    ghost: { bg: 'transparent', ink: W.ink3, bd: W.rule },
    ok: { bg: '#e6efe2', ink: W.ok, bd: '#cdd9c5' },
    warn: { bg: '#f3ead0', ink: W.warn, bd: '#dccfa0' },
    danger: { bg: '#f0d8d2', ink: W.danger, bd: '#d9b5a8' },
    info: { bg: '#e0e4e8', ink: '#345268', bd: '#c3cbd3' },
  };
  const v = variants[variant] || variants.neutral;
  const pad = size === 'xs' ? '1px 6px' : '2px 8px';
  const fs = size === 'xs' ? 10 : 10.5;
  return (
    <span style={{ display: 'inline-block', padding: pad, background: v.bg, color: v.ink, border: `1px solid ${v.bd}`,
      borderRadius: 3, fontSize: fs, fontWeight: 500, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// --- Confidence indicator: bar + text ---
function Confidence({ level, value }) {
  // level: unknown low medium high confirmed rejected
  const map = { unknown: 0, low: 25, medium: 55, high: 85, confirmed: 100, rejected: 0 };
  const pct = value != null ? value : (map[level] || 0);
  const tone = level === 'confirmed' ? W.ok : level === 'rejected' ? W.danger : level === 'high' ? W.ink : level === 'medium' ? W.ink2 : W.ink4;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 32, height: 6, background: W.rule2, borderRadius: 1, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: tone, borderRadius: 1 }} />
      </span>
      <span style={{ color: tone, fontSize: 10.5, textTransform: 'capitalize' }}>{level}</span>
    </span>
  );
}

// Provenance origin glyph: ●reviewed ○observed ◐inferred ◇generated ▢planned ▣applied
function Provenance({ origin = 'observed', title }) {
  const map = {
    reviewed: { g: '●', c: W.ink, t: 'Reviewed' },
    observed: { g: '○', c: W.ink3, t: 'Observed' },
    inferred: { g: '◐', c: W.ink2, t: 'Inferred' },
    generated: { g: '◇', c: W.ink3, t: 'Generated' },
    planned: { g: '▢', c: W.ink3, t: 'Planned' },
    applied: { g: '▣', c: W.ink2, t: 'Applied' },
  };
  const m = map[origin] || map.observed;
  return <span title={title || m.t} style={{ color: m.c, fontSize: 10, marginRight: 4 }}>{m.g}</span>;
}

// Protection lock
function Lock({ on = true }) {
  return <span title={on ? 'Protected' : ''} style={{ color: on ? W.ink : W.ink4, fontSize: 11 }}>{on ? '🔒' : ''}</span>;
}

// --- Toolbar: thin bar with sections ---
function Toolbar({ children, sub }) {
  const t = useT();
  const pad = t.density === 'compact' ? '4px 10px' : t.density === 'spacious' ? '10px 16px' : '6px 12px';
  return (
    <div style={{ borderBottom: `1px solid ${W.rule}`, background: W.bg2 }}>
      <div style={{ padding: pad, display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
      {sub && <div style={{ padding: '4px 12px', borderTop: `1px solid ${W.rule2}`, background: W.bg, fontSize: 11, color: W.ink3, display: 'flex', alignItems: 'center', gap: 12 }}>{sub}</div>}
    </div>
  );
}

// Generic button (mid-fi: looks like a wireframe button)
function Btn({ children, primary, danger, small, active, ...p }) {
  const bg = primary ? W.ink : active ? W.bg3 : W.bg;
  const fg = primary ? W.bg : danger ? W.danger : W.ink;
  const bd = primary ? W.ink : danger ? '#caa090' : W.rule;
  return (
    <button {...p} style={{ background: bg, color: fg, border: `1px solid ${bd}`, padding: small ? '2px 8px' : '4px 10px', fontSize: small ? 11 : 12, borderRadius: 3, fontWeight: primary ? 500 : 400, ...(p.style || {}) }}>
      {children}
    </button>
  );
}

// --- Nav: 3 variants (sidebar, top tabs, three-pane nav) ---
const NAV_ITEMS = [
  { id: 'review', label: 'Review queue', count: 48, warn: true },
  { id: 'sessions', label: 'Sessions', count: 247 },
  { id: 'calibration', label: 'Calibration', count: 84 },
  { id: 'targets', label: 'Targets', count: 53 },
  { id: 'projects', label: 'Projects', count: 19 },
  { id: 'plans', label: 'Plans', count: 3, warn: true },
  { id: 'audit', label: 'Audit log' },
  { id: 'settings', label: 'Settings' },
];

function NavSidebar({ active, onPick, collapsed, onToggleCollapse }) {
  const t = useT();
  const pad = t.density === 'compact' ? '4px 10px' : '6px 12px';
  if (collapsed) {
    const glyphs = { library: 'L', review: 'R', sessions: 'S', calibration: 'C', targets: '⌖', projects: 'P', plans: '◇', audit: '◷', settings: '⚙' };
    return (
      <div style={{ width: 44, background: W.bg2, borderRight: `1px solid ${W.rule}`, display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
        <div onClick={onToggleCollapse} style={{ padding: '8px 0', display: 'flex', justifyContent: 'center', borderBottom: `1px solid ${W.rule2}`, cursor: 'pointer' }} title="Expand sidebar">
          <span style={{ width: 22, height: 22, border: `1.5px solid ${W.ink}`, borderRadius: 4, display: 'inline-block' }} />
        </div>
        <div style={{ padding: '6px 0', flex: 1 }}>
          {NAV_ITEMS.map(it => (
            <div key={it.id} onClick={() => onPick && onPick(it.id)} title={it.label}
              style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                color: active === it.id ? W.ink : W.ink3, background: active === it.id ? W.bg3 : 'transparent',
                borderLeft: `2px solid ${active === it.id ? W.ink : 'transparent'}`, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
              {glyphs[it.id] || it.label[0]}
              {it.warn && <span style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3, background: W.warn }} />}
            </div>
          ))}
        </div>
        <div onClick={onToggleCollapse} style={{ padding: '8px 0', textAlign: 'center', borderTop: `1px solid ${W.rule2}`, fontSize: 11, color: W.ink3, cursor: 'pointer' }} title="Expand">»</div>
      </div>
    );
  }
  return (
    <div style={{ width: 184, background: W.bg2, borderRight: `1px solid ${W.rule}`, display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${W.rule2}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: W.ink3, letterSpacing: '.04em', textTransform: 'uppercase' }}>Astro Library</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>Manager <span style={{ color: W.ink4, fontWeight: 400 }}>v0.4</span></div>
        </div>
        <span onClick={onToggleCollapse} title="Collapse sidebar" style={{ cursor: 'pointer', color: W.ink3, fontSize: 14, padding: '2px 4px', borderRadius: 3 }}>«</span>
      </div>
      <div style={{ padding: '6px 0', flex: 1, overflow: 'auto' }} className="wf-scroll">
        {NAV_ITEMS.map(it => (
          <div key={it.id} onClick={() => onPick && onPick(it.id)}
            style={{ padding: pad, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              cursor: 'pointer', background: active === it.id ? W.bg3 : 'transparent',
              borderLeft: `2px solid ${active === it.id ? W.ink : 'transparent'}` }}>
            <span style={{ flex: 1, color: active === it.id ? W.ink : W.ink2 }}>{it.label}</span>
            {it.count != null && (
              <span style={{ fontSize: 10.5, color: it.warn ? W.warn : W.ink4, fontVariantNumeric: 'tabular-nums' }}>{it.count}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${W.rule2}`, fontSize: 10.5, color: W.ink3 }}>
        <div>4 roots · 2 online</div>
        <div style={{ color: W.warn, marginTop: 2 }}>⚠ NAS-Astro offline</div>
      </div>
    </div>
  );
}

function NavTopTabs({ active, onPick }) {
  return (
    <div style={{ background: W.bg2, borderBottom: `1px solid ${W.rule}`, display: 'flex', alignItems: 'stretch', flex: '0 0 auto' }}>
      <div style={{ padding: '8px 14px', borderRight: `1px solid ${W.rule}`, fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 14, height: 14, border: `1.5px solid ${W.ink}`, borderRadius: 7, display: 'inline-block' }} />
        ALM
      </div>
      <div style={{ display: 'flex', overflow: 'auto' }}>
        {NAV_ITEMS.map(it => (
          <div key={it.id} onClick={() => onPick && onPick(it.id)}
            style={{ padding: '8px 14px', borderRight: `1px solid ${W.rule2}`, fontSize: 12,
              cursor: 'pointer', borderBottom: `2px solid ${active === it.id ? W.ink : 'transparent'}`,
              color: active === it.id ? W.ink : W.ink2, display: 'flex', alignItems: 'center', gap: 6 }}>
            {it.label}
            {it.count != null && (
              <span style={{ fontSize: 10, color: it.warn ? W.warn : W.ink4, background: W.chip, padding: '0 5px', borderRadius: 2 }}>{it.count}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 11, color: W.ink3, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>4 roots · 2 online</span>
      </div>
    </div>
  );
}

// Three-pane nav: ultra-thin icon rail + section list
function NavThreePane({ active, onPick }) {
  return (
    <>
      <div style={{ width: 44, background: '#e6e4df', borderRight: `1px solid ${W.rule}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: 4, flex: '0 0 auto' }}>
        <div style={{ width: 22, height: 22, border: `1.5px solid ${W.ink}`, borderRadius: 4, marginBottom: 6 }} />
        {['L', 'R', 'S', 'C', 'T', 'P', '⌖', '◷', '⚙'].map((g, i) => (
          <div key={i} onClick={() => onPick && onPick(NAV_ITEMS[i]?.id)}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 500, color: active === NAV_ITEMS[i]?.id ? W.ink : W.ink3,
              background: active === NAV_ITEMS[i]?.id ? W.bg : 'transparent', border: `1px solid ${active === NAV_ITEMS[i]?.id ? W.rule : 'transparent'}`, borderRadius: 4, cursor: 'pointer' }}>
            {g}
          </div>
        ))}
      </div>
    </>
  );
}

// AppFrame: window chrome + chosen nav. children gets the main content area.
function AppFrame({ title, breadcrumb, active, onPick, children, listPane, navOverride, sidebarCollapsed }) {
  const t = useT();
  const navMode = navOverride || t.nav;
  const [collapsed, setCollapsed] = useState(!!sidebarCollapsed);
  return (
    <div className={`wf ${t.density} ${t.sketchy ? 'sketchy' : ''}`} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: W.bg, border: `1px solid ${W.rule}` }}>
      {/* Title bar */}
      <div style={{ height: 28, background: '#d8d6d1', display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${W.rule}`, flex: '0 0 auto' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 6, background: '#c8c6c1', border: `1px solid ${W.rule}` }} />
          <span style={{ width: 11, height: 11, borderRadius: 6, background: '#c8c6c1', border: `1px solid ${W.rule}` }} />
          <span style={{ width: 11, height: 11, borderRadius: 6, background: '#c8c6c1', border: `1px solid ${W.rule}` }} />
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: W.ink3 }}>
          Astro Library Manager — {title}
        </div>
        <div style={{ fontSize: 10.5, color: W.ink4 }}>tauri • base-ui</div>
      </div>

      {navMode === 'tabs' && <NavTopTabs active={active} onPick={onPick} />}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {navMode === 'sidebar' && <NavSidebar active={active} onPick={onPick} collapsed={collapsed} onToggleCollapse={() => setCollapsed(c => !c)} />}
        {navMode === 'three-pane' && <NavThreePane active={active} onPick={onPick} />}
        {navMode === 'three-pane' && listPane && (
          <div style={{ width: 220, background: W.bg2, borderRight: `1px solid ${W.rule}`, flex: '0 0 auto', overflow: 'auto' }} className="wf-scroll">{listPane}</div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {breadcrumb && (
            <div style={{ padding: '6px 12px', borderBottom: `1px solid ${W.rule2}`, fontSize: 11, color: W.ink3, background: W.bg, flex: '0 0 auto' }}>
              {breadcrumb}
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }} className="wf-scroll">
            {children}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: 22, background: W.bg2, borderTop: `1px solid ${W.rule}`, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 10.5, color: W.ink3, gap: 14, flex: '0 0 auto' }}>
        <span>Idle</span>
        <span style={{ color: W.ink4 }}>·</span>
        <span>Last scan: 2h ago</span>
        <span style={{ color: W.ink4 }}>·</span>
        <span>142,318 files indexed</span>
        <span style={{ marginLeft: 'auto', color: W.ink4 }}>D:\Astrophotography</span>
      </div>
    </div>
  );
}

// Section header inside content area
function Section({ title, sub, right, children, noPad }) {
  return (
    <div style={{ borderBottom: `1px solid ${W.rule2}` }}>
      <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: W.ink }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: W.ink3 }}>{sub}</div>}
        {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
      </div>
      {children && <div style={{ padding: noPad ? 0 : '0 14px 12px' }}>{children}</div>}
    </div>
  );
}

// Key-value column (for detail pages)
function KV({ k, v, prov, conf }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, fontSize: 11.5 }}>
      <div style={{ width: 130, color: W.ink3, flex: '0 0 auto' }}>{k}</div>
      <div style={{ flex: 1, color: W.ink }}>
        {prov && <Provenance origin={prov} />}
        {v}
        {conf && <span style={{ marginLeft: 6 }}><Confidence level={conf} /></span>}
      </div>
    </div>
  );
}

// Box (light card)
function Box({ title, right, children, pad = '10px 12px', style }) {
  return (
    <div className="wf-box" style={{ border: `1px solid ${W.rule}`, background: W.bg, ...style }}>
      {title && (
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${W.rule2}`, background: W.bg2, fontSize: 11, fontWeight: 600, color: W.ink2, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{title}</span>
          {right}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

// Inline icon arrows / glyphs
const Arr = ({ children = '→' }) => <span style={{ color: W.ink4, margin: '0 6px' }}>{children}</span>;

// Filter chip bar
function FilterBar({ items = [], right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: W.ink3 }}>Filter:</span>
      {items.map((it, i) => (
        <span key={i} style={{ fontSize: 11, padding: '2px 8px', background: W.bg, border: `1px solid ${W.rule}`, borderRadius: 3, color: W.ink2 }}>
          {it.k}: <span style={{ fontWeight: 500 }}>{it.v}</span> ×
        </span>
      ))}
      <span style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: `1px dashed ${W.rule}`, borderRadius: 3, color: W.ink3 }}>+ add</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

// DirectoryPicker — native-feeling directory picker (NOT a text field).
// Path displays alongside a "Choose folder…" button. Click anywhere to open native picker.
function DirPicker({ value, placeholder = 'No folder selected', size = 'md', disabled, warn }) {
  const isSmall = size === 'sm';
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${warn ? W.warn : W.rule}`, background: disabled ? W.bg2 : W.bg, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ padding: isSmall ? '3px 8px' : '5px 10px', display: 'flex', alignItems: 'center', gap: 6, borderRight: `1px solid ${W.rule}`, background: W.bg2 }}>
        <span style={{ color: W.ink3, fontSize: isSmall ? 11 : 12 }}>📁</span>
      </div>
      <div className="mono" style={{ flex: 1, padding: isSmall ? '3px 10px' : '5px 10px', fontSize: isSmall ? 10.5 : 11.5, color: value ? W.ink : W.ink4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }}>
        {value || placeholder}
      </div>
      <button style={{ padding: isSmall ? '3px 10px' : '5px 12px', border: 'none', borderLeft: `1px solid ${W.rule}`, background: W.bg2, fontSize: isSmall ? 11 : 12, color: W.ink2, cursor: 'pointer' }}>
        Choose folder…
      </button>
    </div>
  );
}

// DesignNotes — structured annotation block rendered at the bottom of each wireframe.
// Pass `items` as an array of { n, title, body, group? }. Renders as a 2-column grid with numbered chips.
// Hidden when the user toggles annotations off.
function DesignNotes({ items = [], cols = 2 }) {
  const t = useT();
  if (!t.annotations) return null;
  return (
    <div style={{
      marginTop: 0,
      padding: '14px 18px 18px',
      background: '#fffbe6',
      borderTop: `2px dashed #d8c860`,
    }}>
      <div style={{ fontSize: 10.5, color: '#7a6b1a', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 10 }}>
        Design notes for implementor
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '10px 22px' }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{
              flex: '0 0 auto', width: 20, height: 20, borderRadius: 10,
              background: '#f3d860', color: '#3a2e08', border: '1px solid #c5a73a',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
            }}>{it.n}</span>
            <div style={{ flex: 1, fontSize: 11.5, color: '#3a2e08', lineHeight: 1.45 }}>
              {it.title && <span style={{ fontWeight: 600 }}>{it.title} — </span>}
              {it.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// PinNum — small numbered chip to anchor inline next to an element referenced in DesignNotes
function PinNum({ n }) {
  const t = useT();
  if (!t.annotations) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: 8, marginLeft: 6, verticalAlign: 'middle',
      background: '#f3d860', color: '#3a2e08', border: '1px solid #c5a73a',
      fontSize: 9.5, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
    }}>{n}</span>
  );
}

// WfWrap — wraps a wireframe with a DesignNotes band at the bottom (and provides space for stickies).
// Use in app.jsx around each wireframe: <WfWrap notes={[{n,title,body},…]}><WfFoo /></WfWrap>.
function WfWrap({ children, notes }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: W.bg }}>
      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>{children}</div>
      {notes && notes.length > 0 && <DesignNotes items={notes} />}
    </div>
  );
}

Object.assign(window, {
  W, useT, TweakCtx, Note, Pin, Pill, Confidence, Provenance, Lock,
  Toolbar, Btn, AppFrame, Section, KV, Box, Arr, FilterBar, DirPicker, NAV_ITEMS,
  DesignNotes, PinNum, WfWrap,
});
