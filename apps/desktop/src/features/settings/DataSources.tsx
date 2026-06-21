// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { listRoots, registerRoot } from '@/api/commands';
import type { LibraryRoot } from '@/bindings/types';
import { errMessage } from '@/lib/errors';

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
      .catch((err: unknown) => setLoadError(errMessage(err)))
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
      setAddError(errMessage(err));
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
          <div className="alm-data-sources__add-form">
            <DirPicker
              value={addingPath}
              onChange={setAddingPath}
              label="Folder"
              lastPathKind="inbox"
            />
            <div className="alm-data-sources__add-controls">
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
              <div className="alm-data-sources__add-error">
                {addError}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="alm-data-sources__status">
            Loading…
          </div>
        )}

        {loadError && (
          <div className="alm-data-sources__load-error">
            Could not load roots: {loadError}
          </div>
        )}

        {!loading && !loadError && roots.length === 0 && (
          <div className="alm-data-sources__status">
            No source folders registered yet. Add one above.
          </div>
        )}

        <div className="alm-data-sources__roots-list">
          {roots.map((root) => (
            <div
              key={root.id}
              className={`alm-data-sources__root-card${root.online ? '' : ' alm-data-sources__root-card--offline'}`}
            >
              <div className="alm-data-sources__root-header">
                <code className="alm-mono alm-data-sources__root-path">
                  {root.path}
                </code>
                <div className="alm-data-sources__root-pills">
                  <Pill variant={CATEGORY_VARIANT[root.category]}>
                    {CATEGORY_LABEL[root.category]}
                  </Pill>
                  <Pill variant={root.online ? 'ok' : 'danger'}>
                    {root.online ? 'Online' : 'Offline'}
                  </Pill>
                </div>
              </div>
              {root.lastScanned && (
                <div className="alm-data-sources__root-scan">
                  Last scan: {root.lastScanned}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
