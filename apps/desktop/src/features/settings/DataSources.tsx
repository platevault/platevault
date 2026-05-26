import { useState } from 'react';
import clsx from 'clsx';
import { Btn, Pill } from '@/ui';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type SourceType = 'raw' | 'calibration' | 'project' | 'inbox' | 'archive' | 'overflow';

const TYPE_VARIANT: Record<SourceType, 'ok' | 'info' | 'warn' | 'neutral' | 'ghost' | 'danger'> = {
  raw: 'ok',
  calibration: 'info',
  project: 'neutral',
  inbox: 'warn',
  archive: 'ghost',
  overflow: 'ghost',
};

interface SourceRoot {
  id: string;
  path: string;
  type: SourceType;
}

const MOCK_ROOTS: SourceRoot[] = [
  { id: 'r1', path: 'D:\\Astrophotography\\Raw', type: 'raw' },
  { id: 'r2', path: 'D:\\Astrophotography\\Calibration', type: 'calibration' },
  { id: 'r3', path: 'D:\\Astrophotography\\Projects', type: 'project' },
  { id: 'r4', path: 'D:\\Astrophotography\\Inbox', type: 'inbox' },
  { id: 'r5', path: '\\\\NAS-2025\\astro\\archive', type: 'archive' },
  { id: 'r6', path: 'E:\\AstroOverflow', type: 'overflow' },
];

function makeId() {
  return `root-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function DataSources({ save }: DataSourcesProps) {
  const [roots, setRoots] = useState<SourceRoot[]>(MOCK_ROOTS);
  const [addingPath, setAddingPath] = useState('');
  const [addingType, setAddingType] = useState<SourceType>('raw');
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = () => {
    if (!addingPath.trim()) return;
    const newRoot: SourceRoot = {
      id: makeId(),
      path: addingPath.trim(),
      type: addingType,
    };
    const updated = [...roots, newRoot];
    setRoots(updated);
    setAddingPath('');
    setShowAdd(false);
    save('roots', { roots: updated.map((r) => ({ id: r.id, path: r.path, type: r.type })) });
  };

  const handleRemove = (id: string) => {
    const updated = roots.filter((r) => r.id !== id);
    setRoots(updated);
    save('roots', { roots: updated.map((r) => ({ id: r.id, path: r.path, type: r.type })) });
  };

  const handleReveal = (path: string) => {
    // Mock: in real app this would call Tauri shell.open
    console.log('Reveal in explorer:', path);
  };

  return (
    <div className="alm-datasources">
      <div className="alm-datasources__toolbar">
        <Btn size="sm" onClick={() => setShowAdd(true)}>
          Add source folder
        </Btn>
      </div>

      {showAdd && (
        <div className="alm-datasources__add-form">
          <div className="alm-datasources__add-row">
            <input
              className="alm-input alm-datasources__add-input"
              value={addingPath}
              onChange={(e) => setAddingPath(e.target.value)}
              placeholder="e.g. D:\Astrophotography\Raw"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') setShowAdd(false);
              }}
              autoFocus
              aria-label="Source folder path"
            />
            <select
              className="alm-select alm-datasources__add-select"
              value={addingType}
              onChange={(e) => setAddingType(e.target.value as SourceType)}
              aria-label="Source type"
            >
              <option value="raw">raw</option>
              <option value="calibration">calibration</option>
              <option value="project">project</option>
              <option value="inbox">inbox</option>
              <option value="archive">archive</option>
              <option value="overflow">overflow</option>
            </select>
            <Btn size="sm" onClick={handleAdd} disabled={!addingPath.trim()}>
              Add
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Btn>
          </div>
        </div>
      )}

      <table className="alm-datasources__table">
        <thead>
          <tr>
            <th>Path</th>
            <th className="alm-datasources__col-type">Type</th>
            <th className="alm-datasources__col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {roots.map((root) => (
            <tr key={root.id} className="alm-datasources__row">
              <td>
                <code className="alm-mono">{root.path}</code>
              </td>
              <td>
                <Pill
                  label={root.type}
                  variant={TYPE_VARIANT[root.type]}
                  size="sm"
                />
              </td>
              <td className="alm-datasources__row-actions">
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => handleReveal(root.path)}
                  aria-label={`Reveal ${root.path}`}
                >
                  Reveal
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(root.id)}
                  aria-label={`Remove ${root.path}`}
                >
                  Remove
                </Btn>
              </td>
            </tr>
          ))}
          {roots.length === 0 && (
            <tr>
              <td colSpan={3} className="alm-datasources__empty">
                No source folders registered. Click "Add source folder" to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
