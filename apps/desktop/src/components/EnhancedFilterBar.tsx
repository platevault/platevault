/**
 * EnhancedFilterBar — extends the ui/FilterBar pattern with a text search input
 * and dropdown filters in addition to toggle pills.
 *
 * Layout: search input left, pills center, dropdowns right. All inline in one row.
 */

import { Toggle } from '@base-ui-components/react/toggle';
import { ToggleGroup } from '@base-ui-components/react/toggle-group';
import { Select } from '@base-ui-components/react/select';
import { clsx } from 'clsx';

export interface EnhancedFilterBarProps {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;

  pills?: { value: string; label: string; active: boolean }[];
  onPillToggle?: (value: string) => void;

  dropdowns?: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }[];
}

export function EnhancedFilterBar({
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
  pills,
  onPillToggle,
  dropdowns,
}: EnhancedFilterBarProps) {
  const activePills = pills?.filter((p) => p.active).map((p) => p.value) ?? [];

  const handlePillToggle = (newValue: unknown[]) => {
    if (!onPillToggle) return;
    const added = (newValue as string[]).find((k) => !activePills.includes(k));
    const removed = activePills.find((k) => !(newValue as string[]).includes(k));
    const toggled = added ?? removed;
    if (toggled) onPillToggle(toggled);
  };

  return (
    <div className="alm-enhanced-filter-bar" role="toolbar" aria-label="Filters">
      {/* Search input — left */}
      <div className="alm-enhanced-filter-bar__search">
        <input
          type="search"
          className="alm-input alm-input--sm"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={searchPlaceholder}
        />
      </div>

      {/* Pills — center */}
      {pills && pills.length > 0 && (
        <ToggleGroup
          className="alm-enhanced-filter-bar__pills"
          value={activePills}
          onValueChange={handlePillToggle}
          multiple
        >
          {pills.map((pill) => (
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
      )}

      {/* Dropdowns — right */}
      {dropdowns && dropdowns.length > 0 && (
        <div className="alm-enhanced-filter-bar__dropdowns">
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
                      <Select.Item
                        key={opt.value}
                        value={opt.value}
                        className="alm-select__item"
                      >
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
    </div>
  );
}
