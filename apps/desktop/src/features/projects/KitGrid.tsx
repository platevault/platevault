import { memo, useMemo } from 'react';
import type { ProjectSource } from '@/bindings/types';
import { Btn } from '@/ui';

export interface KitGridProps {
  sources: ProjectSource[];
  compact?: boolean;
}

interface KitColumn {
  title: string;
  role: ProjectSource['role'];
  countLabel: string;
}

export const KitGrid = memo(function KitGrid({ sources, compact }: KitGridProps) {
  const grouped = useMemo(() => {
    const lights = sources.filter((s) => s.role === 'light');
    const darks = sources.filter((s) => s.role === 'dark');
    const flats = sources.filter((s) => s.role === 'flat');
    const bias = sources.filter((s) => s.role === 'bias');

    const lightHours = lights
      .filter((l) => l.hours !== '—')
      .reduce((s, l) => {
        const h = parseFloat(l.hours);
        return s + (isNaN(h) ? 0 : h);
      }, 0);

    return {
      lights: {
        title: 'Lights',
        count: `${lights.length} sess · ${lightHours.toFixed(1)}h`,
        items: lights,
        addLabel: '+ Add session',
      },
      darks: {
        title: 'Darks',
        count: `${darks.length} master${darks.length !== 1 ? 's' : ''}`,
        items: darks,
        addLabel: '+ Add master',
      },
      flats: {
        title: 'Flats',
        count: `${flats.length} master${flats.length !== 1 ? 's' : ''}`,
        items: flats,
        addLabel: '+ Add master',
        notice: flats.length < 3 ? null : null, // Could add warnings here
      },
      bias: {
        title: 'Bias',
        count: `${bias.length} ${bias.some((b) => b.selection === 'candidate') ? 'candidate' : 'master'}`,
        items: bias,
        addLabel: '+ Add master',
      },
    };
  }, [sources]);

  const columns = [grouped.lights, grouped.darks, grouped.flats, grouped.bias];

  return (
    <div className="alm-kit-grid">
      {columns.map((col) => (
        <div key={col.title} className="alm-kit-col">
          <div className="alm-kit-col__header">
            <span className="alm-kit-col__title">{col.title}</span>
            <span className="alm-kit-col__count">{col.count}</span>
          </div>
          <div className="alm-kit-col__body">
            {col.items.map((source, i) => (
              <div
                key={i}
                className={`alm-kit-card${source.selection === 'selected' ? ' alm-kit-card--selected' : ''}${source.selection === 'candidate' ? ' alm-kit-card--candidate' : ''}`}
                style={compact ? { padding: '4px' } : undefined}
              >
                <div className="alm-kit-card__row">
                  <input
                    type="checkbox"
                    defaultChecked={source.selection === 'selected'}
                    style={{ margin: 0 }}
                  />
                  <span className="alm-kit-card__name">
                    {source.name.replace(/^.*?·\s*/, '')}
                  </span>
                </div>
                <div className="alm-kit-card__meta alm-mono">
                  {source.frames > 1
                    ? `${source.frames}× 300s · ${source.hours}`
                    : source.hours !== '—'
                      ? source.hours
                      : `${source.name.split('_').slice(1, 3).join(' · ')}`}
                </div>
                {source.warning && (
                  <div className="alm-kit-card__warn">&#x26A0; {source.warning}</div>
                )}
              </div>
            ))}
            <Btn size="sm" style={{ width: '100%', marginTop: 'var(--alm-space-2)' }}>
              {col.addLabel}
            </Btn>
          </div>
        </div>
      ))}
    </div>
  );
});
