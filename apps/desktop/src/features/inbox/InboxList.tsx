/**
 * InboxList — left sidebar listing scanned inbox folders.
 *
 * Each row shows the relative path, state, file count, format, and master
 * indicator using aligned text columns (FR-008) — no Pill components in the
 * per-row layout so nothing overflows horizontally at 1100×720.
 */

import { useState, useMemo } from 'react';
import { ListSidebar } from '@/components';
import type { InboxItemSummary } from '@/api/commands';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateLabel(state: string): string {
  switch (state) {
    case 'pending_classification': return 'pending';
    case 'classified':             return 'classified';
    case 'plan_open':              return 'plan open';
    case 'resolved':               return 'resolved';
    default:                       return state;
  }
}

/**
 * Short, uppercase format tag shown in the format column.
 * Keeps width predictable for alignment.
 */
function formatTag(item: InboxItemSummary): string {
  if (item.lane === 'video') return 'VIDEO';
  if (item.format === 'xisf') return 'XISF';
  if (item.format === 'mixed') return 'MIXED';
  return 'FITS';
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
      {filtered.map((item) => {
        // Find original index so selection maps back correctly.
        const originalIdx = items.indexOf(item);
        return (
          <div
            key={item.inboxItemId}
            data-testid={`inbox-item-${item.inboxItemId}`}
            className={`alm-list-item${selectedIdx === originalIdx ? ' alm-list-item--selected' : ''}${item.state === 'plan_open' ? ' alm-list-item--muted' : ''}`}
            onClick={() => onSelect(originalIdx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(originalIdx)}
            aria-selected={selectedIdx === originalIdx}
          >
            {/* ── Primary line: path ── */}
            <div className="alm-list-item__title">
              <strong>{item.relativePath || '(root)'}</strong>
            </div>

            {/* ── Secondary line: structured columns ── */}
            <div
              className="alm-list-item__meta"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto auto',
                gap: '0 var(--alm-sp-2)',
                alignItems: 'baseline',
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-muted)',
                marginTop: 2,
              }}
            >
              {/* State — left column, truncates if narrow */}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--alm-text-secondary)',
                }}
              >
                {stateLabel(item.state)}
              </span>

              {/* File count — fixed right */}
              <span style={{ whiteSpace: 'nowrap' }}>
                {item.fileCount} {item.fileCount !== 1 ? 'files' : 'file'}
              </span>

              {/* Format / master indicator — fixed right */}
              <span
                style={{
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--alm-font-mono, monospace)',
                  letterSpacing: '0.02em',
                }}
              >
                {item.isMaster
                  ? `${item.masterFrameType ?? 'master'} master`
                  : formatTag(item)}
              </span>
            </div>
          </div>
        );
      })}
    </ListSidebar>
  );
}
