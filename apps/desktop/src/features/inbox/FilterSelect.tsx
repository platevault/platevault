/**
 * T054 — FilterSelect: dropdown for selecting filter categories.
 *
 * Categories: Narrowband (Ha, SII, OIII, NII), Broadband (L, R, G, B),
 * Dual-band (HO, SO), Other (UV/IR Cut, Custom).
 *
 * Uses @base-ui-components/react/select.
 */

import { Select } from '@base-ui-components/react/select';

const FILTER_OPTIONS = [
  { value: '', label: 'All Filters' },
  // Narrowband
  { value: 'Ha', label: 'Ha' },
  { value: 'SII', label: 'SII' },
  { value: 'OIII', label: 'OIII' },
  { value: 'NII', label: 'NII' },
  // Broadband
  { value: 'L', label: 'L' },
  { value: 'R', label: 'R' },
  { value: 'G', label: 'G' },
  { value: 'B', label: 'B' },
  // Dual-band
  { value: 'HO', label: 'HO' },
  { value: 'SO', label: 'SO' },
  // Other
  { value: 'UV/IR Cut', label: 'UV/IR Cut' },
  { value: 'Custom', label: 'Custom' },
] as const;

const GROUP_LABELS: Record<string, { start: number; end: number }> = {
  Narrowband: { start: 1, end: 4 },
  Broadband: { start: 5, end: 8 },
  'Dual-band': { start: 9, end: 10 },
  Other: { start: 11, end: 12 },
};

export interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function FilterSelect({ value, onChange }: FilterSelectProps) {
  const handleChange = (newValue: string | null) => {
    onChange(newValue ?? '');
  };

  return (
    <Select.Root value={value} onValueChange={handleChange}>
      <Select.Trigger
        className="alm-select alm-select--sm"
        aria-label="Filter by filter type"
      >
        <Select.Value />
        <Select.Icon className="alm-select__icon" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup className="alm-select__popup">
            {/* All option */}
            <Select.Item value="" className="alm-select__item">
              <Select.ItemText>All Filters</Select.ItemText>
            </Select.Item>

            {/* Grouped options */}
            {Object.entries(GROUP_LABELS).map(([group, range]) => (
              <Select.Group key={group} className="alm-select__group">
                <Select.GroupLabel className="alm-select__group-label">
                  {group}
                </Select.GroupLabel>
                {FILTER_OPTIONS.slice(range.start, range.end + 1).map((opt) => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    className="alm-select__item"
                  >
                    <Select.ItemText>{opt.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
