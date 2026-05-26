import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import { Btn } from '@/ui';

interface CatalogsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  objectCount: number;
  enabled: boolean;
}

const INITIAL_CATALOGS: CatalogEntry[] = [
  {
    id: 'messier',
    name: 'Messier',
    description: '110 deep-sky objects catalogued by Charles Messier',
    objectCount: 110,
    enabled: true,
  },
  {
    id: 'ngc-ic',
    name: 'NGC-IC',
    description: 'New General Catalogue and Index Catalogue',
    objectCount: 13226,
    enabled: true,
  },
  {
    id: 'caldwell',
    name: 'Caldwell',
    description: 'Caldwell catalogue of 109 deep-sky objects visible in amateur telescopes',
    objectCount: 109,
    enabled: false,
  },
  {
    id: 'sharpless',
    name: 'Sharpless',
    description: 'Sharpless catalog of HII regions (Sh2)',
    objectCount: 313,
    enabled: false,
  },
  {
    id: 'abell',
    name: 'Abell',
    description: 'Abell catalog of planetary nebulae and galaxy clusters',
    objectCount: 86,
    enabled: false,
  },
];

export function Catalogs({ save }: CatalogsProps) {
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>(INITIAL_CATALOGS);

  const handleToggle = (id: string) => {
    const updated = catalogs.map((c) =>
      c.id === id ? { ...c, enabled: !c.enabled } : c,
    );
    setCatalogs(updated);
    save('catalogs', {
      catalogs: updated.map(({ id, enabled }) => ({ id, enabled })),
    });
  };

  const handleDownloadAll = () => {
    console.log('Download all catalogs triggered');
  };

  return (
    <div className="alm-catalogs">
      <div className="alm-catalogs__toolbar">
        <Btn size="sm" onClick={handleDownloadAll}>
          Download All
        </Btn>
      </div>

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
                <strong className="alm-catalogs__name">{catalog.name}</strong>
                <span className="alm-catalogs__desc">{catalog.description}</span>
                <span className="alm-catalogs__count">
                  {catalog.objectCount.toLocaleString()} objects
                </span>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
