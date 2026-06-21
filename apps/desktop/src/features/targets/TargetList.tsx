import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TargetListItem } from '@/api/commands';
import { ListSidebar } from '@/components';
import { Pill } from '@/ui';

/** Estimated row height (px) for the virtualizer's initial measurement.
 * Compact single-line rows (label · designation · type) keep a long catalog
 * scannable. */
const ROW_ESTIMATE = 34;

interface Props {
  targets: TargetListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function matchesSearch(t: TargetListItem, query: string): boolean {
  const q = query.toLowerCase();
  return (
    t.primaryDesignation.toLowerCase().includes(q) ||
    t.effectiveLabel.toLowerCase().includes(q)
  );
}

export function TargetList({ targets, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(
    () => (search.trim() ? targets.filter((t) => matchesSearch(t, search.trim())) : targets),
    [targets, search],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  return (
    <ListSidebar
      scrollRef={scrollRef}
      virtualized
      placeholder="Search targets..."
      searchValue={search}
      onSearchChange={setSearch}
      controls={
        <>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
          </select>
        </>
      }
      footer={`${filtered.length} items`}
    >
      <div
        className="alm-virtual-inner"
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const t = filtered[virtualRow.index];
          return (
            <div
              key={t.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={`alm-list-item${selected === t.id ? ' alm-list-item--selected' : ''}`}
              onClick={() => onSelect(t.id)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="alm-list-item__title">
                <strong>{t.effectiveLabel}</strong>
                {t.effectiveLabel !== t.primaryDesignation && (
                  <span className="alm-target-row__desig">({t.primaryDesignation})</span>
                )}
                <Pill variant="ghost">{t.objectType.replace('_', ' ')}</Pill>
              </div>
            </div>
          );
        })}
      </div>
    </ListSidebar>
  );
}
