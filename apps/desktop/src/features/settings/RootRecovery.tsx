import { useState } from 'react';
import { remapRoot, applyRootRemap } from '@/api/commands';
import { Btn, Pill, Box, KV } from '@/ui';
import type { RemapVerification } from '@/api/types';

/** Wireframe fixture data for the verification samples */
const FIXTURE_SAMPLES = [
  { relative: 'astro\\raw\\2024-10-04\\M31_L_0001.fit', found_at: '\\\\NAS-2025\\astro\\raw\\2024-10-04\\M31_L_0001.fit', size_match: true, hash: 'n/a' },
  { relative: 'astro\\raw\\2024-10-05\\M31_L_0001.fit', found_at: '\\\\NAS-2025\\astro\\raw\\2024-10-05\\M31_L_0001.fit', size_match: true, hash: 'n/a' },
  { relative: 'astro\\cal\\masters\\MasterBias_g100.xisf', found_at: '\\\\NAS-2025\\astro\\cal\\masters\\MasterBias_g100.xisf', size_match: true, hash: '✓ matched' },
  { relative: 'astro\\projects\\M31_LRGB\\.alm\\project.json', found_at: '\\\\NAS-2025\\astro\\projects\\M31_LRGB\\.alm\\project.json', size_match: true, hash: '✓ matched' },
];

export function RootRecovery() {
  const [rootId] = useState('root-nas-astro');
  const [newPath, setNewPath] = useState('\\\\NAS-2025\\astro');
  const [verified, setVerified] = useState(true);
  const [applying, setApplying] = useState(false);

  const handleVerify = async () => {
    if (!newPath) return;
    try {
      await remapRoot({ root_id: rootId, new_path: newPath });
    } catch {
      // fixture mode: just show verified
    }
    setVerified(true);
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await applyRootRemap({ root_id: rootId, verified: true });
    } catch {
      // fixture mode
    }
    setApplying(false);
  };

  return (
    <div className="alm-recovery">
      <div className="alm-recovery__container">
        {/* Offline banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--alm-danger)', fontSize: 18 }}>&#9888;</span>
          <div>
            <div style={{ fontSize: 'var(--alm-text-xl)', fontWeight: 600 }}>NAS-Astro is offline</div>
            <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
              Last seen 6 days ago. 18,420 file records are tied to this root.
            </div>
          </div>
        </div>

        {/* What this workflow does */}
        <Box heading="What this workflow does">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-secondary)' }}>
            <li>You provide the new path where this root lives now.</li>
            <li>The app picks 4 sample files and looks for them under the new path.</li>
            <li>If they match (path + size + optional hash), the root is remapped -- all relationships and projects are preserved.</li>
            <li>If they don't, no changes are made. You can pick a different path or cancel.</li>
          </ol>
        </Box>

        {/* Original mount */}
        <Box heading="Original mount">
          <KV label="Root id" value={<code className="alm-mono">root-nas-astro</code>} />
          <KV label="Original path" value={<code className="alm-mono">\\\\NAS\\astro</code>} />
          <KV label="Category" value="Inbox" />
          <KV label="Records tied" value="18,420 files · 22 sessions · 1 project" />
          <KV label="Last successful scan" value="2025-02-18 23:11" />
        </Box>

        {/* New path */}
        <Box heading="New path">
          <div style={{
            display: 'flex', alignItems: 'stretch',
            border: '1px solid var(--alm-border)', background: 'var(--alm-bg)',
          }}>
            <div style={{
              padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
              borderRight: '1px solid var(--alm-border)', background: 'var(--alm-surface)',
            }}>
              <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
                &#128193;
              </span>
            </div>
            <div
              className="alm-mono"
              style={{
                flex: 1, padding: '5px 10px', fontSize: 'var(--alm-text-xs)',
                color: newPath ? 'var(--alm-text)' : 'var(--alm-text-faint)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                alignSelf: 'center',
              }}
            >
              {newPath || 'No folder selected'}
            </div>
            <button
              type="button"
              style={{
                padding: '5px 12px', border: 'none',
                borderLeft: '1px solid var(--alm-border)',
                background: 'var(--alm-surface)', fontSize: 'var(--alm-text-sm)',
                color: 'var(--alm-text-secondary)', cursor: 'pointer',
              }}
            >
              Choose folder&hellip;
            </button>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <Btn onClick={handleVerify}>Verify</Btn>
          </div>
          <div style={{ marginTop: 4, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            The new path can be on a different drive letter, host, or mount.
          </div>
        </Box>

        {/* Sample verification */}
        {verified && (
          <Box heading="Sample verification">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--alm-space-3)' }}>
              <Pill label="4 / 4 OK" variant="ok" size="sm" />
            </div>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Sample file (record)</th>
                  <th>Found at new path</th>
                  <th style={{ width: 90 }}>Size match</th>
                  <th style={{ width: 90 }}>Hash</th>
                </tr>
              </thead>
              <tbody>
                {FIXTURE_SAMPLES.map((s, i) => (
                  <tr key={i}>
                    <td><span style={{ color: 'var(--alm-ok)' }}>&#10003;</span></td>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{s.relative}</td>
                    <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{s.found_at}</td>
                    <td>
                      {s.size_match
                        ? <Pill label="match" variant="ok" size="sm" />
                        : <Pill label="mismatch" variant="danger" size="sm" />
                      }
                    </td>
                    <td style={{ fontSize: 'var(--alm-text-xs)' }}>{s.hash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}

        {/* What will change */}
        {verified && (
          <Box heading="What will change">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-secondary)' }}>
              <li>
                The root's stored path will update from{' '}
                <code className="alm-mono">\\NAS\astro</code> &rarr;{' '}
                <code className="alm-mono">\\NAS-2025\astro</code>.
              </li>
              <li>All 18,420 file records will resolve to the new path (no files are moved).</li>
              <li>The 22 sessions and 1 project on this root remain linked.</li>
              <li>An audit log entry will be created: <code className="alm-mono">root.remapped</code>.</li>
            </ul>
          </Box>
        )}

        {/* Action bar */}
        {verified && (
          <div style={{
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            paddingTop: 12, borderTop: '1px solid var(--alm-border)',
          }}>
            <Btn>Cancel</Btn>
            <Btn variant="primary" onClick={handleApply} disabled={applying}>
              {applying ? 'Applying...' : 'Apply remap'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
