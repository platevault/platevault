/**
 * ListSidebar -- composite list panel for the left column of list-detail screens.
 * Contains search, optional group-by selector, optional sort selector, optional
 * filter pills, optional filter dropdowns, a scrollable list area, an optional
 * pinned action footer, and an item count footer.
 *
 * Uses @base-ui-components/react/select for dropdowns.
 * Keyboard: Ctrl+F focuses the search input.
 */

import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import { Select } from '@base-ui-components/react/select';
import { Toggle } from '@base-ui-components/react/toggle';
import { ToggleGroup } from '@base-ui-components/react/toggle-group';
import { clsx } from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FilterPill {
  value: string;
  label: string;
  active: boolean;
}

export interface DropdownDef {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export interface ListSidebarProps {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (query: string) => void;

  groupOptions?: SelectOption[];
  groupValue?: string;
  onGroupChange?: (value: string) => void;

  sortOptions?: SelectOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;

  filterPills?: FilterPill[];
  onFilterToggle?: (value: string) => void;

  dropdowns?: DropdownDef[];

  itemCount: number;
  actionFooter?: ReactNode;
  children: ReactNode;
}

export function ListSidebar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  groupOptions,
  groupValue,
  onGroupChange,
  sortOptions,
  sortValue,
  onSortChange,
  filterPills,
  onFilterToggle,
  dropdowns,
  itemCount,
  actionFooter,
  children,
}: ListSidebarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const activePills = filterPills?.filter((p) => p.active).map((p) => p.value) ?? [];

  const handlePillToggle = (newValue: unknown[]) => {
    if (!onFilterToggle) return;
    const added = (newValue as string[]).find((k) => !activePills.includes(k));
    const removed = activePills.find((k) => !(newValue as string[]).includes(k));
    const toggled = added ?? removed;
    if (toggled) onFilterToggle(toggled);
  };

  const handleGroupChange = (value: string | null) => {
    if (value !== null) onGroupChange?.(value);
  };

  const handleSortChange = (value: string | null) => {
    if (value !== null) onSortChange?.(value);
  };

  const hasControls =
    (groupOptions && groupOptions.length > 0) ||
    (sortOptions && sortOptions.length > 0);

  return (
    <aside className="alm-list-sidebar" aria-label="List sidebar">
      {/* Search */}
      <div className="alm-list-sidebar__search">
        <input
          ref={searchRef}
          type="search"
          className="alm-input alm-list-sidebar__search-input"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={searchPlaceholder}
        />
      </div>

      {/* Controls row: group + sort (optional) */}
      {hasControls && (
        <div className="alm-list-sidebar__controls">
          {groupOptions && groupOptions.length > 0 && groupValue !== undefined && (
            <Select.Root value={groupValue} onValueChange={handleGroupChange}>
              <Select.Trigger className="alm-select alm-select--sm" aria-label="Group by">
                <Select.Value />
                <Select.Icon className="alm-select__icon" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner>
                  <Select.Popup className="alm-select__popup">
                    {groupOptions.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value} className="alm-select__item">
                        <Select.ItemText>{opt.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          )}

          {sortOptions && sortOptions.length > 0 && sortValue !== undefined && (
            <Select.Root value={sortValue} onValueChange={handleSortChange}>
              <Select.Trigger className="alm-select alm-select--sm" aria-label="Sort by">
                <Select.Value />
                <Select.Icon className="alm-select__icon" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner>
                  <Select.Popup className="alm-select__popup">
                    {sortOptions.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value} className="alm-select__item">
                        <Select.ItemText>{opt.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          )}
        </div>
      )}

      {/* Filter pills (optional) */}
      {filterPills && filterPills.length > 0 && (
        <div className="alm-list-sidebar__filters">
          <ToggleGroup
            className="alm-list-sidebar__pill-group"
            value={activePills}
            onValueChange={handlePillToggle}
            multiple
          >
            {filterPills.map((pill) => (
              <Toggle
                key={pill.value}
                value={pill.value}
                className={clsx(
                  'alm-filter-chip',
                  pill.active && 'alm-filter-chip--active',
                )}
                aria-label={pill.label}
              >
                {pill.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      )}

      {/* Extra filter dropdowns (optional) */}
      {dropdowns && dropdowns.length > 0 && (
        <div className="alm-list-sidebar__dropdowns">
          {dropdowns.map((dd) => (
            <Select.Root
              key={dd.label}
              value={dd.value}
              onValueChange={(v: string | null) => {
                if (v !== null) dd.onChange(v);
              }}
            >
              <Select.Trigger className="alm-select alm-select--sm" aria-label={dd.label}>
                <Select.Value />
                <Select.Icon className="alm-select__icon" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner>
                  <Select.Popup className="alm-select__popup">
                    {dd.options.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value} className="alm-select__item">
                        <Select.ItemText>{opt.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          ))}
        </div>
      )}

      {/* Scrollable list area */}
      <div className="alm-list-sidebar__list" role="list">
        {children}
      </div>

      {/* Pinned action footer (optional) */}
      {actionFooter && (
        <div className="alm-list-sidebar__action-footer">
          {actionFooter}
        </div>
      )}

      {/* Footer with item count */}
      <footer className="alm-list-sidebar__footer">
        <span className="alm-list-sidebar__count">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </footer>
    </aside>
  );
}
