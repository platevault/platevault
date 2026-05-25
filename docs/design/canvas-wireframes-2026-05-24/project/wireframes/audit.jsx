// Audit log — append-only event log
function WfAudit() {
  const events = [
    { t: '2025-02-24 14:32:18', evt: 'plan.approved', ent: 'plan-#23', from: 'ready_for_review', to: 'approved', act: 'user', out: 'applied', det: 'cleanup plan · 148 items · 2.1 GB reclaim', danger: false },
    { t: '2025-02-24 14:32:18', evt: 'plan.applying', ent: 'plan-#23', from: 'approved', to: 'applying', act: 'system', out: '—' },
    { t: '2025-02-24 14:32:20', evt: 'planitem.applied', ent: 'plan-#23 / item 1', from: 'pending', to: 'applied', act: 'system', out: 'ok', det: 'trash registered/Ha_300s_r_0001.xisf' },
    { t: '2025-02-24 14:32:21', evt: 'planitem.applied', ent: 'plan-#23 / item 2', from: 'pending', to: 'applied', act: 'system', out: 'ok' },
    { t: '2025-02-24 14:35:02', evt: 'planitem.failed', ent: 'plan-#23 / item 47', from: 'pending', to: 'failed', act: 'system', out: 'failed', det: 'EBUSY · file locked by another process', danger: true },
    { t: '2025-02-24 14:35:02', evt: 'plan.paused', ent: 'plan-#23', from: 'applying', to: 'paused', act: 'system', out: 'paused', det: 'item failure · awaiting user' },
    { t: '2025-02-24 13:18:44', evt: 'session.confirmed', ent: 'acq-a3f7…2b · NGC 7000 Ha 11-30', from: 'needs_review', to: 'confirmed', act: 'user', out: 'applied', det: 'observer_location reviewed → Truckee, CA' },
    { t: '2025-02-24 13:14:11', evt: 'classification.confirmed', ent: 'D:\\…\\IMG_0142.fit', from: 'unknown', to: 'raw light', act: 'user', out: 'applied', det: 'rule saved: **/untitled/*.fit → raw light' },
    { t: '2025-02-23 22:01:09', evt: 'project.transition', ent: 'NGC 7000 · HOO', from: 'prepared', to: 'processing', act: 'user', out: 'applied' },
    { t: '2025-02-23 21:58:31', evt: 'sourceview.generated', ent: 'NGC 7000 · HOO / wbpp_input', from: '—', to: 'applied', act: 'user', out: 'applied', det: 'strategy: NTFS junction · 92 items · plan-#18' },
    { t: '2025-02-23 18:42:01', evt: 'project.transition.refused', ent: 'NGC 7000 · HOO', from: 'ready', to: 'prepared', act: 'user', out: 'refused', det: 'observer_location not reviewed for acq-a3f7…2b', danger: true },
    { t: '2025-02-22 11:30:00', evt: 'root.remapped', ent: 'NAS-Astro', from: '\\\\NAS\\astro', to: '\\\\NAS-2025\\astro', act: 'user', out: 'applied', det: '4 sample files verified · 18,420 relationships updated' },
    { t: '2025-02-20 09:11:42', evt: 'scan.completed', ent: 'D:\\Astrophotography', from: 'running', to: 'completed', act: 'system', out: 'ok', det: '142,318 files indexed · 318 unreviewed' },
  ];

  return (
    <AppFrame title="Audit log" active="audit" navOverride="sidebar"
      breadcrumb={<>Audit log <Arr/> All events</>}>
      <Toolbar sub={<><span>2,840 entries</span><span style={{ color: W.ink4 }}>·</span><span>retention: forever · append-only · immutable</span><span style={{ marginLeft: 'auto' }}><Btn small>Export JSONL</Btn></span></>}>
        <input placeholder="Search entity, event…" style={{ flex: 1, padding: '4px 8px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 12 }} />
        <select style={{ padding: '4px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}><option>Event: all</option></select>
        <select style={{ padding: '4px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}><option>Outcome: all</option></select>
        <select style={{ padding: '4px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}><option>Actor: all</option></select>
        <select style={{ padding: '4px 6px', border: `1px solid ${W.rule}`, background: W.bg, fontSize: 11 }}><option>Last 7 days</option></select>
      </Toolbar>

      <div style={{ position: 'relative' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 140 }}>Timestamp</th>
              <th style={{ width: 170 }}>Event</th>
              <th>Entity</th>
              <th style={{ width: 180 }}>State change</th>
              <th style={{ width: 70 }}>Actor</th>
              <th style={{ width: 80 }}>Outcome</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i} style={{ background: e.danger ? '#faf0ec' : e.out === 'paused' ? '#f8f1d8' : 'transparent' }}>
                <td className="mono" style={{ fontSize: 11 }}>{e.t}</td>
                <td className="mono" style={{ fontSize: 11 }}>{e.evt}</td>
                <td style={{ fontSize: 11.5 }}>{e.ent}</td>
                <td style={{ fontSize: 11 }} className="mono">
                  {e.from && e.to && e.from !== e.to ? <><span style={{ color: W.ink3 }}>{e.from}</span> <span style={{ color: W.ink4 }}>→</span> <span>{e.to}</span></> : <span style={{ color: W.ink4 }}>—</span>}
                </td>
                <td style={{ fontSize: 11, color: e.act === 'system' ? W.ink3 : W.ink }}>{e.act}</td>
                <td>
                  {e.out === 'applied' && <Pill variant="ok" size="xs">applied</Pill>}
                  {e.out === 'ok' && <Pill variant="ok" size="xs">ok</Pill>}
                  {e.out === 'refused' && <Pill variant="danger" size="xs">refused</Pill>}
                  {e.out === 'failed' && <Pill variant="danger" size="xs">failed</Pill>}
                  {e.out === 'paused' && <Pill variant="warn" size="xs">paused</Pill>}
                  {e.out === '—' && <span style={{ color: W.ink4 }}>—</span>}
                </td>
                <td style={{ fontSize: 11, color: W.ink2 }}>{e.det}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note side="left" x={16} y={20} width={190}>Audit shows refused transitions too — when the app blocked the user, it's logged so the user can see why.</Note>
      </div>
    </AppFrame>
  );
}
window.WfAudit = WfAudit;
