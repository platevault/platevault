/**
 * InboxControls — the Inbox list's grouping / sort / frame-type controls.
 *
 * spec 043 (tasks #73/#75/#76 + #31/#63): the controls that previously lived
 * STACKED in the left column's ListSidebar header now move UP into the shared
 * PageTopBar's FilterToolbar (consistent with Sessions / Calibration). This
 * component owns the control row + its persisted state, so both the page (which
 * renders it in the top bar) and the unit tests can mount it standalone.
 *
 * It keeps the rich USER-CONFIGURABLE multi-level grouping ("first by X, then
 * by Y, then by Z") with localStorage persistence (spec 041 T021) — the
 * single-select group-by of the generic FilterToolbar is not expressive enough,
 * so the configurator is passed as the toolbar's trailing controls node.
 *
 * Frame-type filter is KEPT (unlike Sessions): frame type is meaningful in the
 * Inbox where raw light/dark/flat/bias folders coexist before confirmation.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DimensionAccessor } from './grouping';
import type { InboxListItem } from '@/api/commands';
import { m } from '@/lib/i18n';

// ── Grouping dimension registry ─────────────────────────────────────────────────

/** A user-selectable grouping dimension. */
export interface Dimension {
  id: string;
  label: string;
  accessor: DimensionAccessor<InboxListItem>;
}

/** Basename (last path segment) of an absolute path, for the "source" dimension. */
function basename(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || null;
}

/**
 * Ordered registry of dimensions the user can group by. Accessors return the
 * string value or null/undefined; the engine buckets null/empty under its
 * NONE_KEY → "(none)" label.
 */
export const GROUPING_DIMENSIONS: readonly Dimension[] = [
  { id: 'target',     label: 'Target',      accessor: (i) => i.groupTarget },
  { id: 'frameType',  label: 'Frame type',  accessor: (i) => i.groupFrameType },
  { id: 'date',       label: 'Date',        accessor: (i) => i.groupDate },
  { id: 'filter',     label: 'Filter',      accessor: (i) => i.groupFilter },
  { id: 'exposure',   label: 'Exposure',    accessor: (i) => i.groupExposure },
  { id: 'instrument', label: 'Instrument',  accessor: (i) => i.groupInstrument },
  { id: 'source',     label: 'Source',      accessor: (i) => basename(i.rootAbsolutePath) },
  { id: 'format',     label: 'Format',      accessor: (i) => i.format },
  { id: 'orgState',   label: 'Org. state',  accessor: (i) => i.organizationState },
];

/** Accessor map keyed by dimension id, consumed by `groupByDimensions`. */
export const ACCESSORS: Record<string, DimensionAccessor<InboxListItem>> =
  Object.fromEntries(GROUPING_DIMENSIONS.map((d) => [d.id, d.accessor]));

export const DIM_LABELS: Record<string, string> =
  Object.fromEntries(GROUPING_DIMENSIONS.map((d) => [d.id, d.label]));

/** Number of ordered grouping slots offered in the configurator. */
const MAX_GROUP_LEVELS = 3;

/** localStorage key for the persisted ordered grouping dimensions. */
export const GROUPING_STORAGE_KEY = 'inbox.grouping.dims.v1';

/** Sentinel value used by the dropdowns for "no grouping at this slot". */
const NONE_DIM = '';

export type InboxSortBy = 'name' | 'state';

function loadDims(): string[] {
  try {
    const raw = localStorage.getItem(GROUPING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only known dimension ids, drop duplicates, cap at MAX_GROUP_LEVELS.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of parsed) {
      if (typeof d === 'string' && ACCESSORS[d] && !seen.has(d)) {
        seen.add(d);
        out.push(d);
        if (out.length >= MAX_GROUP_LEVELS) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function saveDims(dims: string[]): void {
  try {
    localStorage.setItem(GROUPING_STORAGE_KEY, JSON.stringify(dims));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Hook that owns the persisted ordered grouping dimensions, sort, and frame
 * type filter. The page lifts this so the controls live in the top bar while
 * the list (`InboxList`) stays a controlled presentational component.
 */
export function useInboxControls() {
  const [dims, setDims] = useState<string[]>(() => loadDims());
  const [sortBy, setSortBy] = useState<InboxSortBy>('name');

  // Persist the chosen ordered dimensions whenever they change.
  useEffect(() => {
    saveDims(dims);
  }, [dims]);

  /**
   * Update the dimension at `slot`. Selecting "(none)" clears this slot and all
   * deeper slots (a none terminates the ordered chain). Selecting a real
   * dimension also removes any later slot already using it (no duplicates).
   */
  const setSlot = useCallback((slot: number, value: string) => {
    setDims((prev) => {
      const next = prev.slice(0, slot);
      if (value !== NONE_DIM) {
        const filteredPrev = next.filter((d) => d !== value);
        filteredPrev.push(value);
        return filteredPrev.slice(0, MAX_GROUP_LEVELS);
      }
      return next;
    });
  }, []);

  return { dims, sortBy, setSortBy, setSlot };
}

export interface InboxControlsProps {
  dims: string[];
  setSlot: (slot: number, value: string) => void;
  sortBy: InboxSortBy;
  onSortByChange: (v: InboxSortBy) => void;
  filterType: string;
  onFilterTypeChange: (type: string | undefined) => void;
}

type FilterType = 'all' | 'fits' | 'video';

/**
 * The grouping configurator + sort + frame-type controls, laid out as a single
 * inline row suitable for the FilterToolbar's trailing controls slot.
 */
export function InboxControls({
  dims,
  setSlot,
  sortBy,
  onSortByChange,
  filterType,
  onFilterTypeChange,
}: InboxControlsProps) {
  return (
    <div className="alm-inbox-list__controls alm-inbox-list__controls--toolbar">
      {/* Ordered grouping configurator: "Group by X, then by Y, then by Z". */}
      <div className="alm-inbox-list__group-row">
        {Array.from({ length: MAX_GROUP_LEVELS }).map((_, slot) => {
          const value = dims[slot] ?? NONE_DIM;
          // A slot is only enabled if all earlier slots have a dimension.
          const disabled = slot > 0 && !dims[slot - 1];
          // Dimensions already chosen in earlier slots are excluded here.
          const usedEarlier = new Set(dims.slice(0, slot));
          return (
            <select
              key={slot}
              className="alm-select"
              value={value}
              disabled={disabled}
              onChange={(e) => setSlot(slot, e.target.value)}
              aria-label={slot === 0 ? 'Group by' : `Then group by (level ${slot + 1})`}
            >
              <option value={NONE_DIM}>
                {slot === 0 ? m.inbox_controls_group_none() : m.inbox_controls_then_none()}
              </option>
              {GROUPING_DIMENSIONS.filter(
                (d) => d.id === value || !usedEarlier.has(d.id),
              ).map((d) => (
                <option key={d.id} value={d.id}>
                  {slot === 0 ? `Group: ${d.label}` : `then: ${d.label}`}
                </option>
              ))}
            </select>
          );
        })}
      </div>
      {/* Sort + frame-type filter controls. */}
      <div className="alm-inbox-list__sort-row">
        <select
          className="alm-select"
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as InboxSortBy)}
          aria-label={m.inbox_sort_by_aria()}
        >
          <option value="name">{m.targets_legacy_sort_name()}</option>
          <option value="state">{m.inbox_sort_state()}</option>
        </select>
        <select
          className="alm-select"
          value={filterType}
          onChange={(e) => {
            const v = e.target.value as FilterType;
            onFilterTypeChange(v === 'all' ? undefined : v);
          }}
          aria-label={m.inbox_filter_file_type_aria()}
        >
          <option value="all">{m.inbox_filter_all_file_types()}</option>
          <option value="fits">{m.inbox_filter_fits()}</option>
          <option value="video">{m.inbox_filter_video()}</option>
        </select>
      </div>
    </div>
  );
}
