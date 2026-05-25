import { Switch } from '@base-ui-components/react/switch';
import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import { Box } from '@/ui/Box';
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
}

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
    description: 'NGC/IC objects',
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
 * Step 3 — Target catalogs.
 * A checklist of astronomical catalogs used for OBJECT header resolution,
 * plus a SIMBAD online lookup toggle.
 *
 * The parent SetupWizard renders the step heading and navigation footer.
 */
export function StepCatalogs({ settings, onSettingsChange }: StepCatalogsProps) {
  function toggleCatalog(key: keyof Omit<CatalogSettings, 'simbadOnline'>) {
    onSettingsChange({ ...settings, [key]: !settings[key] });
  }

  function toggleSimbad() {
    onSettingsChange({ ...settings, simbadOnline: !settings.simbadOnline });
  }

  const enabledCount = CATALOGS.filter((c) => settings[c.key]).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Context description */}
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

      {/* Catalog checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
        {CATALOGS.map((catalog) => (
          <div
            key={catalog.key}
            role="checkbox"
            aria-checked={settings[catalog.key]}
            tabIndex={0}
            onClick={() => toggleCatalog(catalog.key)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleCatalog(catalog.key);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--alm-space-3)',
              padding: 'var(--alm-space-3) var(--alm-space-4)',
              background: 'var(--alm-surface)',
              borderRadius: 'var(--alm-radius-sm)',
              border: '1px solid var(--alm-border)',
              cursor: 'pointer',
              transition: 'background 100ms',
            }}
          >
            {/* Checkbox */}
            <BaseCheckbox.Root
              checked={settings[catalog.key]}
              onCheckedChange={() => toggleCatalog(catalog.key)}
              className="alm-checkbox"
              aria-label={catalog.name}
              style={{
                width: 18,
                height: 18,
                borderRadius: 'var(--alm-radius-sm)',
                border: '1.5px solid var(--alm-gray-400)',
                background: settings[catalog.key] ? 'var(--alm-gray-900)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
                cursor: 'pointer',
                transition: 'background 150ms, border-color 150ms',
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <BaseCheckbox.Indicator
                style={{
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ✓
              </BaseCheckbox.Indicator>
            </BaseCheckbox.Root>

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
                {catalog.bundled && (
                  <Pill label="BUNDLED" variant="ok" size="sm" />
                )}
              </div>
            </div>

            {/* Status */}
            <span
              style={{
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-muted)',
                flexShrink: 0,
                alignSelf: 'center',
              }}
            >
              {settings[catalog.key]
                ? catalog.bundled
                  ? 'Included'
                  : 'Ready to download'
                : 'Skipped'}
            </span>
          </div>
        ))}
      </div>

      {/* Enabled count summary */}
      <div
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
        }}
      >
        {enabledCount} of {CATALOGS.length} catalogs selected
      </div>

      {/* Separator */}
      <div
        style={{
          borderTop: '1px solid var(--alm-border)',
          paddingTop: 'var(--alm-space-5)',
        }}
      >
        {/* SIMBAD online lookup */}
        <Box>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--alm-space-3)',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
                Online lookup
              </div>
              <div
                style={{
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-text-muted)',
                  marginTop: 'var(--alm-space-1)',
                  lineHeight: 1.5,
                  maxWidth: 440,
                }}
              >
                CDS Sesame/SIMBAD — resolve names, aliases, coordinates online when
                local catalogs don't match. Requires network.
              </div>
            </div>
            <Switch.Root
              checked={settings.simbadOnline}
              onCheckedChange={toggleSimbad}
              className="alm-switch"
              aria-label="Enable online SIMBAD lookup"
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: settings.simbadOnline ? 'var(--alm-gray-900)' : 'var(--alm-gray-200)',
                position: 'relative',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 150ms',
              }}
            >
              <Switch.Thumb
                className="alm-switch__thumb"
                style={{
                  display: 'block',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: settings.simbadOnline ? 18 : 2,
                  transition: 'left 150ms',
                }}
              />
            </Switch.Root>
          </div>
        </Box>
      </div>

      {/* Footer note */}
      <p
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.5,
        }}
      >
        These can be updated later in Settings &rarr; Target catalogs
      </p>
    </div>
  );
}
