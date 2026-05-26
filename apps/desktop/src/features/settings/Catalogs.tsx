import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import { Btn } from '@/ui';

interface CatalogsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface CatalogSource {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  lastSynced?: string;
}

const INITIAL_CATALOGS: CatalogSource[] = [
  {
    id: 'messier',
    name: 'Messier Catalog',
    description: '110 deep-sky objects catalogued by Charles Messier',
    enabled: true,
    lastSynced: '2026-04-01',
  },
  {
    id: 'ngc',
    name: 'NGC / IC',
    description: 'New General Catalogue and Index Catalogue (~13,000 objects)',
    enabled: true,
    lastSynced: '2026-04-01',
  },
  {
    id: 'sharpless',
    name: 'Sharpless (Sh2)',
    description: 'Sharpless catalog of HII regions (313 objects)',
    enabled: false,
  },
  {
    id: 'abell',
    name: 'Abell Planetary Nebulae',
    description: 'Abell catalog of planetary nebulae (86 objects)',
    enabled: false,
  },
];

export function Catalogs({ save }: CatalogsProps) {
  const [catalogs, setCatalogs] = useState<CatalogSource[]>(INITIAL_CATALOGS);

  const handleToggle = (id: string) => {
    const updated = catalogs.map((c) =>
      c.id === id ? { ...c, enabled: !c.enabled } : c,
    );
    setCatalogs(updated);
    save('catalogs', {
      catalogs: updated.map(({ id, enabled }) => ({ id, enabled })),
    });
  };

  const handleSync = (id: string) => {
    const updated = catalogs.map((c) =>
      c.id === id ? { ...c, lastSynced: new Date().toISOString().split('T')[0] } : c,
    );
    setCatalogs(updated);
  };

  return (
    <div className="alm-catalogs">
      <ul className="alm-catalogs__list">
        {catalogs.map((catalog) => (
          <li key={catalog.id} className="alm-catalogs__item">
            <label className="alm-catalogs__toggle">
              <Switch.Root
                className="alm-switch"
                checked={catalog.enabled}
                onCheckedChange={() => handleToggle(catalog.id)}
                aria-label={`Enable ${catalog.name}`}
              >
                <Switch.Thumb className="alm-switch__thumb" />
              </Switch.Root>
              <div className="alm-catalogs__info">
                <strong>{catalog.name}</strong>
                <span className="alm-catalogs__desc">{catalog.description}</span>
                {catalog.lastSynced && (
                  <span className="alm-catalogs__synced">
                    Last synced: {catalog.lastSynced}
                  </span>
                )}
              </div>
            </label>
            <Btn
              size="sm"
              onClick={() => handleSync(catalog.id)}
              disabled={!catalog.enabled}
            >
              Sync
            </Btn>
          </li>
        ))}
      </ul>
    </div>
  );
}
