/**
 * Legacy types previously exported from ListSidebar and TopActionBar.
 * Feature files import these via @/components. Migrate callers to inline
 * patterns with alm-* CSS classes and remove this file when all usages
 * are gone.
 */

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

export interface ActionDef {
  label: string;
  hotkey?: string;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  onClick: () => void;
}
