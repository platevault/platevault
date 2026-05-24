import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { Target } from '@/api/types';
import { Pill } from '@/ui';

export interface TargetListProps {
  targets: Target[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function kindVariant(kind: string) {
  switch (kind) {
    case 'deep_sky':
      return 'info' as const;
    case 'planetary':
      return 'warn' as const;
    case 'lunar':
      return 'neutral' as const;
    case 'solar':
      return 'warn' as const;
    case 'landscape':
      return 'ghost' as const;
    default:
      return 'neutral' as const;
  }
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, ' ');
}

export function TargetList({ targets, selectedId, onSelect }: TargetListProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return targets;
    const q = search.toLowerCase();
    return targets.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.aliases.some((a) => a.toLowerCase().includes(q)) ||
        Object.values(t.catalog_ids).some((v) =>
          String(v).toLowerCase().includes(q),
        ),
    );
  }, [targets, search]);

  return (
    <div className="alm-target-list">
      <div className="alm-target-list__search">
        <input
          type="search"
          placeholder="Search targets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="alm-target-list__input"
          aria-label="Search targets"
        />
      </div>
      <ul className="alm-target-list__items" role="listbox" aria-label="Targets">
        {filtered.map((target) => (
          <li
            key={target.id}
            className={clsx(
              'alm-target-list__item',
              target.id === selectedId && 'alm-target-list__item--selected',
            )}
            role="option"
            aria-selected={target.id === selectedId}
            onClick={() => onSelect(target.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(target.id);
              }
            }}
            tabIndex={0}
          >
            <div className="alm-target-list__row">
              <span className="alm-target-list__name">{target.name}</span>
              <Pill label={formatKind(target.kind)} variant={kindVariant(target.kind)} size="sm" />
            </div>
            <div className="alm-target-list__meta">
              <span>{target.session_count} session{target.session_count !== 1 ? 's' : ''}</span>
              <span className="alm-target-list__dot" aria-hidden="true" />
              <span>{target.total_integration_hours.toFixed(1)}h</span>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="alm-target-list__empty">No targets match your search</li>
        )}
      </ul>
    </div>
  );
}
