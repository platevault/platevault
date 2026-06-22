// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
// Redesigned to match platevault-settings-menu.html data pane (authoritative mock).
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { listRoots, registerRoot, startScan } from '@/api/commands';
import type { LibraryRoot } from '@/bindings/types';
import type { RootCategory } from '@/bindings/index';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';
import { SettingsSection } from './SettingsKit';
import { SourceProtectionOverride } from './SourceProtectionOverride';

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
      title={m.common_sources()}
      action={
        <Btn
          variant="primary"
          size="sm"
          onClick={() => { setShowAdd(true); setAddError(null); }}
        >
          {m.settings_datasources_add_btn()}
        </Btn>
      }
    >
      {showAdd && (
        <div className="alm-data-sources__add-form">
          <DirPicker
            value={addingPath}
            onChange={setAddingPath}
            label={m.settings_datasources_folder_label()}
            lastPathKind="inbox"
          />
          <div className="alm-data-sources__add-controls">
            <select
              className="alm-select"
              value={addingCategory}
              onChange={(e) => setAddingCategory(e.target.value as RootCategory)}
              aria-label={m.settings_datasources_category_aria()}
            >
              <option value="raw">{m.settings_datasources_category_raw()}</option>
              <option value="calibration">{m.settings_datasources_category_calibration()}</option>
              <option value="project">{m.settings_datasources_category_project()}</option>
              <option value="inbox">{m.settings_datasources_category_inbox()}</option>
            </select>
            <Btn size="sm" onClick={handleAdd} disabled={!addingPath.trim() || adding}>
              {adding ? m.common_adding() : m.common_add()}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => { setShowAdd(false); setAddError(null); setAddingPath(''); }}>
              {m.common_cancel()}
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
          {m.common_loading()}
        </div>
      )}

      {loadError && (
        <div className="alm-data-sources__load-error">
          {m.settings_datasources_load_error({ error: loadError })}
        </div>
      )}

      {!loading && !loadError && roots.length === 0 && (
        <div className="alm-data-sources__status">
          {m.settings_datasources_empty()}
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
              {m.nav_roots_offline_suffix()}
            </Pill>
          )}
        </div>
        {meta && (
          <div className="alm-data-sources__root-meta">{meta}</div>
        )}
        <SourceProtectionOverride sourceId={root.id} />
      </div>

      {/* Right: action buttons */}
      <div className="alm-data-sources__root-actions">
        {!isOffline && (
          <Btn size="sm" onClick={() => onRescan(root)}>
            {m.settings_datasources_rescan()}
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
            {m.settings_datasources_disable()}
          </Btn>
        )}
        <Btn
          size="sm"
          onClick={() => {
            // STUB: remap-root dialog flow pending (remapRoot + applyRootRemap exist in commands.ts)
            console.log('STUB: remap backend command pending', root.id);
          }}
        >
          {m.settings_datasources_remap()}
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
            {m.settings_datasources_delete()}
          </Btn>
        )}
      </div>
    </div>
  );
}
