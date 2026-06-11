// Settings → Catalogs page (spec 014, T008/T009/T012-T015).
//
// Replaces the fixture-driven stub (TARGET_CATALOGS) with two real sections:
//
//   1. "Available catalogs" — table of installed catalogs from catalog.list.
//   2. "License attribution" — verbatim attribution text from
//      catalog.attribution.get, with a "Copy NOTICE" action (T014).
//
// In v1, all catalogs have origin = "downloaded". No "Add catalog" affordance
// is shown (A2 — user-added catalogs deferred to v1.x).

import { useState, useEffect, useCallback } from 'react';
import { Table } from '@/ui';
import { catalogList, catalogAttributionGet } from '@/api/commands';
import type { Catalog, LicenseAttribution } from '@/bindings/types';

// ── useCatalogList hook ───────────────────────────────────────────────────────

function useCatalogList() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await catalogList();
      setCatalogs(resp.catalogs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { catalogs, loading, error, reload: load };
}

// ── useCatalogAttributions hook ───────────────────────────────────────────────

function useCatalogAttributions() {
  const [attributions, setAttributions] = useState<LicenseAttribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await catalogAttributionGet();
      setAttributions(resp.attributions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { attributions, loading, error, reload: load };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function originBadge(origin: string): string {
  switch (origin) {
    case 'downloaded': return 'Downloaded';
    case 'built_in': return 'Built-in';
    case 'user': return 'User';
    default: return origin;
  }
}

/** Serialise attributions into a NOTICE buffer suitable for redistribution (T014). */
function buildNoticeBuffer(attributions: LicenseAttribution[]): string {
  if (attributions.length === 0) return 'No catalog attributions available.';

  const sections = attributions.map((a) => {
    const lines: string[] = [
      `=== ${a.catalogId} ===`,
      `License: ${a.license}`,
    ];
    if (a.author) lines.push(`Author: ${a.author}`);
    if (a.title) lines.push(`Title: ${a.title}`);
    if (a.licenseUri) lines.push(`License URI: ${a.licenseUri}`);
    lines.push(`Source: ${a.link}`);
    if (a.accessedOn) lines.push(`Accessed: ${a.accessedOn}`);
    if (a.modificationsNotice) lines.push(`Modifications: ${a.modificationsNotice}`);
    lines.push('');
    lines.push(a.text);
    return lines.join('\n');
  });

  return [
    'NOTICE — Catalog Index Attributions',
    '=====================================',
    '',
    ...sections,
  ].join('\n\n');
}

// ── CatalogsPage ──────────────────────────────────────────────────────────────

interface CatalogsProps {
  /** Retained for compatibility with the Settings page save mechanism. */
  save?: (scope: string, values: Record<string, unknown>) => void;
}

export function Catalogs({ save: _save }: CatalogsProps) {
  const { catalogs, loading: catalogsLoading, error: catalogsError, reload: reloadCatalogs } = useCatalogList();
  const { attributions, loading: attrsLoading, error: attrsError, reload: reloadAttrs } = useCatalogAttributions();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopyNotice = useCallback(async () => {
    const buffer = buildNoticeBuffer(attributions);
    try {
      await navigator.clipboard.writeText(buffer);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [attributions]);

  return (
    <>
      {/* ── Available Catalogs ── */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Available Catalogs</div>

        {catalogsLoading && (
          <div className="alm-settings__loading">Loading catalogs…</div>
        )}

        {catalogsError && (
          <div className="alm-settings__error">
            <span>Failed to load catalogs: {catalogsError}</span>
            <button className="alm-btn alm-btn--sm" onClick={reloadCatalogs} type="button">
              Retry
            </button>
          </div>
        )}

        {!catalogsLoading && !catalogsError && catalogs.length === 0 && (
          <div className="alm-settings__empty">
            No catalogs installed. Complete the first-run setup to download catalogs.
          </div>
        )}

        {!catalogsLoading && !catalogsError && catalogs.length > 0 && (
          <Table
            columns={[
              { key: 'name', label: 'Catalog' },
              { key: 'version', label: 'Version', style: { width: 90 } },
              { key: 'license', label: 'License', style: { width: 110 } },
              { key: 'origin', label: 'Origin', style: { width: 100 } },
              { key: 'entries', label: 'Entries', style: { width: 80 } },
              { key: 'lastUpdated', label: 'Last updated', style: { width: 130 } },
              { key: 'source', label: 'Source' },
            ]}
            rows={catalogs.map((c) => ({
              name: <strong>{c.name}</strong>,
              version: <span style={{ fontFamily: 'monospace', fontSize: 'var(--alm-text-xs)' }}>{c.version}</span>,
              license: (
                <span
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
                  title={c.license}
                >
                  {c.license}
                </span>
              ),
              origin: (
                <span className={`alm-badge alm-badge--${c.origin}`}>
                  {originBadge(c.origin)}
                </span>
              ),
              entries: c.entryCount != null ? c.entryCount.toLocaleString() : '—',
              lastUpdated: (
                <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                  {formatDate(c.lastUpdated)}
                </span>
              ),
              source: (
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 'var(--alm-text-xs)' }}
                >
                  {c.sourceUrl}
                </a>
              ),
            }))}
          />
        )}
      </div>

      {/* ── License Attribution ── */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>License Attribution</span>
          {attributions.length > 0 && (
            <button
              className="alm-btn alm-btn--sm"
              onClick={handleCopyNotice}
              type="button"
              title="Copy full NOTICE buffer to clipboard"
            >
              {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy NOTICE'}
            </button>
          )}
        </div>

        {attrsLoading && (
          <div className="alm-settings__loading">Loading attribution data…</div>
        )}

        {attrsError && (
          <div className="alm-settings__error">
            <span>Failed to load attributions: {attrsError}</span>
            <button className="alm-btn alm-btn--sm" onClick={reloadAttrs} type="button">
              Retry
            </button>
          </div>
        )}

        {!attrsLoading && !attrsError && attributions.length === 0 && (
          <div className="alm-settings__empty">
            No attribution data available. Install catalogs via first-run setup.
          </div>
        )}

        {!attrsLoading && !attrsError && attributions.length > 0 && (
          <div className="alm-catalogs-attribution">
            {attributions.map((attr, i) => (
              <div key={`${attr.catalogId}-${i}`} className="alm-catalogs-attribution__item">
                <div className="alm-catalogs-attribution__header">
                  <strong>{attr.catalogId}</strong>
                  <span
                    style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginLeft: 8 }}
                  >
                    {attr.license}
                  </span>
                </div>

                {/* CC-BY structured fields (R-2.2) */}
                {attr.author && (
                  <div className="alm-catalogs-attribution__meta">
                    <span className="alm-catalogs-attribution__label">Author:</span>{' '}
                    {attr.author}
                  </div>
                )}
                {attr.title && (
                  <div className="alm-catalogs-attribution__meta">
                    <span className="alm-catalogs-attribution__label">Title:</span>{' '}
                    {attr.title}
                  </div>
                )}
                {attr.licenseUri && (
                  <div className="alm-catalogs-attribution__meta">
                    <span className="alm-catalogs-attribution__label">License URI:</span>{' '}
                    <a href={attr.licenseUri} target="_blank" rel="noopener noreferrer">
                      {attr.licenseUri}
                    </a>
                  </div>
                )}
                {attr.modificationsNotice && (
                  <div className="alm-catalogs-attribution__meta">
                    <span className="alm-catalogs-attribution__label">Modifications:</span>{' '}
                    {attr.modificationsNotice}
                  </div>
                )}

                {/* Verbatim notice text */}
                <pre className="alm-catalogs-attribution__text">{attr.text}</pre>

                {/* Source link */}
                <div className="alm-catalogs-attribution__source">
                  <a href={attr.link} target="_blank" rel="noopener noreferrer">
                    {attr.link}
                  </a>
                  {attr.accessedOn && (
                    <span style={{ marginLeft: 8, color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
                      (accessed {attr.accessedOn})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
