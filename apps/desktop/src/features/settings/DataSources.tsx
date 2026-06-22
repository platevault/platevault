// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
// Redesigned to match platevault-settings-menu.html data pane (authoritative mock).
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { listRoots, registerRoot, startScan } from '@/api/commands';
import type { LibraryRoot } from '@/bindings/types';
import type { RootCategory } from '@/bindings/index';
import { errMessage } from '@/lib/errors';
import { SettingsSection } from './SettingsKit';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

/** Display order and labels for category groups (matches mock: Raw / Calibration / Project / Inbox). */
const CATEGORY_ORDER: RootCategory[] = ['raw', 'calibration', 'project', 'inbox'];

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

  const handleRescan = async (root: LibraryRoot) => {
    try {
      await startScan({ root_ids: [root.id] });
      // Reload after a short delay to pick up updated lastScanned
      setTimeout(loadRoots, 800);
    } catch (err: unknown) {
      console.error('Rescan failed:', errMessage(err));
    }
  };

  // Group roots by category, preserving display order
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    roots: roots.filter((r) => r.category === cat),
  })).filter((g) => g.roots.length > 0);

  return (
    <SettingsSection
      title="Sources"
      action={
        <Btn
          variant="primary"
          size="sm"
          onClick={() => { setShowAdd(true); setAddError(null); }}
        >
          + Add source folder
        </Btn>
      }
    >
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

      {grouped.map(({ category, roots: groupRoots }) => (
        <div key={category} className="alm-data-sources__group">
          <h4 className="alm-data-sources__group-label">
            {CATEGORY_LABEL[category]}
          </h4>
          {groupRoots.map((root) => (
            <RootCard
              key={root.id}
              root={root}
              onRescan={handleRescan}
            />
          ))}
        </div>
      ))}
    </SettingsSection>
  );
}

// ── Per-root card ─────────────────────────────────────────────────────────────

interface RootCardProps {
  root: LibraryRoot;
  onRescan: (root: LibraryRoot) => void;
}

function RootCard({ root, onRescan }: RootCardProps) {
  const isOffline = !root.online;

  const metaParts: string[] = [];
  if (root.fileCount != null && root.fileCount > 0) {
    metaParts.push(`${root.fileCount.toLocaleString()} files`);
  }
  if (root.lastScanned) {
    metaParts.push(`scanned ${root.lastScanned}`);
  }
  const meta = metaParts.join(' · ');

  return (
    <div
      className={
        'alm-data-sources__root-card' +
        (isOffline ? ' alm-data-sources__root-card--offline' : '')
      }
    >
      {/* Left: path + offline pill + meta */}
      <div className="alm-data-sources__root-info">
        <div className="alm-data-sources__root-path-row">
          <code className="alm-mono alm-data-sources__root-path">
            {root.path}
          </code>
          {isOffline && (
            <Pill variant="warn" className="alm-data-sources__offline-pill">
              offline
            </Pill>
          )}
        </div>
        {meta && (
          <div className="alm-data-sources__root-meta">{meta}</div>
        )}
      </div>

      {/* Right: action buttons */}
      <div className="alm-data-sources__root-actions">
        {!isOffline && (
          <Btn size="sm" onClick={() => onRescan(root)}>
            Rescan
          </Btn>
        )}
        {!isOffline && (
          <Btn
            size="sm"
            onClick={() => {
              // STUB: disable backend command pending
              console.log('STUB: disable backend command pending', root.id);
            }}
          >
            Disable
          </Btn>
        )}
        <Btn
          size="sm"
          onClick={() => {
            // STUB: remap-root dialog flow pending (remapRoot + applyRootRemap exist in commands.ts)
            console.log('STUB: remap backend command pending', root.id);
          }}
        >
          Remap…
        </Btn>
        {isOffline && (
          <Btn
            size="sm"
            variant="danger"
            onClick={() => {
              // STUB: delete-root backend command pending
              console.log('STUB: delete-root backend command pending', root.id);
            }}
          >
            Delete
          </Btn>
        )}
      </div>
    </div>
  );
}
