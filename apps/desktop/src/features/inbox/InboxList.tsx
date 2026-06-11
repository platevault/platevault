/**
 * InboxList — left sidebar listing scanned inbox folders.
 *
 * Each row shows the relative path, lane pill (fits/video), classification
 * state, and a conflict/needs-review indicator.
 */

import { useState, useMemo } from 'react';
import { ListSidebar } from '@/components';
import { Pill } from '@/ui';
import type { InboxItemSummary } from '@/api/commands';
import type { PillVariant } from '@/ui';

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

type GroupBy = 'none' | 'lane';
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

  return (
    <ListSidebar
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
            <option value="lane">Group: lane</option>
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
            aria-label="Filter lane"
          >
            <option value="all">All lanes</option>
            <option value="fits">FITS</option>
            <option value="video">Video</option>
          </select>
        </div>
      }
      footer={
        <span className="alm-list-sidebar__count">{filtered.length} folder{filtered.length !== 1 ? 's' : ''}</span>
      }
    >
      {filtered.map((item, listIdx) => {
        // Find original index so selection maps back correctly.
        const originalIdx = items.indexOf(item);
        return (
          <div
            key={item.inboxItemId}
            data-testid={`inbox-item-${item.inboxItemId}`}
            className={`alm-list-item${selectedIdx === originalIdx ? ' alm-list-item--selected' : ''}`}
            onClick={() => onSelect(originalIdx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(originalIdx)}
            aria-selected={selectedIdx === originalIdx}
          >
            <div className="alm-list-item__title">
              <strong>{item.relativePath || '(root)'}</strong>
              <span style={{ marginLeft: 6 }}>
                <Pill variant={stateVariant(item.state)}>{stateLabel(item.state)}</Pill>
              </span>
              {item.lane === 'video' && (
                <span style={{ marginLeft: 4 }}>
                  <Pill variant="ghost">video</Pill>
                </span>
              )}
            </div>
            <div
              className="alm-list-item__meta"
              style={{ display: 'flex', gap: 8, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-color-fg-muted)' }}
            >
              <span>{item.fileCount} file{item.fileCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        );
      })}
    </ListSidebar>
  );
}
