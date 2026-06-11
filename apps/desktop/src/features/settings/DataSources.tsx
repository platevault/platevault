// TODO(spec 003 (roots/sources)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Btn, Pill, Table } from '@/ui';
import {
  DATA_SOURCES,
  type DataSourceRoot,
} from '@/data/fixtures/settings';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const TYPE_VARIANT: Record<DataSourceRoot['type'], 'ok' | 'info' | 'neutral' | 'warn' | 'ghost'> = {
  Raw: 'ok',
  Calibration: 'info',
  Projects: 'neutral',
  Inbox: 'warn',
  Archive: 'ghost',
};

function makeId() {
  return Date.now();
}

export function DataSources({ save }: DataSourcesProps) {
  const [roots, setRoots] = useState<DataSourceRoot[]>(DATA_SOURCES);
  const [showAdd, setShowAdd] = useState(false);
  const [addingPath, setAddingPath] = useState('');
  const [addingType, setAddingType] = useState<DataSourceRoot['type']>('Raw');

  const handleAdd = () => {
    if (!addingPath.trim()) return;
    const newRoot: DataSourceRoot = {
      id: makeId(),
      path: addingPath.trim(),
      type: addingType,
      online: true,
      files: 0,
      size: '—',
      lastScan: 'never',
    };
    const updated = [...roots, newRoot];
    setRoots(updated);
    setAddingPath('');
    setShowAdd(false);
    save('roots', { roots: updated });
  };

  const handleRemove = (id: number) => {
    const updated = roots.filter((r) => r.id !== id);
    setRoots(updated);
    save('roots', { roots: updated });
  };

  return (
    <>
      <div className="alm-settings__group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--alm-sp-3)' }}>
          <div className="alm-settings__group-title" style={{ marginBottom: 0 }}>Library Roots</div>
          <Btn size="sm" onClick={() => setShowAdd(true)}>Add source folder</Btn>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', marginBottom: 'var(--alm-sp-3)', flexWrap: 'wrap' }}>
            <input
              className="alm-input"
              style={{ flex: 1, minWidth: 240 }}
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
              className="alm-select"
              value={addingType}
              onChange={(e) => setAddingType(e.target.value as DataSourceRoot['type'])}
              aria-label="Source type"
            >
              <option value="Raw">Raw</option>
              <option value="Calibration">Calibration</option>
              <option value="Projects">Projects</option>
              <option value="Inbox">Inbox</option>
              <option value="Archive">Archive</option>
            </select>
            <Btn size="sm" onClick={handleAdd} disabled={!addingPath.trim()}>Add</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}>
          {roots.map((root) => (
            <div
              key={root.id}
              style={{
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius)',
                padding: 'var(--alm-sp-3)',
                background: root.online ? undefined : 'var(--alm-surface2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}>
                <code className="alm-mono" style={{ flex: 1, fontSize: 'var(--alm-text-xs)', wordBreak: 'break-all' }}>
                  {root.path}
                </code>
                <div style={{ display: 'flex', gap: 'var(--alm-sp-1)', flexShrink: 0 }}>
                  <Pill variant={TYPE_VARIANT[root.type]}>{root.type}</Pill>
                  <Pill variant={root.online ? 'ok' : 'danger'}>{root.online ? 'Online' : 'Offline'}</Pill>
                </div>
              </div>
              {root.online && (
                <div style={{ marginTop: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', display: 'flex', gap: 'var(--alm-sp-3)' }}>
                  <span>{typeof root.files === 'number' ? root.files.toLocaleString() : root.files} files</span>
                  <span>{root.size}</span>
                  <span>Last scan: {root.lastScan}</span>
                </div>
              )}
              <div style={{ marginTop: 'var(--alm-sp-2)', display: 'flex', gap: 'var(--alm-sp-1)' }}>
                <Btn size="sm" variant="ghost" onClick={() => console.log('reveal', root.path)}>
                  Reveal
                </Btn>
                {!root.online && (
                  <Btn size="sm" variant="ghost" onClick={() => console.log('remap', root.path)}>
                    Remap
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => handleRemove(root.id)}>
                  Remove
                </Btn>
              </div>
            </div>
          ))}
          {roots.length === 0 && (
            <p style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
              No source folders registered. Click "Add source folder" to get started.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
