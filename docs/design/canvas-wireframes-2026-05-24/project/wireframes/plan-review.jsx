// Filesystem plan review — single page, toggle between table and diff views.
// Same plan: cleanup plan for "NGC 7000 · HOO" with 148 items.

const PLAN_META = {
  id: 'plan-#23',
  kind: 'Cleanup plan',
  project: 'NGC 7000 · HOO',
  state: 'ready_for_review',
  items: 148,
  reclaim: '2.1 GB',
  destructive: 4,
  protected: 11,
};

function _PlanHeader({ view }) {
  return (
    <Toolbar sub={<>
      <span><span className="mono">{PLAN_META.id}</span> · {PLAN_META.kind} · target: <b>{PLAN_META.project}</b></span>
      <span style={{ color: W.ink4 }}>·</span>
      <span>created 12 min ago · by user</span>
      <span style={{ marginLeft: 'auto', color: W.ink4 }}>dry-run: ✓ all preconditions satisfied</span>
    </>}>
      <Pill variant="warn" size="xs">READY FOR REVIEW</Pill><PinNum n={3} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{PLAN_META.kind}</span><PinNum n={1} />
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', border: `1px solid ${W.rule}`, borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ padding: '3px 10px', fontSize: 11, background: view === 'table' ? W.ink2 : W.bg, color: view === 'table' ? W.bg : W.ink2, borderRight: `1px solid ${W.rule}`, cursor: 'pointer' }}>Table</span>
        <span style={{ padding: '3px 10px', fontSize: 11, background: view === 'diff' ? W.ink2 : W.bg, color: view === 'diff' ? W.bg : W.ink2, cursor: 'pointer' }}>Diff (before / after)</span>
      </div>
      <PinNum n={2} />
      <Btn small>Discard</Btn>
      <Btn small>Edit policy →</Btn>
      <Btn primary small>Approve & apply</Btn>
    </Toolbar>
  );
}

function _PlanSummaryBar() {
  return (
    <div style={{ padding: '8px 14px', background: W.bg2, borderBottom: `1px solid ${W.rule}`, display: 'flex', gap: 18, fontSize: 11.5 }}>
      <div><span style={{ color: W.ink3 }}>Items: </span><b className="mono">{PLAN_META.items}</b><PinNum n={4} /></div>
      <div><span style={{ color: W.ink3 }}>Reclaim: </span><b className="mono">{PLAN_META.reclaim}</b></div>
      <div><span style={{ color: W.ink3 }}>Trash: </span><span className="mono">142</span></div>
      <div><span style={{ color: W.ink3 }}>Archive: </span><span className="mono">2</span></div>
      <div style={{ color: W.danger }}><span style={{ color: W.ink3 }}>Permanent delete: </span><b className="mono">{PLAN_META.destructive}</b></div>
      <div><span style={{ color: W.ink3 }}>Protected (skipped): </span><span className="mono">{PLAN_META.protected}</span></div>
      <div style={{ marginLeft: 'auto', color: W.warn }}>⚠ Destructive items require separate approval below</div>
    </div>
  );
}

function _PermDeleteApproval() {
  return (
    <div style={{ margin: 14, padding: '10px 12px', background: '#f7e8e2', border: `1px solid #d9b5a8`, position: 'relative' }}>
      <PinNum n={9} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: W.danger, fontSize: 14 }}>⚠</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: W.danger }}>This plan includes 4 permanent deletes</div>
          <div style={{ fontSize: 11.5, color: W.ink2 }}>Permanent delete is normally disabled. It was enabled for: <span className="mono">processing/pixinsight/temp/*.tmp</span>. These files will be unrecoverable.</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}><input type="checkbox" /> I understand and accept</label>
      </div>
    </div>
  );
}

// --- A: Table view ---
function WfPlanReviewTable() {
  const items = [
    { act: 'trash', src: 'processing/pixinsight/registered/Ha_300s_r_0001.xisf', dst: '~/.Trash/alm/plan-23/', size: '128 MB', cp: 'fail if exists', prov: 'generated' },
    { act: 'trash', src: 'processing/pixinsight/registered/Ha_300s_r_0002.xisf', dst: '~/.Trash/alm/plan-23/', size: '128 MB', cp: 'fail if exists', prov: 'generated' },
    { act: 'trash', src: 'processing/pixinsight/calibrated/Ha_300s_c_0001.xisf', dst: '~/.Trash/alm/plan-23/', size: '128 MB', cp: 'fail if exists', prov: 'generated' },
    { act: 'trash', src: 'processing/pixinsight/drizzle/*.drizzle', dst: '~/.Trash/alm/plan-23/', size: '880 MB (14 files)', cp: 'fail if exists', prov: 'generated' },
    { act: 'delete', src: 'processing/pixinsight/temp/_a3f7.tmp', dst: '—', size: '64 MB', cp: 'fail if exists', prov: 'generated', danger: true },
    { act: 'delete', src: 'processing/pixinsight/temp/_b21c.tmp', dst: '—', size: '64 MB', cp: 'fail if exists', prov: 'generated', danger: true },
    { act: 'archive', src: 'processing/pixinsight/logs/wbpp_2025-02-14.log', dst: 'archive/logs/', size: '2.4 MB', cp: 'rename', prov: 'generated' },
    { act: 'archive', src: 'processing/pixinsight/logs/wbpp_2025-02-15.log', dst: 'archive/logs/', size: '1.8 MB', cp: 'rename', prov: 'generated' },
    { act: 'remove_link', src: 'sources/views/wbpp_input_old/', dst: '—', size: '92 links', cp: 'fail if exists', prov: 'generated' },
    { act: 'protected', src: 'outputs/final/NGC7000_final_v3.tif', dst: '🔒 (skipped — protected)', size: '512 MB', cp: '—', prov: 'reviewed', skip: true },
    { act: 'protected', src: 'sources/manifests/manifest.json', dst: '🔒 (skipped — manifest)', size: '12 KB', cp: '—', prov: 'reviewed', skip: true },
  ];

  const actChip = (a) => {
    const map = {
      trash: { v: 'warn', l: 'trash' },
      delete: { v: 'danger', l: 'DELETE' },
      archive: { v: 'info', l: 'archive' },
      remove_link: { v: 'ghost', l: 'rm link' },
      protected: { v: 'ghost', l: '🔒 skip' },
    };
    const m = map[a];
    return <Pill variant={m.v} size="xs">{m.l}</Pill>;
  };

  return (
    <AppFrame title="Plan review · table" active="plans" navOverride="sidebar"
      breadcrumb={<>Plans <Arr/> {PLAN_META.id} (Cleanup) <Arr/> Table</>}>
      <_PlanHeader view="table" />
      <_PlanSummaryBar />

      <div style={{ padding: '8px 14px', background: W.bg, borderBottom: `1px solid ${W.rule2}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <FilterBar items={[{ k: 'action', v: 'all' }]} right={<span style={{ fontSize: 11, color: W.ink3 }}>148 of 148</span>} />
      </div>

      <div style={{ position: 'relative' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Action</th>
              <th style={{ width: 70 }}>Status</th>
              <th>Source path</th>
              <th>Destination</th>
              <th style={{ width: 90 }}>Size</th>
              <th style={{ width: 100 }}>Conflict</th>
              <th style={{ width: 80 }}>Provenance</th>
              <th style={{ width: 50 }}>Dry-run</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ background: it.danger ? '#faf0ec' : it.skip ? W.bg2 : 'transparent', opacity: it.skip ? 0.7 : 1 }}>
                <td>{actChip(it.act)}</td>
                <td><Pill variant="ghost" size="xs">{it.skip ? 'protected' : 'pending'}</Pill></td>
                <td className="mono" style={{ fontSize: 11 }}>{it.src}</td>
                <td className="mono" style={{ fontSize: 11, color: W.ink3 }}>{it.dst}</td>
                <td className="mono" style={{ fontSize: 11 }}>{it.size}</td>
                <td style={{ fontSize: 11, color: W.ink3 }}>{it.cp}</td>
                <td><Provenance origin={it.prov} /><span style={{ fontSize: 10.5, color: W.ink3 }}>{it.prov}</span></td>
                <td><span style={{ color: W.ok }}>✓</span></td>
              </tr>
            ))}
            <tr><td colSpan={8} style={{ fontSize: 11, color: W.ink3 }}>… 137 more items (filtered view)</td></tr>
          </tbody>
        </table>
        <Note n={2} side="left" x={16} y={20} width={210}>View toggle is in the header. Both views represent the <b>same</b> plan — switching never reorders or filters items.</Note>
        <Note n={5} side="left" x={16} y={180} width={210}>Per-row <b>Status pill</b>: separate from Action. Pending / applied / failed / protected / skipped. Tracks what happened to <em>this</em> row.</Note>
        <Note n={7} side="left" x={16} y={320} width={210}>Provenance origin per row. Confirms the plan didn't fabricate items.</Note>
      </div>
      <_PermDeleteApproval />
    </AppFrame>
  );
}

// --- B: Diff view ---
function WfPlanReviewDiff() {
  const FsLine = ({ depth = 0, name, status, size }) => {
    const colors = {
      keep: { c: W.ink2, g: ' ' },
      protected: { c: W.ink2, g: '🔒' },
      add: { c: W.ok, g: '+' },
      remove: { c: W.danger, g: '−' },
      archive: { c: W.warn, g: '→' },
      delete: { c: W.danger, g: '✕' },
    };
    const s = colors[status] || colors.keep;
    return (
      <div style={{ padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8 + depth * 14, fontSize: 11.5, color: s.c, background: status === 'remove' || status === 'delete' ? '#faf0ec' : status === 'add' ? '#eef5e8' : status === 'archive' ? '#f8f1d8' : 'transparent', borderBottom: `1px dotted ${W.rule2}` }}>
        <span className="mono" style={{ width: 14, textAlign: 'center', color: s.c }}>{s.g}</span>
        <span className="mono" style={{ flex: 1 }}>{name}</span>
        {size && <span className="mono" style={{ fontSize: 10.5, color: W.ink4 }}>{size}</span>}
      </div>
    );
  };

  return (
    <AppFrame title="Plan review · diff" active="plans" navOverride="sidebar"
      breadcrumb={<>Plans <Arr/> {PLAN_META.id} (Cleanup) <Arr/> Diff</>}>
      <_PlanHeader view="diff" />
      <_PlanSummaryBar />

      <div style={{ padding: '8px 14px', background: W.bg, borderBottom: `1px solid ${W.rule2}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, color: W.ink3 }}>− removed  + added  → archived  ✕ deleted  🔒 protected</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${W.rule}`, position: 'relative' }}>
        <div style={{ borderRight: `1px solid ${W.rule}` }}>
          <div style={{ padding: '6px 10px', background: W.bg2, borderBottom: `1px solid ${W.rule}`, fontSize: 11, color: W.ink3, fontWeight: 600 }}>BEFORE — current filesystem (8.4 GB)</div>
          <FsLine depth={0} name="NGC7000_HOO/" status="keep" size="8.4 GB" />
          <FsLine depth={1} name=".alm/" status="protected" />
          <FsLine depth={1} name="sources/" status="keep" />
          <FsLine depth={2} name="manifests/" status="protected" />
          <FsLine depth={2} name="views/wbpp_input/" status="keep" />
          <FsLine depth={2} name="views/wbpp_input_old/" status="remove" size="92 links" />
          <FsLine depth={1} name="processing/pixinsight/" status="keep" size="11.4 GB" />
          <FsLine depth={2} name="registered/" status="remove" size="11.4 GB" />
          <FsLine depth={3} name="(92 files)" status="remove" />
          <FsLine depth={2} name="calibrated/" status="remove" size="11.4 GB" />
          <FsLine depth={2} name="drizzle/" status="remove" size="880 MB" />
          <FsLine depth={2} name="temp/" status="delete" size="256 MB" />
          <FsLine depth={3} name="_a3f7.tmp" status="delete" size="64 MB" />
          <FsLine depth={3} name="_b21c.tmp" status="delete" size="64 MB" />
          <FsLine depth={2} name="logs/" status="archive" />
          <FsLine depth={3} name="wbpp_2025-02-14.log" status="archive" size="2.4 MB" />
          <FsLine depth={3} name="wbpp_2025-02-15.log" status="archive" size="1.8 MB" />
          <FsLine depth={2} name="process_icons/" status="keep" />
          <FsLine depth={1} name="outputs/" status="protected" size="512 MB" />
          <FsLine depth={1} name="notes/" status="protected" />
        </div>
        <div>
          <div style={{ padding: '6px 10px', background: W.bg2, borderBottom: `1px solid ${W.rule}`, fontSize: 11, color: W.ink3, fontWeight: 600 }}>AFTER — projected state (6.3 GB · −2.1 GB)</div>
          <FsLine depth={0} name="NGC7000_HOO/" status="keep" size="6.3 GB" />
          <FsLine depth={1} name=".alm/" status="protected" />
          <FsLine depth={1} name="sources/" status="keep" />
          <FsLine depth={2} name="manifests/" status="protected" />
          <FsLine depth={2} name="views/wbpp_input/" status="keep" />
          <FsLine depth={1} name="processing/pixinsight/" status="keep" />
          <FsLine depth={2} name="process_icons/" status="keep" />
          <FsLine depth={1} name="archive/" status="add" />
          <FsLine depth={2} name="logs/" status="add" />
          <FsLine depth={3} name="wbpp_2025-02-14.log" status="add" size="2.4 MB" />
          <FsLine depth={3} name="wbpp_2025-02-15.log" status="add" size="1.8 MB" />
          <FsLine depth={1} name="outputs/" status="protected" size="512 MB" />
          <FsLine depth={1} name="notes/" status="protected" />
          <div style={{ padding: 10, fontSize: 11, color: W.ink3, background: W.bg2, borderTop: `1px solid ${W.rule2}`, marginTop: 8 }}>
            + 1 dir added · − 4 dirs removed · 2 files moved to archive · 4 files permanently deleted
          </div>
        </div>
        <Note n={2} side="left" x={16} y={20} width={210}>Diff is a representation, not a different plan. Toggle to <b>Table</b> in the header for sortable rows.</Note>
        <Note n={3} side="left" x={16} y={180} width={210}>Glyph + tint per status: <b>− + → ✕ 🔒</b>. Color reinforces text, never carries it alone.</Note>
        <Note n={5} side="left" x={16} y={420} width={210}>Footer line summarizes the diff in plain English. Always present.</Note>
      </div>
      <_PermDeleteApproval />
    </AppFrame>
  );
}

window.WfPlanReviewTable = WfPlanReviewTable;
window.WfPlanReviewDiff = WfPlanReviewDiff;
