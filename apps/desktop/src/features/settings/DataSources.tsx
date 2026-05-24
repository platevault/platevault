import { useState, useEffect } from 'react';
import { Select } from '@base-ui-components/react/select';
import { listRoots, registerRoot, startScan } from '@/api/commands';
import { DirPicker, Btn, Pill } from '@/ui';
import type { LibraryRoot } from '@/api/types';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const CATEGORY_VARIANT: Record<string, 'info' | 'ok' | 'warn' | 'neutral'> = {
  raw: 'info',
  calibration: 'ok',
  project: 'neutral',
  inbox: 'warn',
};

const CATEGORIES = ['raw', 'calibration', 'project', 'inbox'] as const;

export function DataSources({ save }: DataSourcesProps) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newCategory, setNewCategory] = useState<string>('raw');

  useEffect(() => {
    listRoots().then(setRoots);
  }, []);

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
      <table className="alm-datasources__table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Category</th>
            <th>State</th>
            <th>Files</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((root) => (
            <tr
              key={root.id}
              className={!root.online ? 'alm-datasources__row--offline' : undefined}
            >
              <td>
                <code className="alm-mono">{root.path}</code>
              </td>
              <td>
                <Pill
                  label={root.category}
                  variant={CATEGORY_VARIANT[root.category] ?? 'neutral'}
                  size="sm"
                />
              </td>
              <td>
                {root.online ? (
                  <span className="alm-datasources__online">Online</span>
                ) : (
                  <span className="alm-datasources__offline">Offline</span>
                )}
              </td>
              <td>{root.file_count.toLocaleString()}</td>
              <td>
                <Btn size="sm" onClick={() => handleScan(root.id)}>
                  Scan
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add root */}
      <div className="alm-datasources__add">
        <DirPicker value={newPath} onChange={setNewPath} label="New root" />
        <Select.Root
          value={newCategory}
          onValueChange={(value) => { if (value !== null) setNewCategory(value); }}
        >
          <Select.Trigger className="alm-select" aria-label="Root category">
            <Select.Value />
            <Select.Icon className="alm-select__icon" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup className="alm-select__popup">
                {CATEGORIES.map((cat) => (
                  <Select.Item key={cat} value={cat} className="alm-select__item">
                    <Select.ItemText>{cat}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
        <Btn size="sm" variant="primary" onClick={handleAddRoot} disabled={!newPath}>
          Add root
        </Btn>
      </div>
    </div>
  );
}
