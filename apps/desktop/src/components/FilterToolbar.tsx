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

export interface GroupByControl {
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Visible label. Default "Group by". */
  label?: string;
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
  groupBy?: GroupByControl;
  sort?: SortControl;
  /** Trailing node rendered at the row's end (e.g. a secondary control). */
  actions?: ReactNode;
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

export function FilterToolbar({ search, fields, groupBy, sort, actions }: FilterToolbarProps) {
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
            aria-label={`Sort direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
            title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>
          </Btn>
        </div>
      )}

      {actions != null && <div className="alm-filterbar__actions">{actions}</div>}
    </div>
  );
}
