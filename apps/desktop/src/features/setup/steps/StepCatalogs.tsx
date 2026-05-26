import { useState, useCallback } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';

export interface CatalogSettings {
  openngc: boolean;
  messier: boolean;
  sharpless: boolean;
  barnard: boolean;
  lbn: boolean;
  ldn: boolean;
  simbadOnline: boolean;
}

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  openngc: true,
  messier: true,
  sharpless: true,
  barnard: true,
  lbn: true,
  ldn: true,
  simbadOnline: true,
};

export interface StepCatalogsProps {
  settings: CatalogSettings;
  onSettingsChange: (settings: CatalogSettings) => void;
  /** Called when user clicks "Skip for now" — advances to next step. */
  onSkip?: () => void;
}

type DownloadState = 'idle' | 'downloading' | 'ready';

interface CatalogEntry {
  key: keyof Omit<CatalogSettings, 'simbadOnline'>;
  name: string;
  description: string;
  entries: string;
  size: string;
  license?: string;
  bundled?: boolean;
}

const CATALOGS: CatalogEntry[] = [
  {
    key: 'openngc',
    name: 'OpenNGC',
    description: 'NGC/IC objects — comprehensive deep-sky catalog',
    entries: '~14,000 entries',
    size: '~2 MB download',
    license: 'CC-BY-SA-4.0',
  },
  {
    key: 'messier',
    name: 'Messier',
    description: '110 classic deep-sky objects',
    entries: '110 entries',
    size: 'Bundled',
    bundled: true,
  },
  {
    key: 'sharpless',
    name: 'Sharpless (Sh2)',
    description: '313 HII emission nebulae',
    entries: '313 entries',
    size: '~50 KB download',
  },
  {
    key: 'barnard',
    name: 'Barnard',
    description: '349 dark nebulae',
    entries: '349 entries',
    size: '~30 KB download',
  },
  {
    key: 'lbn',
    name: 'LBN',
    description: 'Lynds Bright Nebulae — 1,125 bright nebulae',
    entries: '1,125 entries',
    size: '~100 KB download',
  },
  {
    key: 'ldn',
    name: 'LDN',
    description: 'Lynds Dark Nebulae — 1,802 dark nebulae',
    entries: '1,802 entries',
    size: '~120 KB download',
  },
];

/**
 * Step — Download catalogs (stub mode).
 * Shows catalog cards with simulated download buttons.
 * Real catalog download will be available in a future update.
 */
export function StepCatalogs({ settings, onSettingsChange, onSkip }: StepCatalogsProps) {
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>(() => {
    const initial: Record<string, DownloadState> = {};
    for (const c of CATALOGS) {
      initial[c.key] = c.bundled ? 'ready' : 'idle';
    }
    return initial;
  });

  const handleDownload = useCallback((key: string) => {
    setDownloadStates((prev) => ({ ...prev, [key]: 'downloading' }));
    // Simulate download — brief animation then "Ready"
    setTimeout(() => {
      setDownloadStates((prev) => ({ ...prev, [key]: 'ready' }));
      // Enable the catalog in settings when "downloaded"
      onSettingsChange({ ...settings, [key]: true });
    }, 800 + Math.random() * 400);
  }, [settings, onSettingsChange]);

  const readyCount = Object.values(downloadStates).filter((s) => s === 'ready').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      <p
        style={{
          fontSize: 'var(--alm-text-sm)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.6,
          maxWidth: 540,
        }}
      >
        Target catalogs are used to resolve OBJECT headers in your FITS/XISF files
        to known astronomical objects.
      </p>

      {/* Catalog cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
        {CATALOGS.map((catalog) => {
          const dlState = downloadStates[catalog.key] ?? 'idle';
          return (
            <div
              key={catalog.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--alm-space-4)',
                padding: 'var(--alm-space-3) var(--alm-space-4)',
                background: 'var(--alm-surface)',
                borderRadius: 'var(--alm-radius-sm)',
                border: '1px solid var(--alm-border)',
              }}
            >
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--alm-space-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
                    {catalog.name}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--alm-text-xs)',
                      color: 'var(--alm-text-muted)',
                    }}
                  >
                    {catalog.description}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--alm-space-3)',
                    marginTop: 'var(--alm-space-1)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--alm-text-xs)',
                      color: 'var(--alm-text-muted)',
                    }}
                  >
                    {catalog.entries}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--alm-text-xs)',
                      color: 'var(--alm-text-muted)',
                    }}
                  >
                    {catalog.size}
                  </span>
                  {catalog.license && (
                    <Pill label={catalog.license} variant="info" size="sm" />
                  )}
                </div>
              </div>

              {/* Download button / status */}
              <div style={{ flexShrink: 0 }}>
                {dlState === 'ready' ? (
                  <Pill label={catalog.bundled ? 'BUNDLED' : 'READY'} variant="ok" size="sm" />
                ) : dlState === 'downloading' ? (
                  <span
                    style={{
                      fontSize: 'var(--alm-text-xs)',
                      color: 'var(--alm-text-muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    Downloading...
                  </span>
                ) : (
                  <Btn
                    size="sm"
                    onClick={() => handleDownload(catalog.key)}
                  >
                    Download
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
        }}
      >
        {readyCount} of {CATALOGS.length} catalogs ready
      </div>

      {/* Note + skip */}
      <div
        style={{
          padding: 'var(--alm-space-3) var(--alm-space-4)',
          background: 'var(--alm-bg)',
          borderRadius: 'var(--alm-radius-sm)',
          border: '1px solid var(--alm-border)',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.6,
        }}
      >
        Real catalog download will be available in a future update.
        Catalogs can be installed later from Settings &rarr; Catalogs.
      </div>

      {onSkip && (
        <div>
          <Btn variant="ghost" size="sm" onClick={onSkip}>
            Skip for now &rarr;
          </Btn>
        </div>
      )}
    </div>
  );
}
