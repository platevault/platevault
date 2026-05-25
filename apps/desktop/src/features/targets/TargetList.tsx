import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { Target } from '@/api/types';

export interface TargetListProps {
  targets: Target[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

/**
 * Target list pane (left side of three-pane layout).
 * Matches wireframe: search bar, items showing name + alias + stats.
 */
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

  const isUnresolved = (t: Target) => t.name === '(unresolved)';

  return (
    <div className="alm-target-list">
      {/* Search bar */}
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

      {/* Target items */}
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
            {/* Row 1: name + warning */}
            <div className="alm-target-list__row">
              <span className="alm-target-list__name">
                {target.name}
              </span>
              {isUnresolved(target) && (
                <span className="alm-target-list__warn" aria-label="Unresolved target">&#x26A0;</span>
              )}
            </div>

            {/* Row 2: alias (if present) */}
            {target.aliases.length > 0 && target.aliases[0] && (
              <div className="alm-target-list__alias">{target.aliases[0]}</div>
            )}

            {/* Row 3: stats */}
            <div className="alm-target-list__meta">
              <span>{target.session_count} sess</span>
              <span className="alm-target-list__dot" aria-hidden="true" />
              <span>{target.total_integration_hours.toFixed(1)}h</span>
              <span className="alm-target-list__dot" aria-hidden="true" />
              <span>{target.project_count} proj</span>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="alm-target-list__empty">No targets match your search</li>
        )}
      </ul>

      {/* New target footer */}
      <div className="alm-target-list__footer">+ new target</div>
    </div>
  );
}
