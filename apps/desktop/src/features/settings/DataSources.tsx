import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Select } from '@base-ui-components/react/select';
import { listRoots, registerRoot, startScan } from '@/api/commands';
import { setPreference } from '@/data/preferences';
import { DirPicker, Btn, Pill, Box, KV } from '@/ui';
import type { LibraryRoot } from '@/bindings/types';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const CATEGORY_VARIANT: Record<string, 'ghost' | 'ok' | 'warn' | 'info' | 'neutral'> = {
  raw: 'ghost',
  calibration: 'ghost',
  project: 'ghost',
  inbox: 'ghost',
};

const CATEGORIES = ['raw', 'calibration', 'project', 'inbox'] as const;

/** Wireframe-accurate data-source roots for fixture mode */
const FIXTURE_ROOTS: LibraryRoot[] = [
  { id: 'root-1', path: 'D:\\Astrophotography\\Raw', category: 'raw', online: true, file_count: 84231, last_scanned: '2h ago' },
  { id: 'root-2', path: 'D:\\Astrophotography\\Calibration', category: 'calibration', online: true, file_count: 12044, last_scanned: '2h ago' },
  { id: 'root-3', path: 'D:\\Astrophotography\\Projects', category: 'project', online: true, file_count: 38112, last_scanned: '2h ago' },
  { id: 'root-4', path: 'D:\\Astrophotography\\Inbox', category: 'inbox', online: true, file_count: 1842, last_scanned: '2h ago' },
  { id: 'root-5', path: '\\\\NAS-2025\\astro\\archive', category: 'inbox', online: false, file_count: 0, last_scanned: undefined },
  { id: 'root-6', path: 'E:\\AstroOverflow', category: 'raw', online: true, file_count: 7931, last_scanned: '2h ago' },
];

export function DataSources({ save }: DataSourcesProps) {
  const navigate = useNavigate();
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newCategory, setNewCategory] = useState<string>('raw');
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const handleRestartWizard = useCallback(async () => {
    setRestarting(true);
    try {
      const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
      if (!useMocks) {
        const { commands } = await import('@/bindings/index');
        const restartResult = await commands.firstrunRestart();
        if (restartResult.status !== 'ok') throw new Error('restart failed');
        const categories = [
          { key: 'raw', label: 'Raw sources', note: 'where light frames live', required: true, paths: [] as string[], estimates: [] as number[] },
          { key: 'calibration', label: 'Calibration sources', note: 'darks, flats, biases', required: false, paths: [] as string[], estimates: [] as number[] },
          { key: 'project', label: 'Project sources', note: 'processing projects', required: true, paths: [] as string[], estimates: [] as number[] },
          { key: 'inbox', label: 'Inbox sources', note: 'new / unprocessed', required: false, paths: [] as string[], estimates: [] as number[] },
        ];
        for (const src of restartResult.data.prefilledSources) {
          const cat = categories.find((c) => c.key === src.kind);
          if (cat) cat.paths.push(src.path);
        }
        localStorage.setItem('alm-setup-wizard-state', JSON.stringify({
          currentStep: 0,
          categories,
          catalogSettings: {},
          scanSettings: {},
        }));
      }
      setPreference('setupCompleted', false);
      setShowRestartConfirm(false);
      navigate({ to: '/setup' });
    } catch {
      setRestarting(false);
    }
  }, [navigate]);

  useEffect(() => {
    listRoots().then((loaded) => {
      setRoots(loaded.length > 0 ? loaded : FIXTURE_ROOTS);
    }).catch(() => {
      setRoots(FIXTURE_ROOTS);
    });
  }, []);

  const totalFiles = roots.reduce(
    (sum, r) => sum + (typeof r.file_count === 'number' ? r.file_count : 0),
    0,
  );

  const handleAddRoot = async () => {
    if (!newPath) return;
    const root = await registerRoot({
      path: newPath,
      category: newCategory,
      scan_settings: { follow_symlinks: false, excluded_patterns: [] },
    });
    setRoots((prev) => [...prev, root]);
    setNewPath('');
    save('roots', { roots: [...roots, root].map((r) => r.id) });
  };

  const handleScan = async (rootId: string) => {
    await startScan({ root_ids: [rootId] });
  };

  return (
    <div className="alm-datasources">
      {/* Section header */}
      <div className="alm-datasources__section-header">
        <span className="alm-datasources__section-title">Registered roots</span>
        <span className="alm-datasources__section-sub">
          {roots.length} roots &middot; {totalFiles.toLocaleString()} files indexed
        </span>
        <Btn size="sm" onClick={handleAddRoot} disabled={!newPath}>
          + Add root&hellip;
        </Btn>
      </div>

      <table className="alm-datasources__table">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Path</th>
            <th style={{ width: 110 }}>Category</th>
            <th style={{ width: 70 }}>State</th>
            <th style={{ width: 80 }}>Files</th>
            <th style={{ width: 110 }}>Last scan</th>
            <th style={{ width: 130 }}></th>
          </tr>
        </thead>
        <tbody>
          {roots.map((root) => (
            <tr
              key={root.id}
              className={!root.online ? 'alm-datasources__row--offline' : undefined}
            >
              <td>
                {!root.online ? (
                  <span className="alm-text-warn">&#9888;</span>
                ) : (
                  <span style={{ color: 'var(--alm-ok)' }}>&#9679;</span>
                )}
              </td>
              <td style={{ minWidth: 280 }}>
                <code className="alm-mono">{root.path}</code>
              </td>
              <td>
                <Pill
                  label={root.category}
                  variant={CATEGORY_VARIANT[root.category] ?? 'ghost'}
                  size="sm"
                />
              </td>
              <td>
                {root.online ? (
                  <Pill label="online" variant="ok" size="sm" />
                ) : (
                  <Pill label="offline" variant="danger" size="sm" />
                )}
              </td>
              <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                {root.file_count > 0 ? root.file_count.toLocaleString() : '?'}
              </td>
              <td style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                {root.last_scanned ?? 'never'}
              </td>
              <td>
                {!root.online ? (
                  <Btn size="sm">Reconnect&hellip;</Btn>
                ) : (
                  <Btn size="sm" onClick={() => handleScan(root.id)}>
                    Re-scan
                  </Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Two-column boxes below */}
      <div className="alm-datasources__boxes">
        <Box heading="Scan defaults">
          <KV label="Follow symlinks" value={<><input type="checkbox" /> no</>} />
          <KV label="Follow junctions" value={<><input type="checkbox" /> no</>} />
          <KV
            label="Hashing"
            value={
              <select className="alm-select alm-select--sm">
                <option>lazy (recommended)</option>
              </select>
            }
          />
          <KV
            label="Metadata extraction"
            value={
              <select className="alm-select alm-select--sm">
                <option>FITS + XISF + sidecar</option>
              </select>
            }
          />
        </Box>
        <Box heading="What happens to new files in the inbox?">
          <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)', margin: 0 }}>
            Inbox roots are <strong>scanned in place</strong> -- files are not moved or modified.
            New material appears in the Review queue as session candidates, where you confirm them.
            They stay where they are on disk; the app just indexes them.
          </p>
          <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', margin: 0, marginTop: 6 }}>
            If you want to physically reorganize inbox files into your raw tree, do it through
            your filesystem -- this app does not move source files.
          </p>
        </Box>
      </div>

      {/* Restart setup wizard */}
      <div style={{ marginTop: 'var(--alm-space-7)', paddingTop: 'var(--alm-space-5)', borderTop: '1px solid var(--alm-border)' }}>
        {!showRestartConfirm ? (
          <Btn size="sm" onClick={() => setShowRestartConfirm(true)}>
            Restart setup wizard&hellip;
          </Btn>
        ) : (
          <Box>
            <p style={{ fontSize: 'var(--alm-text-sm)', margin: 0, marginBottom: 'var(--alm-space-3)' }}>
              This will re-open the first-run setup wizard. Your existing source
              roots will be prefilled so you can review and edit them.
            </p>
            <div style={{ display: 'flex', gap: 'var(--alm-space-3)' }}>
              <Btn variant="primary" size="sm" onClick={handleRestartWizard} disabled={restarting}>
                {restarting ? 'Restarting…' : 'Confirm restart'}
              </Btn>
              <Btn size="sm" onClick={() => setShowRestartConfirm(false)} disabled={restarting}>
                Cancel
              </Btn>
            </div>
          </Box>
        )}
      </div>
    </div>
  );
}
