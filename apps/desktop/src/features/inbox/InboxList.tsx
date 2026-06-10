/**
 * InboxList -- list sidebar for Inbox page.
 * Custom grid layout per design V3.
 */

import { useState, useMemo } from 'react';
import { ListSidebar } from '@/components';
import { Pill } from '@/ui';
import type { InboxFixture } from '@/data/fixtures/review';
import type { PillVariant } from '@/ui';

// ─── Helpers ────────────────────────────────────────────────────────────────

function frameTypeVariant(type: InboxFixture['frameType']): PillVariant {
  switch (type) {
    case 'light': return 'info';
    case 'dark': return 'neutral';
    case 'flat': return 'accent';
    case 'bias': return 'ghost';
    default: return 'neutral';
  }
}

type GroupBy = 'none' | 'type' | 'date';
type SortBy = 'newest' | 'oldest' | 'name';
type FilterType = 'all' | InboxFixture['frameType'];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InboxListProps {
  items: InboxFixture[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Controlled frame-type filter (URL-backed); `'all'` means no filter. */
  filterType: FilterType;
  onFilterTypeChange: (type: InboxFixture['frameType'] | undefined) => void;
  /** Controlled grouping (URL-backed); `'none'` means no grouping. */
  groupBy: GroupBy;
  onGroupByChange: (group: GroupBy | undefined) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function InboxList({
  items,
  selectedId,
  onSelect,
  filterType,
  onFilterTypeChange,
  groupBy,
  onGroupByChange,
}: InboxListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const filtered = useMemo(() => {
    let result = items;
    if (filterType !== 'all') {
      result = result.filter((item) => item.frameType === filterType);
    }
    const sorted = [...result];
    if (sortBy === 'newest') {
      sorted.sort((a, b) => b.date.localeCompare(a.date));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.date.localeCompare(b.date));
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => a.target.localeCompare(b.target));
    }
    return sorted;
  }, [items, filterType, sortBy]);

  return (
    <ListSidebar
      placeholder="Search inbox..."
      controls={
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 8px' }}>
          <select
            className="alm-select"
            value={groupBy}
            onChange={(e) => {
              const v = e.target.value as GroupBy;
              onGroupByChange(v === 'none' ? undefined : v);
            }}
            aria-label="Group by"
          >
            <option value="none">Group: none</option>
            <option value="type">Group: type</option>
            <option value="date">Group: date</option>
          </select>
          <select
            className="alm-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
          >
            <option value="newest">Sort: newest</option>
            <option value="oldest">Sort: oldest</option>
            <option value="name">Sort: name</option>
          </select>
          <select
            className="alm-select"
            value={filterType}
            onChange={(e) => {
              const v = e.target.value as FilterType;
              onFilterTypeChange(v === 'all' ? undefined : v);
            }}
            aria-label="Filter frame type"
          >
            <option value="all">All types</option>
            <option value="light">Lights</option>
            <option value="dark">Darks</option>
            <option value="flat">Flats</option>
            <option value="bias">Bias</option>
          </select>
        </div>
      }
      footer={
        <span className="alm-list-sidebar__count">{filtered.length} sessions</span>
      }
    >
      {filtered.map((item) => (
        <div
          key={item.id}
          className={`alm-list-item${selectedId === item.id ? ' alm-list-item--selected' : ''}`}
          onClick={() => onSelect(item.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(item.id)}
        >
          {/* Title line */}
          <div className="alm-list-item__title">
            <strong>{item.target}</strong>
            {item.filter && (
              <span style={{ marginLeft: 6 }}><Pill variant="ghost">{item.filter}</Pill></span>
            )}
            <span style={{ marginLeft: 4 }}><Pill variant={frameTypeVariant(item.frameType)}>{item.frameType}</Pill></span>
            {item.conflict && (
              <span
                style={{ color: 'var(--alm-color-warn)', marginLeft: 4, fontSize: 'var(--alm-text-xs)' }}
                aria-label="Conflict detected"
              >
                &#x26A0;
              </span>
            )}
          </div>
          {/* Grid row */}
          <div
            className="alm-list-item__meta"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 2 }}
          >
            <span>{item.date}</span>
            <span>{item.frames} frames</span>
            <span>{item.duration}</span>
            <span>{item.size}</span>
          </div>
        </div>
      ))}
    </ListSidebar>
  );
}
