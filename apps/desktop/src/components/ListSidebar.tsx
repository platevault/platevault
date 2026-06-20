import type { ReactNode } from 'react';

export interface ListSidebarProps {
  placeholder?: string;
  /** Controlled search value. When provided, the input is controlled. */
  searchValue?: string;
  /** Called when the user types in the search box. */
  onSearchChange?: (value: string) => void;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function ListSidebar({ placeholder, searchValue, onSearchChange, controls, footer, children }: ListSidebarProps) {
  return (
    <div className="alm-list-sidebar">
      <div className="alm-list-sidebar__search">
        <input
          type="text"
          placeholder={placeholder || 'Search...'}
          value={searchValue ?? ''}
          onChange={onSearchChange ? (e) => onSearchChange(e.target.value) : undefined}
          readOnly={!onSearchChange}
          aria-label={placeholder || 'Search'}
        />
      </div>
      {controls && <div className="alm-list-sidebar__controls">{controls}</div>}
      <div className="alm-list-sidebar__list">{children}</div>
      {footer && <div className="alm-list-sidebar__footer">{footer}</div>}
    </div>
  );
}
