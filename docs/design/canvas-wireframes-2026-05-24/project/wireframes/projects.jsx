// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Projects list
function WfProjects() {
  const projects = [
    { name: 'NGC 7000 · HOO', target: 'NGC 7000', profile: 'PixInsight/WBPP', state: 'processing', verif: '1 accepted', sess: 2, integ: '7.7h', size: '8.4 GB', updated: '2 days ago', cleanup: '2.1 GB candidate' },
    { name: 'NGC 7000 · SHO mosaic', target: 'NGC 7000 (4 panels)', profile: 'PixInsight/WBPP', state: 'ready', verif: '—', sess: 4, integ: '12.0h', size: '14.2 GB', updated: '6 days ago', cleanup: '—' },
    { name: 'M31 · LRGB', target: 'M31', profile: 'PixInsight/WBPP', state: 'completed', verif: '2 accepted', sess: 8, integ: '11.8h', size: '11.0 GB', updated: '3 weeks ago', cleanup: '4.8 GB ready' },
    { name: 'M31 · 2022 (legacy)', target: 'M31', profile: 'PixInsight/WBPP', state: 'archived', verif: '1 accepted', sess: 12, integ: '18.4h', size: '480 MB (archived)', updated: '6 months ago', cleanup: '—' },
    { name: 'IC 1396 · HOO', target: 'IC 1396', profile: 'PixInsight/WBPP', state: 'prepared', verif: '—', sess: 2, integ: '9.3h', size: '6.1 GB', updated: 'yesterday', cleanup: '—' },
    { name: 'Jupiter 2025-02-03', target: 'Jupiter', profile: 'planetary/lunar', state: 'completed', verif: '1 accepted', sess: 1, integ: '0.5h', size: '2.4 GB', updated: '3 months ago', cleanup: '1.8 GB ready' },
    { name: 'untitled-attempt', target: '?', profile: '—', state: 'blocked', verif: '—', sess: 0, integ: '—', size: '420 MB', updated: '4 months ago', warn: 'non-conforming structure · classified as project-like material' },
  ];

  const lifecycle = (s) => {
    const map = {
      setup_incomplete: { v: 'warn', l: 'setup incomplete' },
      ready: { v: 'ghost', l: 'ready' },
      prepared: { v: 'info', l: 'prepared' },
      processing: { v: 'info', l: 'processing' },
      completed: { v: 'ok', l: 'completed' },
      archived: { v: 'neutral', l: 'archived' },
      blocked: { v: 'danger', l: 'blocked' },
    };
    const m = map[s];
    return <Pill variant={m.v} size="xs">{m.l}</Pill>;
  };

  return (
    <AppFrame title="Projects" active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> All projects</>}>
      <Toolbar sub={<><span>19 projects</span><span style={{ color: W.ink4 }}>·</span><span>12 active · 4 completed · 3 archived</span><span style={{ color: W.ink4 }}>·</span><span>1 blocked</span></>}>
        <input placeholder="Search projects, targets…" style={{ flex: 1, padding: '4px 8px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 12 }} />
        <Btn small active>Table</Btn>
        <Btn small>Cards</Btn>
        <span style={{ width: 1, height: 18, background: W.rule }} />
        <Btn small>Filter: state ▾</Btn>
        <Btn primary small>+ New project</Btn>
      </Toolbar>

      <div style={{ position: 'relative' }}>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Target</th>
              <th>Profile</th>
              <th style={{ width: 110 }}>Lifecycle</th>
              <th style={{ width: 50 }}>Sess.</th>
              <th style={{ width: 60 }}>Integ.</th>
              <th>Outputs</th>
              <th style={{ width: 110 }}>Size on disk</th>
              <th style={{ width: 130 }}>Cleanup</th>
              <th style={{ width: 100 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p, i) => (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{p.name} →</div>
                  {p.warn && <div style={{ fontSize: 10.5, color: W.warn }}>⚠ {p.warn}</div>}
                </td>
                <td>{p.target}</td>
                <td style={{ fontSize: 11 }}>{p.profile}</td>
                <td>{lifecycle(p.state)}</td>
                <td className="mono" style={{ fontSize: 11 }}>{p.sess}</td>
                <td className="mono" style={{ fontSize: 11 }}>{p.integ}</td>
                <td style={{ fontSize: 11 }}>{p.verif === '—' ? <span style={{ color: W.ink4 }}>—</span> : <Pill variant="ok" size="xs">{p.verif}</Pill>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{p.size}</td>
                <td style={{ fontSize: 11, color: p.cleanup === '—' ? W.ink4 : W.ink2 }}>{p.cleanup}</td>
                <td style={{ fontSize: 11, color: W.ink3 }}>{p.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Note side="left" x={16} y={20} width={190}>Projects list shows lifecycle + cleanup state inline. "blocked" surfaces with a reason; "archived" stays visible (not hidden).</Note>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', gap: 18, fontSize: 11, color: W.ink3, borderTop: `1px solid ${W.rule2}` }}>
        <span>Total integration across active: <span className="mono" style={{ color: W.ink }}>59.3h</span></span>
        <span>Total on disk: <span className="mono" style={{ color: W.ink }}>42.5 GB</span></span>
        <span>Cleanup-eligible: <span className="mono" style={{ color: W.ink2 }}>8.7 GB</span></span>
      </div>
    </AppFrame>
  );
}
window.WfProjects = WfProjects;
