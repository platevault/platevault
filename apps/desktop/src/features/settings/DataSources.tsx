// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { listRoots, registerRoot } from '@/api/commands';
import type { LibraryRoot } from '@/bindings/types';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type RootCategory = LibraryRoot['category'];

const CATEGORY_VARIANT: Record<RootCategory, 'ok' | 'info' | 'neutral' | 'warn' | 'ghost'> = {
  raw: 'ok',
  calibration: 'info',
  project: 'neutral',
  inbox: 'warn',
};

const CATEGORY_LABEL: Record<RootCategory, string> = {
  raw: 'Raw',
  calibration: 'Calibration',
  project: 'Project',
  inbox: 'Inbox',
};

export function DataSources({ save: _save }: DataSourcesProps) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addingPath, setAddingPath] = useState('');
  const [addingCategory, setAddingCategory] = useState<RootCategory>('raw');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const loadRoots = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listRoots()
      .then((data) => setRoots(data))
      .catch((err: unknown) => setLoadError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRoots();
  }, [loadRoots]);

  const handleAdd = async () => {
    if (!addingPath.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await registerRoot({
        path: addingPath.trim(),
        category: addingCategory,
        scanSettings: {},
      });
      setAddingPath('');
      setAddingCategory('raw');
      setShowAdd(false);
      loadRoots();
    } catch (err: unknown) {
      setAddError(String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-header">
          <div className="alm-settings__group-title">Library Roots</div>
          <Btn size="sm" onClick={() => { setShowAdd(true); setAddError(null); }}>
            Add source folder
          </Btn>
        </div>

        {showAdd && (
          <div style={{ marginBottom: 'var(--alm-sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
            <DirPicker
              value={addingPath}
              onChange={setAddingPath}
              label="Folder"
              lastPathKind="inbox"
            />
            <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="alm-select"
                value={addingCategory}
                onChange={(e) => setAddingCategory(e.target.value as RootCategory)}
                aria-label="Source category"
              >
                <option value="raw">Raw</option>
                <option value="calibration">Calibration</option>
                <option value="project">Project</option>
                <option value="inbox">Inbox</option>
              </select>
              <Btn size="sm" onClick={handleAdd} disabled={!addingPath.trim() || adding}>
                {adding ? 'Adding…' : 'Add'}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setShowAdd(false); setAddError(null); setAddingPath(''); }}>
                Cancel
              </Btn>
            </div>
            {addError && (
              <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-danger, #dc2626)' }}>
                {addError}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            Loading…
          </div>
        )}

        {loadError && (
          <div style={{ color: 'var(--alm-danger, #dc2626)', fontSize: 'var(--alm-text-xs)' }}>
            Could not load roots: {loadError}
          </div>
        )}

        {!loading && !loadError && roots.length === 0 && (
          <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            No source folders registered yet. Add one above.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}>
          {roots.map((root) => (
            <div
              key={root.id}
              style={{
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius-md)',
                padding: 'var(--alm-sp-3)',
                background: root.online ? undefined : 'var(--alm-surface2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}>
                <code className="alm-mono" style={{ flex: 1, fontSize: 'var(--alm-text-xs)', wordBreak: 'break-all' }}>
                  {root.path}
                </code>
                <div style={{ display: 'flex', gap: 'var(--alm-sp-1)', flexShrink: 0 }}>
                  <Pill variant={CATEGORY_VARIANT[root.category]}>
                    {CATEGORY_LABEL[root.category]}
                  </Pill>
                  <Pill variant={root.online ? 'ok' : 'danger'}>
                    {root.online ? 'Online' : 'Offline'}
                  </Pill>
                </div>
              </div>
              {root.last_scanned && (
                <div style={{ marginTop: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                  Last scan: {root.last_scanned}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
