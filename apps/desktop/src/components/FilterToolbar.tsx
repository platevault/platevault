/**
 * FilterToolbar — generic, prop-driven filter row (spec 043, task #63).
 *
 * Renders, in a single consistent row: an optional search box, any number of
 * labeled select fields, an optional "Group by" select, an optional sort
 * control (select + direction toggle), and trailing action node. Every slot is
 * optional — pass only what the page needs.
 *
 * This is what goes in `PageTopBar`'s `filters` slot. It owns NO state: all
 * values + change handlers are supplied by the host page (URL state, store,
 * local state — the toolbar does not care). Token-only styling via the shared
 * `.alm-filterbar*` classes; no inline styles.
 */

import type { ReactNode } from 'react';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** Stable key (used for React key + ids). */
  key: string;
  /** Visible label rendered before the select. */
  label: string;
  /** Current selected value (`''` = the leading "all/any" option). */
  value: string;
  /** Selectable options (excluding the implicit leading option). */
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Text of the leading option that clears the field. Default "All". */
  allLabel?: string;
}

/**
 * A multi-select filter field (task #82): a labeled control whose value is a
 * SET of selected option values, rendered as a compact popover of checkboxes.
 * Distinct from `FilterField` (single-select). Selecting zero options means
 * "none" — the host decides what an empty selection shows.
 */
export interface MultiFilterField {
  /** Stable key (used for React key + ids). */
  key: string;
  /** Visible label rendered before the control. */
  label: string;
  /** Currently selected option values. */
  value: string[];
  /** Selectable options. */
  options: FilterOption[];
  onChange: (value: string[]) => void;
}

export interface GroupByControl {
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Visible label. Default "Group by". */
  label?: string;
}

/**
 * Ordered MULTI-LEVEL grouping control ("Group by X, then by Y, then by Z").
 * The shared gold-standard grouping every list page gets — pair with the
 * `useGrouping` hook (which owns `dims` + persistence) and feed `dims` to the
 * page table's `groupByDimensions`. `dimensions` is the page-specific set of
 * selectable grouping dimensions.
 */
export interface GroupingControl {
  /** Selectable grouping dimensions for this page. */
  dimensions: FilterOption[];
  /** Active ordered dimension ids. */
  dims: string[];
  /** Set the dimension at a slot ("" clears it and deeper slots). */
  setSlot: (slot: number, value: string) => void;
  /** Number of ordered slots. Default 3. */
  maxLevels?: number;
}

export interface SortControl {
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  dir: 'asc' | 'desc';
  onDirToggle: () => void;
  /** Visible label. Default "Sort". */
  label?: string;
}

export interface SearchControl {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label. Default "Search". */
  ariaLabel?: string;
}

export interface FilterToolbarProps {
  search?: SearchControl;
  fields?: FilterField[];
  /** Multi-select fields (set-valued), rendered after the single-select fields. */
  multiFields?: MultiFilterField[];
  /** Single-tier group-by (legacy). Prefer `grouping` for multi-level. */
  groupBy?: GroupByControl;
  /** Ordered multi-level grouping (the shared gold standard). */
  grouping?: GroupingControl;
  sort?: SortControl;
  /** Trailing node rendered at the row's end (e.g. a secondary control). */
  actions?: ReactNode;
}

/**
 * The ordered multi-level grouping configurator: N `<select>` slots, each
 * offering this page's dimensions. A slot is enabled only once the previous
 * slot has a dimension; dimensions chosen earlier are excluded from later
 * slots. Selecting "—" clears the slot and all deeper ones.
 */
function GroupingSelects({ grouping }: { grouping: GroupingControl }) {
  const { dimensions, dims, setSlot, maxLevels = 3 } = grouping;
  return (
    <div className="alm-filterbar__group">
      {Array.from({ length: maxLevels }).map((_, slot) => {
        const value = dims[slot] ?? '';
        const disabled = slot > 0 && !dims[slot - 1];
        const usedEarlier = new Set(dims.slice(0, slot));
        return (
          <select
            // eslint-disable-next-line react/no-array-index-key -- fixed-length slot list
            key={slot}
            className="alm-filterbar__select"
            value={value}
            disabled={disabled}
            onChange={(e) => setSlot(slot, e.target.value)}
            aria-label={
              slot === 0
                ? m.inbox_group_by_aria()
                : m.inbox_group_by_level_aria({ level: slot + 1 })
            }
          >
            <option value="">
              {slot === 0 ? m.inbox_controls_group_none() : m.inbox_controls_then_none()}
            </option>
            {dimensions
              .filter((d) => d.value === value || !usedEarlier.has(d.value))
              .map((d) => (
                <option key={d.value} value={d.value}>
                  {slot === 0
                    ? m.inbox_groupby_chip_primary({ label: d.label })
                    : m.inbox_groupby_chip_secondary({ label: d.label })}
                </option>
              ))}
          </select>
        );
      })}
    </div>
  );
}

function LabeledSelect({
  id,
  label,
  value,
  options,
  onChange,
  leadingOption,
}: {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  leadingOption?: string;
}) {
  return (
    <label className="alm-filterbar__field">
      <span className="alm-filterbar__field-label">{label}</span>
      <select
        className="alm-filterbar__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        id={id}
      >
        {leadingOption != null && <option value="">{leadingOption}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Multi-select filter control: a `<details>` popover whose summary shows the
 * selection count and whose body is a list of option checkboxes. Native
 * `<details>` keeps it dependency-free, keyboard-accessible, and click-to-toggle
 * without any open-state wiring in the host. Token-only `.alm-filterbar__multi*`
 * styling; no inline styles.
 */
function MultiSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string[];
  options: FilterOption[];
  onChange: (value: string[]) => void;
}) {
  const selected = new Set(value);
  const toggle = (v: string): void => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Preserve option order in the emitted array for stable downstream behavior.
    onChange(options.map((o) => o.value).filter((ov) => next.has(ov)));
  };
  const summary =
    selected.size === 0
      ? 'None'
      : selected.size === options.length
        ? 'All'
        : `${selected.size} selected`;

  return (
    <label className="alm-filterbar__field">
      <span className="alm-filterbar__field-label">{label}</span>
      <details className="alm-filterbar__multi" id={id}>
        <summary className="alm-filterbar__multi-summary" aria-label={`${label}: ${summary}`}>
          {summary}
        </summary>
        <div className="alm-filterbar__multi-menu" role="group" aria-label={label}>
          {options.map((o) => (
            <label key={o.value} className="alm-filterbar__multi-option">
              <input
                type="checkbox"
                className="alm-filterbar__multi-check"
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </details>
    </label>
  );
}

export function FilterToolbar({
  search,
  fields,
  multiFields,
  groupBy,
  grouping,
  sort,
  actions,
}: FilterToolbarProps) {
  return (
    <div className="alm-filterbar">
      {search && (
        <input
          type="search"
          className="alm-filterbar__search"
          placeholder={search.placeholder ?? 'Search…'}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          aria-label={search.ariaLabel ?? 'Search'}
        />
      )}

      {fields?.map((f) => (
        <LabeledSelect
          key={f.key}
          id={`filterbar-${f.key}`}
          label={f.label}
          value={f.value}
          options={f.options}
          onChange={f.onChange}
          leadingOption={f.allLabel ?? 'All'}
        />
      ))}

      {multiFields?.map((f) => (
        <MultiSelect
          key={f.key}
          id={`filterbar-${f.key}`}
          label={f.label}
          value={f.value}
          options={f.options}
          onChange={f.onChange}
        />
      ))}

      {grouping && <GroupingSelects grouping={grouping} />}

      {groupBy && (
        <LabeledSelect
          id="filterbar-groupby"
          label={groupBy.label ?? 'Group by'}
          value={groupBy.value}
          options={groupBy.options}
          onChange={groupBy.onChange}
        />
      )}

      {sort && (
        <div className="alm-filterbar__sort">
          <LabeledSelect
            id="filterbar-sort"
            label={sort.label ?? 'Sort'}
            value={sort.value}
            options={sort.options}
            onChange={sort.onChange}
          />
          <Btn
            size="sm"
            variant="ghost"
            className="alm-filterbar__sort-dir"
            onClick={sort.onDirToggle}
            aria-label={m.filter_sort_dir_aria({ dir: sort.dir === 'asc' ? m.filter_sort_dir_ascending() : m.filter_sort_dir_descending() })}
            title={sort.dir === 'asc' ? m.filter_sort_dir_ascending() : m.filter_sort_dir_descending()}
          >
            <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>
          </Btn>
        </div>
      )}

      {actions != null && <div className="alm-filterbar__actions">{actions}</div>}
    </div>
  );
}
