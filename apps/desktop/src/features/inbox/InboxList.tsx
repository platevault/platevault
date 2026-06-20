/**
 * InboxList — left sidebar listing scanned inbox folders.
 *
 * Each row shows the relative path, file type pill (fits/video), classification
 * state, and a conflict/needs-review indicator.
 */

import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ListSidebar } from '@/components';
import { Pill } from '@/ui';
import type { InboxItemSummary } from '@/api/commands';
import type { PillVariant } from '@/ui';

/** Estimated row height (px) for the virtualizer's initial measurement. */
const ROW_ESTIMATE = 56;

// ── Helpers ──────────────────────────────────────────────────────────────────

function stateVariant(state: string): PillVariant {
  switch (state) {
    case 'classified':      return 'info';
    case 'plan_open':       return 'accent';
    case 'resolved':        return 'success' as PillVariant;
    default:                return 'neutral';
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'pending_classification': return 'pending';
    case 'classified':             return 'classified';
    case 'plan_open':              return 'plan open';
    case 'resolved':               return 'resolved';
    default:                       return state;
  }
}

type GroupBy = 'none' | 'type' | 'date';
type SortBy  = 'name' | 'state';
type FilterType = 'all' | 'fits' | 'video';

export interface InboxListProps {
  items: InboxItemSummary[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  filterType: string;
  onFilterTypeChange: (type: string | undefined) => void;
  groupBy: string;
  onGroupByChange: (group: string | undefined) => void;
}

export function InboxList({
  items,
  selectedIdx,
  onSelect,
  filterType,
  onFilterTypeChange,
  groupBy,
  onGroupByChange,
}: InboxListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const scrollRef = useRef<HTMLDivElement>(null);

  // O(1) original-index lookup keyed by stable item id. Selection is expressed
  // as an index into the *unfiltered* `items` array, so each rendered row needs
  // to map its id back to that original position. Building the map once (O(n))
  // replaces the previous per-row `items.indexOf(item)` (O(n²)).
  const originalIndexById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, idx) => map.set(item.inboxItemId, idx));
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (filterType !== 'all') {
      result = result.filter((item) => item.lane === filterType);
    }
    const sorted = [...result];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    } else if (sortBy === 'state') {
      sorted.sort((a, b) => a.state.localeCompare(b.state));
    }
    return sorted;
  }, [items, filterType, sortBy]);

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
      placeholder="Search inbox…"
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
            <option value="type">Group: image / video</option>
            <option value="date">Group: date</option>
          </select>
          <select
            className="alm-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
          >
            <option value="name">Sort: name</option>
            <option value="state">Sort: state</option>
          </select>
          <select
            className="alm-select"
            value={filterType}
            onChange={(e) => {
              const v = e.target.value as FilterType;
              onFilterTypeChange(v === 'all' ? undefined : v);
            }}
            aria-label="Filter file type"
          >
            <option value="all">All file types</option>
            <option value="fits">FITS</option>
            <option value="video">Video</option>
          </select>
        </div>
      }
      footer={
        <span className="alm-list-sidebar__count">{filtered.length} folder{filtered.length !== 1 ? 's' : ''}</span>
      }
    >
      <div
        className="alm-virtual-inner"
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = filtered[virtualRow.index];
          // O(1) lookup of the original index (falls back to the filtered index
          // only if the id is somehow absent — should not happen).
          const originalIdx = originalIndexById.get(item.inboxItemId) ?? virtualRow.index;
          return (
            <div
              key={item.inboxItemId}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              data-testid={`inbox-item-${item.inboxItemId}`}
              className={`alm-list-item${selectedIdx === originalIdx ? ' alm-list-item--selected' : ''}`}
              onClick={() => onSelect(originalIdx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(originalIdx)}
              aria-selected={selectedIdx === originalIdx}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="alm-list-item__title">
                <strong>{item.relativePath || '(root)'}</strong>
                <span style={{ marginLeft: 6 }}>
                  <Pill variant={stateVariant(item.state)}>{stateLabel(item.state)}</Pill>
                </span>
                {item.isMaster && (
                  <span style={{ marginLeft: 4 }}>
                    <Pill variant="info">{item.masterFrameType ?? 'master'} master</Pill>
                  </span>
                )}
                {!item.isMaster && item.format && item.format !== 'fits' && (
                  <span style={{ marginLeft: 4 }}>
                    <Pill variant="ghost">{item.format}</Pill>
                  </span>
                )}
                {!item.isMaster && !item.format && item.lane === 'video' && (
                  <span style={{ marginLeft: 4 }}>
                    <Pill variant="ghost">video</Pill>
                  </span>
                )}
              </div>
              <div
                className="alm-list-item__meta"
                style={{ display: 'flex', gap: 8, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
              >
                <span>{item.fileCount} file{item.fileCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ListSidebar>
  );
}
