import { useState } from 'react';
import { Toggle, Table } from '@/ui';
import { TARGET_CATALOGS, type TargetCatalogFixture } from '@/data/fixtures/settings';

interface CatalogsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function Catalogs({ save }: CatalogsProps) {
  const [catalogs, setCatalogs] = useState<TargetCatalogFixture[]>(TARGET_CATALOGS);

  const handleToggle = (id: number, enabled: boolean) => {
    const updated = catalogs.map((c) => (c.id === id ? { ...c, enabled } : c));
    setCatalogs(updated);
    save('catalogs', { catalogs: updated });
  };

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Deep-Sky Catalogs</div>
        <Table
          columns={[
            { key: 'name', label: 'Catalog' },
            { key: 'objects', label: 'Objects', style: { width: 90 } },
            { key: 'lastUpdated', label: 'Last updated', style: { width: 120 } },
            { key: 'enabled', label: 'Enabled', style: { width: 80 } },
          ]}
          rows={catalogs.map((c) => ({
            name: <strong>{c.name}</strong>,
            objects: c.objects.toLocaleString(),
            lastUpdated: <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{c.lastUpdated}</span>,
            enabled: (
              <Toggle
                checked={c.enabled}
                onChange={(v) => handleToggle(c.id, v)}
              />
            ),
          }))}
        />
      </div>
    </>
  );
}
