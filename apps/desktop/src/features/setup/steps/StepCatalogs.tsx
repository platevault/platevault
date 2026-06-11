// First-run wizard: Download Catalogs step (spec 014, T010-dl).
//
// 1. On mount (or when the user clicks "Download All"), calls
//    catalog.manifest.fetch to get the manifest.
// 2. Iterates the manifest catalog list and calls catalog.download for each
//    (sequential in v1; parallel-N can be added in v1.x).
// 3. Shows per-row download status with individual Retry buttons on failure.
// 4. The step does NOT block Finish if skipped — the wizard can proceed.

import { useState, useCallback, useEffect } from 'react';
import { Btn } from '@/ui/Btn';
import { catalogManifestFetch, catalogDownload } from '@/api/commands';
import type { CatalogManifest, CatalogDownloadStatus } from '@/bindings/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogSettings {
  /** Kept for API compatibility; all v1 catalogs are downloaded, not toggled. */
  downloadAll: boolean;
}

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  downloadAll: true,
};

export interface StepCatalogsProps {
  settings: CatalogSettings;
  onSettingsChange: (settings: CatalogSettings) => void;
}

type RowStatus = 'pending' | 'downloading' | 'success' | 'failed' | 'skipped';

interface CatalogRowState {
  catalogId: string;
  status: RowStatus;
  error?: string;
}

// ── StepCatalogs ──────────────────────────────────────────────────────────────

/**
 * Step 3 — Download Catalogs.
 *
 * Fetches the manifest and downloads all thirteen v1 catalogs. Shows per-row
 * progress and individual Retry buttons on failure. The step does not block
 * Finish if skipped.
 */
export function StepCatalogs({ settings: _settings, onSettingsChange: _onChange }: StepCatalogsProps) {
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [manifestEtag, setManifestEtag] = useState<string | undefined>(undefined);
  const [manifestStatus, setManifestStatus] = useState<
    'idle' | 'fetching' | 'ready' | 'failed' | 'not_modified'
  >('idle');
  const [manifestError, setManifestError] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<CatalogRowState[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Initialise rows from manifest when manifest becomes available.
  useEffect(() => {
    if (manifest) {
      setRows(
        manifest.catalogs.map((e) => ({
          catalogId: e.catalogId,
          status: 'pending',
        })),
      );
    }
  }, [manifest]);

  const fetchManifest = useCallback(async () => {
    setManifestStatus('fetching');
    setManifestError(undefined);
    try {
      const resp = await catalogManifestFetch({ etag: manifestEtag });
      if (resp.status === 'fetched' && resp.manifest) {
        setManifest(resp.manifest);
        setManifestEtag(resp.etag);
        setManifestStatus('ready');
      } else if (resp.status === 'not_modified') {
        setManifestStatus('not_modified');
      } else {
        setManifestStatus('failed');
        setManifestError(resp.error?.message ?? 'Unknown error fetching manifest');
      }
    } catch (e) {
      setManifestStatus('failed');
      setManifestError(e instanceof Error ? e.message : String(e));
    }
  }, [manifestEtag]);

  const downloadSingle = useCallback(
    async (catalogId: string, currentManifest: CatalogManifest): Promise<CatalogDownloadStatus> => {
      setRows((prev) =>
        prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'downloading', error: undefined } : r)),
      );
      try {
        const resp = await catalogDownload({ catalogId, manifest: currentManifest });
        if (resp.status === 'success') {
          setRows((prev) =>
            prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'success' } : r)),
          );
        } else {
          setRows((prev) =>
            prev.map((r) =>
              r.catalogId === catalogId
                ? { ...r, status: 'failed', error: resp.error?.message ?? 'Download failed' }
                : r,
            ),
          );
        }
        return resp.status;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((r) => (r.catalogId === catalogId ? { ...r, status: 'failed', error: msg } : r)),
        );
        return 'failure';
      }
    },
    [],
  );

  const handleDownloadAll = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);

    // Step 1: fetch manifest if not yet available.
    let currentManifest = manifest;
    if (!currentManifest) {
      setManifestStatus('fetching');
      setManifestError(undefined);
      try {
        const resp = await catalogManifestFetch({ etag: manifestEtag });
        if (resp.status === 'fetched' && resp.manifest) {
          currentManifest = resp.manifest;
          setManifest(resp.manifest);
          setManifestEtag(resp.etag);
          setManifestStatus('ready');
        } else if (resp.status === 'not_modified' && manifest) {
          currentManifest = manifest;
          setManifestStatus('not_modified');
        } else {
          setManifestStatus('failed');
          setManifestError(resp.error?.message ?? 'Failed to fetch manifest');
          setIsRunning(false);
          return;
        }
      } catch (e) {
        setManifestStatus('failed');
        setManifestError(e instanceof Error ? e.message : String(e));
        setIsRunning(false);
        return;
      }
    }

    if (!currentManifest) {
      setIsRunning(false);
      return;
    }

    // Reset only pending rows (don't re-download already succeeded ones).
    setRows((prev) =>
      prev.length === 0
        ? currentManifest!.catalogs.map((e) => ({ catalogId: e.catalogId, status: 'pending' as RowStatus }))
        : prev.map((r) => (r.status !== 'success' ? { ...r, status: 'pending', error: undefined } : r)),
    );

    // Step 2: download each catalog sequentially.
    for (const entry of currentManifest.catalogs) {
      const rowStatus = rows.find((r) => r.catalogId === entry.catalogId)?.status;
      if (rowStatus === 'success') continue; // skip already downloaded
      await downloadSingle(entry.catalogId, currentManifest);
    }

    setIsRunning(false);
  }, [isRunning, manifest, manifestEtag, rows, downloadSingle]);

  const handleRetry = useCallback(
    async (catalogId: string) => {
      if (!manifest || isRunning) return;
      await downloadSingle(catalogId, manifest);
    },
    [manifest, isRunning, downloadSingle],
  );

  const successCount = rows.filter((r) => r.status === 'success').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const totalCount = rows.length;

  const allDone = totalCount > 0 && rows.every((r) => r.status === 'success' || r.status === 'failed');

  return (
    <div className="alm-step-catalogs">
      <p className="alm-step-catalogs__intro">
        Target catalogs are used to resolve OBJECT headers in your FITS/XISF files
        to known astronomical objects. Click &ldquo;Download All&rdquo; to install
        all thirteen v1 catalogs. You can skip this step and install them later from
        Settings → Catalogs.
      </p>

      {/* Manifest status */}
      {manifestStatus === 'fetching' && (
        <div className="alm-step-catalogs__status">Fetching catalog manifest…</div>
      )}
      {manifestStatus === 'failed' && (
        <div className="alm-step-catalogs__error">
          Manifest fetch failed: {manifestError}
          <button
            className="alm-btn alm-btn--sm"
            onClick={fetchManifest}
            type="button"
            style={{ marginLeft: 8 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Per-row status list (shown once manifest is ready) */}
      {rows.length > 0 && (
        <div className="alm-step-catalogs__list">
          {rows.map((row) => (
            <div key={row.catalogId} className="alm-step-catalogs__row">
              <div className="alm-step-catalogs__row-info">
                <span className="alm-step-catalogs__row-name">{row.catalogId}</span>
              </div>
              <div className="alm-step-catalogs__row-status">
                {row.status === 'pending' && (
                  <span className="alm-step-catalogs__badge alm-step-catalogs__badge--pending">
                    Pending
                  </span>
                )}
                {row.status === 'downloading' && (
                  <span className="alm-step-catalogs__badge alm-step-catalogs__badge--downloading">
                    Downloading…
                  </span>
                )}
                {row.status === 'success' && (
                  <span className="alm-step-catalogs__badge alm-step-catalogs__badge--success">
                    ✓ Installed
                  </span>
                )}
                {row.status === 'failed' && (
                  <>
                    <span
                      className="alm-step-catalogs__badge alm-step-catalogs__badge--failed"
                      title={row.error}
                    >
                      ✗ Failed
                    </span>
                    <button
                      className="alm-btn alm-btn--sm"
                      onClick={() => handleRetry(row.catalogId)}
                      disabled={isRunning}
                      type="button"
                      style={{ marginLeft: 6 }}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="alm-step-catalogs__footer">
        <Btn
          size="sm"
          onClick={handleDownloadAll}
          disabled={isRunning}
        >
          {isRunning ? 'Downloading…' : rows.length === 0 ? 'Download All' : 'Retry All'}
        </Btn>

        {totalCount > 0 && (
          <span className="alm-step-catalogs__count">
            {successCount} / {totalCount} installed
            {failedCount > 0 && ` · ${failedCount} failed`}
          </span>
        )}
      </div>

      {allDone && failedCount === 0 && (
        <div className="alm-step-catalogs__note alm-step-catalogs__note--success">
          All catalogs installed successfully.
        </div>
      )}

      {(manifestStatus === 'idle' || manifestStatus === 'not_modified') && rows.length === 0 && (
        <div className="alm-step-catalogs__note">
          Catalogs can also be installed later from Settings → Catalogs.
        </div>
      )}
    </div>
  );
}
