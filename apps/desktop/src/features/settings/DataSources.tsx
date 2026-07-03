// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
// Redesigned to match platevault-settings-menu.html data pane (authoritative mock).
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { listRoots, registerRoot, startScan, settingsSourceOverrideSet, settingsOverridableKeys } from '@/api/commands';
import type { LibraryRoot } from '@/bindings/types';
import type { RootCategory } from '@/bindings/index';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';
import { SourceProtectionOverride } from './SourceProtectionOverride';

const SOURCES_KEYS = ['followSymlinks', 'hashOnScan', 'alwaysPreviewBeforePlan'];

// Fallback list used before the backend responds or if the call fails.
const OVERRIDABLE_KEYS_FALLBACK = ['hashOnScan', 'followSymlinks'] as const;
type OverridableKey = string;

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

/** Display order and labels for category groups (matches mock: Raw / Calibration / Project / Inbox). */
const CATEGORY_ORDER: RootCategory[] = ['raw', 'calibration', 'project', 'inbox'];

/** Render-time factory (spec 046 #8b) so category labels re-read the active locale. */
function categoryLabel(category: RootCategory): string {
  switch (category) {
    case 'raw': return m.settings_datasources_category_raw();
    case 'calibration': return m.settings_datasources_category_calibration();
    case 'project': return m.settings_datasources_category_project();
    case 'inbox': return m.settings_datasources_category_inbox();
  }
}

export function DataSources({ save: _save }: DataSourcesProps) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addingPath, setAddingPath] = useState('');
  const [addingCategory, setAddingCategory] = useState<RootCategory>('raw');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ── Overridable keys — fetched from backend (T025) ──────────────────────────
  const [overridableKeys, setOverridableKeys] = useState<string[]>([...OVERRIDABLE_KEYS_FALLBACK]);

  useEffect(() => {
    settingsOverridableKeys().then(setOverridableKeys).catch(() => {
      // Keep fallback list on failure.
    });
  }, []);

  // ── Per-source override (T025) ────────────────────────────────────────────
  const [overrideSourceId, setOverrideSourceId] = useState('');
  const [overrideKey, setOverrideKey] = useState<OverridableKey>('hashOnScan');
  const [overrideValue, setOverrideValue] = useState('true');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideApplying, setOverrideApplying] = useState(false);

  const handleOverrideApply = async () => {
    if (!overrideSourceId) return;
    setOverrideApplying(true);
    setOverrideError(null);
    try {
      // Value arrives as string from the text input; cast to boolean when the
      // key is a known boolean flag, otherwise pass as string.
      const coerced: unknown =
        overrideValue === 'true' ? true : overrideValue === 'false' ? false : overrideValue;
      await settingsSourceOverrideSet({
        sourceId: overrideSourceId,
        key: overrideKey,
        value: coerced,
      });
    } catch (err: unknown) {
      setOverrideError(errMessage(err));
    } finally {
      setOverrideApplying(false);
    }
  };

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
    <>
    <SettingsSection
      title={m.common_sources()}
      action={
        <div className="alm-datasources__action-row">
          <RestoreDefaultsBtn
            scope="sources"
            keys={SOURCES_KEYS}
            onRestored={() => { /* sources pane has no controlled inputs to re-hydrate */ }}
          />
          <Btn
            variant="primary"
            size="sm"
            onClick={() => { setShowAdd(true); setAddError(null); }}
          >
            {m.settings_datasources_add_btn()}
          </Btn>
        </div>
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
            {categoryLabel(category)}
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

    {/* Per-source setting override (spec 018 T025) */}
    {roots.length > 0 && (
      <div className="alm-settings__group" data-testid="source-override-panel">
        <div className="alm-settings__group-title">
          {m.settings_datasources_source_override_title()}
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_datasources_source_override_source_aria()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={overrideSourceId}
              onChange={(e) => setOverrideSourceId(e.target.value)}
              aria-label={m.settings_datasources_source_override_source_aria()}
            >
              <option value="">{m.settings_datasources_select_source()}</option>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>{r.path}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_datasources_source_override_key_aria()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={overrideKey}
              onChange={(e) => setOverrideKey(e.target.value)}
              aria-label={m.settings_datasources_source_override_key_aria()}
            >
              {overridableKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_datasources_source_override_value_aria()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              aria-label={m.settings_datasources_source_override_value_aria()}
            >
              <option value="true">{m.common_true()}</option>
              <option value="false">{m.common_false()}</option>
            </select>
          </div>
        </div>
        {overrideError && (
          <div className="alm-data-sources__add-error">
            {m.settings_datasources_source_override_error({ error: overrideError })}
          </div>
        )}
        <div className="alm-settings__row">
          <div className="alm-settings__row-label" />
          <div className="alm-settings__row-content">
            <Btn
              size="sm"
              onClick={() => void handleOverrideApply()}
              disabled={!overrideSourceId || overrideApplying}
            >
              {m.settings_datasources_source_override_apply()}
            </Btn>
          </div>
        </div>
      </div>
    )}
    </>
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
    metaParts.push(
      m.data_sources_file_count({ count: root.fileCount, formatted: root.fileCount.toLocaleString() }),
    );
  }
  if (root.lastScanned) {
    metaParts.push(m.settings_datasources_scanned({ date: root.lastScanned }));
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
            {m.common_rescan()}
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
