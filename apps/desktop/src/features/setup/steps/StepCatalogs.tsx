// First-run wizard: Download Catalogs step (spec 014, T010-dl).
//
// 1. On mount, fetches the catalog manifest (`catalogManifestFetch`).
// 2. If the manifest is available, renders a SELECTABLE list (one row per
//    `ManifestCatalogEntry`) with per-row toggles; sensible defaults are
//    pre-selected (all entries — preserves the prior "download all" intent
//    while letting users opt out of individual catalogs).
// 3. If the manifest source is unavailable (404 / network / verification
//    failure), shows a graceful skip-or-retry message instead of a raw error.
// 4. "Download selected" downloads only the checked catalogs, with per-row
//    status (pending/downloading/success/failed) and individual Retry buttons.
// 5. The step does NOT block Finish if skipped — the wizard can proceed.

import { useState, useCallback, useEffect } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { Toggle } from '@/ui/Toggle';
import { catalogManifestFetch, catalogDownload } from '@/api/commands';
import type { CatalogManifest, ManifestCatalogEntry } from '@/bindings/index';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogSettings {
  /** Catalog ids the user has selected to download. */
  selectedCatalogIds: string[];
}

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  selectedCatalogIds: [],
};

export interface StepCatalogsProps {
  settings: CatalogSettings;
  onSettingsChange: (settings: CatalogSettings) => void;
}

type RowStatus = 'pending' | 'downloading' | 'success' | 'failed';

interface CatalogRowState {
  catalogId: string;
  status: RowStatus;
  error?: string;
}

type ManifestState = 'idle' | 'fetching' | 'ready' | 'unavailable';

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Format an uncompressed byte size for display. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ── StepCatalogs ──────────────────────────────────────────────────────────────

/**
 * Step 3 — Download Catalogs.
 *
 * Fetches the manifest on mount; lets the user pick which catalogs to install
 * and downloads only the selected ones. Gracefully handles an unavailable
 * manifest source. The step does not block Finish if skipped.
 */
export function StepCatalogs({ settings, onSettingsChange }: StepCatalogsProps) {
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [manifestEtag, setManifestEtag] = useState<string | undefined>(undefined);
  const [manifestState, setManifestState] = useState<ManifestState>('idle');
  const [rows, setRows] = useState<CatalogRowState[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const selectedIds = settings.selectedCatalogIds;

  const setSelectedIds = useCallback(
    (ids: string[]) => onSettingsChange({ ...settings, selectedCatalogIds: ids }),
    [onSettingsChange, settings],
  );

  const applyManifest = useCallback(
    (next: CatalogManifest, etag?: string | null) => {
      setManifest(next);
      setManifestEtag(etag ?? undefined);
      setManifestState('ready');
      setRows(next.catalogs.map((e) => ({ catalogId: e.catalogId, status: 'pending' as RowStatus })));
      // Pre-select all catalogs by default (only when the user has no prior
      // selection persisted), preserving the previous "download all" intent.
      if (settings.selectedCatalogIds.length === 0) {
        onSettingsChange({ ...settings, selectedCatalogIds: next.catalogs.map((e) => e.catalogId) });
      }
    },
    [onSettingsChange, settings],
  );

  const fetchManifest = useCallback(async () => {
    setManifestState('fetching');
    try {
      const resp = await catalogManifestFetch({ etag: manifestEtag });
      if (resp.status === 'fetched' && resp.manifest) {
        applyManifest(resp.manifest, resp.etag);
      } else if (resp.status === 'not_modified' && manifest) {
        setManifestState('ready');
      } else {
        // 'failed', or 'fetched' without a body — treat as unavailable. The raw
        // error/404 is intentionally not surfaced to the user.
        setManifestState('unavailable');
      }
    } catch {
      // Network/verification error — surface a graceful unavailable state only.
      setManifestState('unavailable');
    }
  }, [manifestEtag, manifest, applyManifest]);

  // Fetch on mount.
  useEffect(() => {
    void fetchManifest();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelected = useCallback(
    (catalogId: string, checked: boolean) => {
      const set = new Set(selectedIds);
      if (checked) set.add(catalogId);
      else set.delete(catalogId);
      setSelectedIds([...set]);
    },
    [selectedIds, setSelectedIds],
  );

  const downloadSingle = useCallback(
    async (catalogId: string, currentManifest: CatalogManifest): Promise<RowStatus> => {
      setRows((prev) =>
        prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'downloading', error: undefined } : r)),
      );
      try {
        const resp = await catalogDownload({ catalogId, manifest: currentManifest });
        if (resp.status === 'success') {
          setRows((prev) =>
            prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'success' } : r)),
          );
          return 'success';
        }
        setRows((prev) =>
          prev.map((r) =>
            r.catalogId === catalogId
              ? { ...r, status: 'failed', error: resp.error?.message ?? 'Download failed' }
              : r,
          ),
        );
        return 'failed';
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'failed', error: msg } : r)),
        );
        return 'failed';
      }
    },
    [],
  );

  const handleDownloadSelected = useCallback(async () => {
    if (isRunning || !manifest || selectedIds.length === 0) return;
    setIsRunning(true);

    // Reset selected, not-yet-succeeded rows to pending.
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.includes(r.catalogId) && r.status !== 'success'
          ? { ...r, status: 'pending', error: undefined }
          : r,
      ),
    );

    for (const entry of manifest.catalogs) {
      if (!selectedIds.includes(entry.catalogId)) continue;
      const current = rows.find((r) => r.catalogId === entry.catalogId)?.status;
      if (current === 'success') continue;
      await downloadSingle(entry.catalogId, manifest);
    }

    setIsRunning(false);
  }, [isRunning, manifest, selectedIds, rows, downloadSingle]);

  const handleRetry = useCallback(
    async (catalogId: string) => {
      if (!manifest || isRunning) return;
      await downloadSingle(catalogId, manifest);
    },
    [manifest, isRunning, downloadSingle],
  );

  const rowById = new Map(rows.map((r) => [r.catalogId, r]));
  const selectedCount = selectedIds.length;
  const installedCount = rows.filter((r) => r.status === 'success' && selectedIds.includes(r.catalogId)).length;
  const failedCount = rows.filter((r) => r.status === 'failed' && selectedIds.includes(r.catalogId)).length;

  return (
    <div
      className="alm-step-catalogs"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}
    >
      <p
        className="alm-step-catalogs__intro"
        style={{
          margin: 0,
          fontSize: 'var(--alm-text-sm)',
          lineHeight: 'var(--alm-leading-normal)',
          color: 'var(--alm-text-secondary)',
        }}
      >
        Target catalogs resolve OBJECT headers in your FITS/XISF files to known astronomical
        objects. Choose which catalogs to install now — you can skip this step and add more
        later from Settings → Catalogs.
      </p>

      {manifestState === 'fetching' && (
        <div
          data-testid="catalogs-fetching"
          style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}
        >
          Fetching catalog manifest…
        </div>
      )}

      {manifestState === 'unavailable' && (
        <UnavailableState onRetry={() => void fetchManifest()} />
      )}

      {manifestState === 'ready' && rows.length > 0 && (
        <div
          className="alm-step-catalogs__list"
          data-testid="catalogs-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--alm-border)',
            borderRadius: 'var(--alm-radius-sm)',
            background: 'var(--alm-bg)',
            overflow: 'hidden',
          }}
        >
          {manifest?.catalogs.map((entry, i) => (
            <CatalogRow
              key={entry.catalogId}
              entry={entry}
              selected={selectedIds.includes(entry.catalogId)}
              status={rowById.get(entry.catalogId)?.status ?? 'pending'}
              error={rowById.get(entry.catalogId)?.error}
              isLast={i === manifest.catalogs.length - 1}
              disabled={isRunning}
              onToggle={(checked) => toggleSelected(entry.catalogId, checked)}
              onRetry={() => handleRetry(entry.catalogId)}
            />
          ))}
        </div>
      )}

      {manifestState === 'ready' && (
        <div
          className="alm-step-catalogs__footer"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-3)' }}
        >
          <Btn
            size="sm"
            variant="primary"
            onClick={handleDownloadSelected}
            disabled={isRunning || selectedCount === 0}
          >
            {isRunning ? 'Downloading…' : `Download selected (${selectedCount})`}
          </Btn>
          {rows.some((r) => r.status === 'success' || r.status === 'failed') && (
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {installedCount} / {selectedCount} installed
              {failedCount > 0 && ` · ${failedCount} failed`}
            </span>
          )}
        </div>
      )}

      <p
        className="alm-step-catalogs__note"
        style={{ margin: 0, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-faint)' }}
      >
        You can skip this step. Catalogs can be installed later from Settings → Catalogs.
      </p>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

/** Graceful "source unavailable" state with a Retry button (no raw error). */
function UnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="alm-step-catalogs__unavailable"
      data-testid="catalogs-unavailable"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--alm-sp-3)',
        padding: 'var(--alm-sp-3)',
        border: '1px solid var(--alm-warn-border)',
        borderRadius: 'var(--alm-radius-sm)',
        background: 'var(--alm-warn-bg)',
      }}
    >
      <span style={{ flex: 1, fontSize: 'var(--alm-text-sm)', color: 'var(--alm-warn)' }}>
        Catalog source isn&rsquo;t available yet — you can skip this step and add catalogs
        later in Settings.
      </span>
      <Btn size="sm" onClick={onRetry}>
        Retry
      </Btn>
    </div>
  );
}

/** A single selectable catalog row: toggle + id/license/size + status + Retry. */
function CatalogRow({
  entry,
  selected,
  status,
  error,
  isLast,
  disabled,
  onToggle,
  onRetry,
}: {
  entry: ManifestCatalogEntry;
  selected: boolean;
  status: RowStatus;
  error?: string;
  isLast: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
  onRetry: () => void;
}) {
  const size = formatSize(entry.sizeBytes);
  return (
    <div
      className="alm-step-catalogs__row"
      data-testid={`catalog-row-${entry.catalogId}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--alm-sp-3)',
        padding: 'var(--alm-sp-1) var(--alm-sp-3)',
        minHeight: 'var(--alm-row-height)',
        borderBottom: isLast ? 'none' : '1px solid var(--alm-border-subtle)',
        background: 'var(--alm-surface-raised)',
      }}
    >
      <Toggle
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${entry.catalogId}`}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--alm-sp-2)' }}>
        <span
          style={{
            fontSize: 'var(--alm-text-sm)',
            fontWeight: 'var(--alm-weight-medium)',
            color: 'var(--alm-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.catalogId}
        </span>
        {entry.license && (
          <span style={{ fontSize: 'var(--alm-text-2xs)', color: 'var(--alm-text-faint)' }}>
            {entry.license}
          </span>
        )}
        {size && (
          <span style={{ fontSize: 'var(--alm-text-2xs)', color: 'var(--alm-text-faint)' }}>
            {size}
          </span>
        )}
      </div>

      <CatalogStatusBadge status={status} error={error} />
      {status === 'failed' && (
        <Btn size="sm" onClick={onRetry} disabled={disabled}>
          Retry
        </Btn>
      )}
    </div>
  );
}

/** Per-row download status as a design-v4 pill. */
function CatalogStatusBadge({ status, error }: { status: RowStatus; error?: string }) {
  switch (status) {
    case 'downloading':
      return <Pill variant="info">Downloading…</Pill>;
    case 'success':
      return <Pill variant="ok">Installed ✓</Pill>;
    case 'failed':
      return (
        <Pill variant="danger" title={error}>
          Failed
        </Pill>
      );
    case 'pending':
    default:
      return null;
  }
}
