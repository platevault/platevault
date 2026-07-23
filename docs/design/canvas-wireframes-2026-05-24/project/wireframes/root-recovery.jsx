// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Root recovery — drive went offline, reconnect with verification
function WfRootRecovery() {
  return (
    <AppFrame title="Reconnect root · NAS-Astro" active="settings" navOverride="sidebar"
      breadcrumb={<>Settings <Arr/> Data sources <Arr/> NAS-Astro (offline) <Arr/> Reconnect</>}>
      <div style={{ padding: 24, position: 'relative', maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: W.danger, fontSize: 18 }}>⚠</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>NAS-Astro is offline</div>
            <div style={{ fontSize: 12, color: W.ink3 }}>Last seen 6 days ago. 18,420 file records are tied to this root.</div>
          </div>
        </div>

        <Box style={{ marginTop: 16 }} title="What this workflow does">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: W.ink2 }}>
            <li>You provide the new path where this root lives now.</li>
            <li>The app picks 4 sample files and looks for them under the new path.</li>
            <li>If they match (path + size + optional hash), the root is remapped — all relationships and projects are preserved.</li>
            <li>If they don't, no changes are made. You can pick a different path or cancel.</li>
          </ol>
        </Box>

        <div style={{ marginTop: 14 }}>
          <Box title="Original mount">
            <KV k="Root id" v={<span className="mono">root-nas-astro</span>} />
            <KV k="Original path" v={<span className="mono">\\\\NAS\\astro</span>} />
            <KV k="Category" v="Inbox" />
            <KV k="Records tied" v="18,420 files · 22 sessions · 1 project" />
            <KV k="Last successful scan" v="2025-02-18 23:11" />
          </Box>
        </div>

        <div style={{ marginTop: 14 }}>
          <Box title="New path">
            <DirPicker value="\\\\NAS-2025\\astro" />
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <Btn>Verify</Btn>
              <span style={{ flex: 1 }} />
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: W.ink3 }}>The new path can be on a different drive letter, host, or mount.</div>
          </Box>
        </div>

        <div style={{ marginTop: 14 }}>
          <Box title="Sample verification" right={<Pill variant="ok" size="xs">4 / 4 OK</Pill>}>
            <table>
              <thead><tr><th></th><th>Sample file (record)</th><th>Found at new path</th><th>Size match</th><th>Hash</th></tr></thead>
              <tbody>
                {[
                  ['astro\\raw\\2024-10-04\\M31_L_0001.fit', '\\\\NAS-2025\\astro\\raw\\2024-10-04\\M31_L_0001.fit', true, 'n/a'],
                  ['astro\\raw\\2024-10-05\\M31_L_0001.fit', '\\\\NAS-2025\\astro\\raw\\2024-10-05\\M31_L_0001.fit', true, 'n/a'],
                  ['astro\\cal\\masters\\MasterBias_g100.xisf', '\\\\NAS-2025\\astro\\cal\\masters\\MasterBias_g100.xisf', true, '✓ matched'],
                  ['astro\\projects\\M31_LRGB\\.alm\\project.json', '\\\\NAS-2025\\astro\\projects\\M31_LRGB\\.alm\\project.json', true, '✓ matched'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td><span style={{ color: W.ok }}>✓</span></td>
                    <td className="mono" style={{ fontSize: 11 }}>{r[0]}</td>
                    <td className="mono" style={{ fontSize: 11, color: W.ink3 }}>{r[1]}</td>
                    <td>{r[2] ? <Pill variant="ok" size="xs">match</Pill> : <Pill variant="danger" size="xs">mismatch</Pill>}</td>
                    <td style={{ fontSize: 11 }}>{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </div>

        <div style={{ marginTop: 14 }}>
          <Box title="What will change">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: W.ink2 }}>
              <li>The root's stored path will update from <span className="mono">\\NAS\astro</span> → <span className="mono">\\NAS-2025\astro</span>.</li>
              <li>All 18,420 file records will resolve to the new path (no files are moved).</li>
              <li>The 22 sessions and 1 project on this root remain linked.</li>
              <li>An audit log entry will be created: <span className="mono">root.remapped</span>.</li>
            </ul>
          </Box>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: `1px solid ${W.rule}` }}>
          <Btn>Cancel</Btn>
          <Btn primary>Apply remap</Btn>
        </div>

        <Note side="left" x={16} y={60} width={200}>Recovery verifies before remapping. Sample matches must succeed — there's no "trust me, this is the same data" path.</Note>
      </div>
    </AppFrame>
  );
}
window.WfRootRecovery = WfRootRecovery;
