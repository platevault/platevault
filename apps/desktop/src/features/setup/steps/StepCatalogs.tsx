import { useCallback } from 'react';
import { Btn } from '@/ui/Btn';
import { Box } from '@/ui/Box';
import { Switch } from '@base-ui-components/react/switch';
import { clsx } from 'clsx';

export interface CatalogSettings {
  messier: boolean;
  ngcIc: boolean;
  caldwell: boolean;
  sharpless: boolean;
  abell: boolean;
}

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  messier: true,
  ngcIc: true,
  caldwell: true,
  sharpless: true,
  abell: true,
};

export interface StepCatalogsProps {
  settings: CatalogSettings;
  onSettingsChange: (settings: CatalogSettings) => void;
}

interface CatalogDef {
  key: keyof CatalogSettings;
  name: string;
  description: string;
}

const CATALOG_DEFS: CatalogDef[] = [
  {
    key: 'messier',
    name: 'Messier',
    description: '110 classic deep-sky objects visible from the northern hemisphere',
  },
  {
    key: 'ngcIc',
    name: 'NGC / IC',
    description: 'Comprehensive catalog of galaxies, clusters, and nebulae (~14,000 entries)',
  },
  {
    key: 'caldwell',
    name: 'Caldwell',
    description: '109 deep-sky objects not in the Messier catalog',
  },
  {
    key: 'sharpless',
    name: 'Sharpless',
    description: '313 HII emission nebulae across the Milky Way',
  },
  {
    key: 'abell',
    name: 'Abell',
    description: 'Galaxy clusters and planetary nebulae catalog',
  },
];

/**
 * Step 3 -- Target Catalogs.
 * List of astronomical catalogs with enable/disable toggles and
 * a "Download All" button (mock for now).
 */
export function StepCatalogs({ settings, onSettingsChange }: StepCatalogsProps) {
  const handleToggle = useCallback(
    (key: keyof CatalogSettings, checked: boolean) => {
      onSettingsChange({ ...settings, [key]: checked });
    },
    [settings, onSettingsChange],
  );

  const handleDownloadAll = useCallback(() => {
    console.log('[StepCatalogs] Download All clicked (mock)');
  }, []);

  const enabledCount = Object.values(settings).filter(Boolean).length;

  return (
    <div className="alm-step-catalogs">
      <p className="alm-step-catalogs__intro">
        Target catalogs are used to resolve OBJECT headers in your FITS/XISF files
        to known astronomical objects. Toggle the catalogs you want to use.
      </p>

      <div className="alm-step-catalogs__list">
        {CATALOG_DEFS.map((def) => (
          <Box key={def.key}>
            <div className="alm-step-catalogs__row">
              <div className="alm-step-catalogs__row-info">
                <span className="alm-step-catalogs__row-name">{def.name}</span>
                <span className="alm-step-catalogs__row-desc">{def.description}</span>
              </div>
              <Switch.Root
                className={clsx('alm-switch', settings[def.key] && 'alm-switch--checked')}
                checked={settings[def.key]}
                onCheckedChange={(checked) => handleToggle(def.key, checked)}
                aria-label={`Enable ${def.name} catalog`}
              >
                <Switch.Thumb className="alm-switch__thumb" />
              </Switch.Root>
            </div>
          </Box>
        ))}
      </div>

      <div className="alm-step-catalogs__footer">
        <Btn size="sm" onClick={handleDownloadAll}>
          Download All
        </Btn>
        <span className="alm-step-catalogs__count">
          {enabledCount} of {CATALOG_DEFS.length} catalogs enabled
        </span>
      </div>

      <div className="alm-step-catalogs__note">
        Real catalog download will be available in a future update.
        Catalogs can be installed later from Settings.
      </div>
    </div>
  );
}
