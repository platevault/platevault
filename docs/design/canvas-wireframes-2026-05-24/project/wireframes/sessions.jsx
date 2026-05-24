// Sessions — 4 variations: flat list, grouped by target, grouped by month, calendar.
// Sessions can be linked to multiple projects (visible in the Projects column).

const SESSIONS = [
  { id: 's-14', target: 'NGC 7000', filter: 'Ha', night: '2024-12-15', frames: 30, hrs: '2.5h', train: 'AT130-EDT + 2600MM', state: 'needs_review', conf: 'medium', projects: [] },
  { id: 's-3', target: 'NGC 7000', filter: 'SII', night: '2024-12-01', frames: 22, hrs: '1.8h', train: 'AT130-EDT + 2600MM', state: 'needs_review', conf: 'low', warn: 'observer_location', projects: [] },
  { id: 's-2', target: 'NGC 7000', filter: 'OIII', night: '2024-11-30', frames: 38, hrs: '3.2h', train: 'AT130-EDT + 2600MM', state: 'confirmed', conf: 'high', projects: ['HOO', 'SHO mosaic'] },
  { id: 's-1', target: 'NGC 7000', filter: 'Ha', night: '2024-11-30', frames: 54, hrs: '4.5h', train: 'AT130-EDT + 2600MM', state: 'confirmed', conf: 'high', projects: ['HOO', 'SHO mosaic', 'tutorial demo'] },
  { id: 's-9', target: 'IC 1396', filter: 'OIII', night: '2024-09-19', frames: 40, hrs: '3.3h', train: 'AT130-EDT + 2600MM', state: 'discovered', conf: 'medium', projects: [] },
  { id: 's-8', target: 'IC 1396', filter: 'Ha', night: '2024-09-18', frames: 72, hrs: '6.0h', train: 'AT130-EDT + 2600MM', state: 'confirmed', conf: 'high', projects: ['IC 1396 · HOO'] },
  { id: 's-5', target: 'M31', filter: 'L', night: '2024-10-05', frames: 48, hrs: '2.0h', train: 'AT130-EDT + 2600MC', state: 'confirmed', conf: 'high', projects: ['M31 · LRGB'] },
  { id: 's-4', target: 'M31', filter: 'L', night: '2024-10-04', frames: 60, hrs: '2.5h', train: 'AT130-EDT + 2600MC', state: 'confirmed', conf: 'high', projects: ['M31 · LRGB', 'M31 · 2022 (legacy)'] },
  { id: 's-6', target: 'Jupiter', filter: '—', night: '2025-02-03', frames: 12000, hrs: '0.5h', train: 'C9.25 + ASI462MC', state: 'candidate', conf: 'medium', projects: [] },
  { id: 's-7', target: '(unresolved)', filter: 'Ha', night: '2024-09-12', frames: 31, hrs: '2.6h', train: 'AT130-EDT + 2600MM', state: 'needs_review', conf: 'low', warn: 'OBJECT missing', projects: [] },
];

function _GroupBy({ active, onPick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: W.ink3 }}>Group:</span>
      {['none', 'target', 'month', 'filter', 'optical train'].map(g => (
        <span key={g} style={{ padding: '2px 8px', border: `1px solid ${W.rule}`, fontSize: 11, background: active === g ? W.ink2 : W.bg, color: active === g ? W.bg : W.ink2, cursor: 'pointer' }}>{g}</span>
      ))}
    </div>
  );
}

function _SessionsToolbar({ view }) {
  return (
    <Toolbar sub={<><span>247 sessions</span><span style={{ color: W.ink4 }}>·</span><span>183 confirmed</span><span style={{ color: W.ink4 }}>·</span><span>42 needs review</span><span style={{ marginLeft: 'auto', color: W.ink4 }}>n = new session · ⏎ open · ⌘D dupe in project</span></>}>
      <input placeholder="Search target, filter, train…" style={{ flex: 1, padding: '4px 8px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 12 }} />
      <Btn small active={view === 'list'}>List</Btn>
      <Btn small active={view === 'calendar'}>Calendar</Btn>
      <span style={{ width: 1, height: 18, background: W.rule }} />
      <Btn small>Confirm</Btn>
      <Btn small>Split…</Btn>
      <Btn small>Merge</Btn>
      <Btn small>Use in project →</Btn>
    </Toolbar>
  );
}

// Session row used across variants
function _SessRow({ s, hideTarget, hideMonth, hideTrain, hideFilter }) {
  return (
    <tr>
      <td style={{ width: 24 }}>{s.warn ? <span style={{ color: W.warn }} title={s.warn}>⚠</span> : <span style={{ color: W.ink4 }}>·</span>}</td>
      {!hideTarget && <td><b>{s.target}</b></td>}
      {!hideFilter && <td style={{ width: 50 }}><Pill variant="ghost" size="xs">{s.filter}</Pill></td>}
      <td className="mono" style={{ fontSize: 11, width: 90 }}>{s.night}</td>
      <td className="mono" style={{ fontSize: 11, width: 60 }}>{s.frames.toLocaleString()}</td>
      <td className="mono" style={{ fontSize: 11, width: 50 }}>{s.hrs}</td>
      {!hideTrain && <td style={{ fontSize: 11, color: W.ink2 }}>{s.train}</td>}
      <td style={{ width: 110 }}>
        {s.state === 'confirmed' && <Pill variant="ok" size="xs">confirmed</Pill>}
        {s.state === 'needs_review' && <Pill variant="warn" size="xs">needs review</Pill>}
        {s.state === 'candidate' && <Pill variant="info" size="xs">candidate</Pill>}
        {s.state === 'discovered' && <Pill variant="ghost" size="xs">discovered</Pill>}
      </td>
      <td style={{ width: 90 }}><Confidence level={s.conf} /></td>
      <td>
        {s.projects.length === 0 ? <span style={{ color: W.ink4, fontSize: 10.5 }}>—</span> : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {s.projects.map(p => <Pill key={p} variant="info" size="xs">{p}</Pill>)}
          </div>
        )}
      </td>
    </tr>
  );
}

function _SessHead({ hideTarget, hideMonth, hideTrain, hideFilter }) {
  return (
    <tr>
      <th></th>
      {!hideTarget && <th>Target</th>}
      {!hideFilter && <th>Filter</th>}
      <th>Night</th>
      <th>Frames</th>
      <th>Integ.</th>
      {!hideTrain && <th>Optical train</th>}
      <th>State</th>
      <th>Confidence</th>
      <th>Projects (re-used)</th>
    </tr>
  );
}

// --- A: Flat list, sorted by date ---
function WfSessionsList() {
  return (
    <AppFrame title="Sessions" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> All acquisition · sorted by date ↓</>}>
      <_SessionsToolbar view="list" />
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: W.bg, display: 'flex', alignItems: 'center', gap: 12 }}>
        <_GroupBy active="none" />
        <span style={{ width: 1, height: 18, background: W.rule }} />
        <FilterBar items={[{ k: 'kind', v: 'acquisition' }]} />
      </div>
      <div style={{ position: 'relative' }}>
        <table>
          <thead><_SessHead /></thead>
          <tbody>{SESSIONS.map(s => <_SessRow key={s.id} s={s} />)}</tbody>
        </table>
        <Note side="left" x={16} y={20} width={190}>Default list — same as a database query, sortable on any column. "Projects" column shows the same session linked to multiple projects.</Note>
      </div>
    </AppFrame>
  );
}

// --- B: Grouped by target ---
function WfSessionsByTarget() {
  const groups = {};
  SESSIONS.forEach(s => { (groups[s.target] ||= []).push(s); });

  return (
    <AppFrame title="Sessions · grouped by target" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> Grouped by target</>}>
      <_SessionsToolbar view="list" />
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: W.bg }}>
        <_GroupBy active="target" />
      </div>
      <div style={{ position: 'relative' }}>
        {Object.entries(groups).map(([target, sess]) => (
          <div key={target}>
            <div style={{ padding: '6px 12px', background: W.bg2, borderTop: `1px solid ${W.rule}`, borderBottom: `1px solid ${W.rule2}`, fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: W.ink3, fontSize: 10.5 }}>▾</span>
              <span>{target}</span>
              <span style={{ fontSize: 10.5, color: W.ink3, fontWeight: 400 }}>{sess.length} sessions · {sess.reduce((a, s) => a + parseFloat(s.hrs), 0).toFixed(1)}h total</span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: W.ink3 }}>
                {Array.from(new Set(sess.flatMap(s => s.projects))).map(p => <Pill key={p} variant="info" size="xs">{p}</Pill>)}
              </span>
            </div>
            <table>
              <tbody>{sess.map(s => <_SessRow key={s.id} s={s} hideTarget />)}</tbody>
            </table>
          </div>
        ))}
        <Note side="left" x={16} y={20} width={190}>Grouped by target — collapses 247 rows into 53. Per-target chip strip shows which projects use that target.</Note>
      </div>
    </AppFrame>
  );
}

// --- C: Grouped by month/year ---
function WfSessionsByMonth() {
  const groups = {};
  SESSIONS.forEach(s => {
    const ym = s.night.slice(0, 7);
    (groups[ym] ||= []).push(s);
  });
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[+m - 1]} ${y}`;
  };

  return (
    <AppFrame title="Sessions · grouped by month" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> Grouped by month</>}>
      <_SessionsToolbar view="list" />
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: W.bg }}>
        <_GroupBy active="month" />
      </div>
      <div style={{ position: 'relative' }}>
        {Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([ym, sess]) => (
          <div key={ym}>
            <div style={{ padding: '6px 12px', background: W.bg2, borderTop: `1px solid ${W.rule}`, borderBottom: `1px solid ${W.rule2}`, fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: W.ink3, fontSize: 10.5 }}>▾</span>
              <span>{monthLabel(ym)}</span>
              <span style={{ fontSize: 10.5, color: W.ink3, fontWeight: 400 }}>{sess.length} sessions · {sess.reduce((a, s) => a + parseFloat(s.hrs), 0).toFixed(1)}h · {new Set(sess.map(s => s.target)).size} targets</span>
            </div>
            <table>
              <tbody>{sess.map(s => <_SessRow key={s.id} s={s} />)}</tbody>
            </table>
          </div>
        ))}
        <Note side="left" x={16} y={20} width={190}>Grouped by month — adds context (targets / hours per month) without being a separate "Timeline" view.</Note>
      </div>
    </AppFrame>
  );
}

// --- D: Grouped by optical train ---
function WfSessionsByTrain() {
  const groups = {};
  SESSIONS.forEach(s => { (groups[s.train] ||= []).push(s); });

  return (
    <AppFrame title="Sessions · grouped by optical train" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> Grouped by optical train</>}>
      <_SessionsToolbar view="list" />
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: W.bg }}>
        <_GroupBy active="optical train" />
      </div>
      <div style={{ position: 'relative' }}>
        {Object.entries(groups).map(([train, sess]) => (
          <div key={train}>
            <div style={{ padding: '6px 12px', background: W.bg2, borderTop: `1px solid ${W.rule}`, borderBottom: `1px solid ${W.rule2}`, fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: W.ink3, fontSize: 10.5 }}>▾</span>
              <span>{train}</span>
              <span style={{ fontSize: 10.5, color: W.ink3, fontWeight: 400 }}>{sess.length} sessions · {sess.reduce((a, s) => a + parseFloat(s.hrs), 0).toFixed(1)}h · {new Set(sess.map(s => s.target)).size} targets · {new Set(sess.map(s => s.filter)).size} filters</span>
            </div>
            <table>
              <tbody>{sess.map(s => <_SessRow key={s.id} s={s} hideTrain />)}</tbody>
            </table>
          </div>
        ))}
        <Note side="left" x={16} y={20} width={190}>Grouped by optical train — answers "what gear was I using when?" Useful for ensuring all sessions in a project share the same train.</Note>
      </div>
    </AppFrame>
  );
}

// --- E: Calendar view ---
function WfSessionsCalendar() {
  // Build month view for Nov 2024 + Dec 2024 + Jan 2025
  const months = [
    { y: 2024, m: 11, label: 'November 2024', first: 5 /*Nov 1 is Fri = idx 5*/, days: 30 },
    { y: 2024, m: 12, label: 'December 2024', first: 0 /*Dec 1 = Sun*/, days: 31 },
    { y: 2025, m: 1, label: 'January 2025', first: 3 /*Jan 1 = Wed*/, days: 31 },
  ];
  const byDay = {};
  SESSIONS.forEach(s => { (byDay[s.night] ||= []).push(s); });

  const Day = ({ y, m, d }) => {
    if (!d) return <div style={{ background: W.bg2, opacity: 0.3, minHeight: 64 }} />;
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const sess = byDay[key] || [];
    const hasIssue = sess.some(s => s.warn);
    return (
      <div style={{ background: W.bg, padding: 4, minHeight: 64, border: `1px solid ${W.rule2}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10.5, color: W.ink3, fontWeight: sess.length ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>{d}</span>
          {hasIssue && <span style={{ color: W.warn, fontSize: 10 }}>⚠</span>}
        </div>
        {sess.map(s => (
          <div key={s.id} style={{ marginTop: 2, padding: '1px 4px', background: s.warn ? '#f8f1d8' : W.bg2, border: `1px solid ${s.warn ? W.warn : W.rule2}`, fontSize: 10, lineHeight: 1.3, overflow: 'hidden' }}>
            <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.target}</div>
            <div style={{ color: W.ink3, fontSize: 9.5 }}>{s.filter} · {s.hrs}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AppFrame title="Sessions · calendar" active="sessions" navOverride="sidebar"
      breadcrumb={<>Sessions <Arr/> Calendar view</>}>
      <_SessionsToolbar view="calendar" />
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${W.rule2}`, background: W.bg, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Btn small>‹ Prev</Btn>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Nov 2024 — Jan 2025</span>
        <Btn small>Next ›</Btn>
        <Btn small>Today</Btn>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: W.ink3 }}>Click any night to filter list to that night</span>
      </div>
      <div style={{ padding: 12, position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {months.map(mo => {
          const cells = [];
          for (let i = 0; i < mo.first; i++) cells.push(null);
          for (let d = 1; d <= mo.days; d++) cells.push(d);
          return (
            <div key={mo.label}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{mo.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} style={{ fontSize: 10, color: W.ink3, textAlign: 'center', padding: '2px 0' }}>{d}</div>
                ))}
                {cells.map((d, i) => <Day key={i} y={mo.y} m={mo.m} d={d} />)}
              </div>
            </div>
          );
        })}
        <Note side="left" x={16} y={40} width={190}>Calendar shows gaps and multi-session nights visually — something a flat date sort can't.</Note>
      </div>
    </AppFrame>
  );
}

window.WfSessionsList = WfSessionsList;
window.WfSessionsByTarget = WfSessionsByTarget;
window.WfSessionsByMonth = WfSessionsByMonth;
window.WfSessionsByTrain = WfSessionsByTrain;
window.WfSessionsCalendar = WfSessionsCalendar;
