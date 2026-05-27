import type { ReactNode } from 'react';

export interface ListSidebarProps {
  placeholder?: string;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function ListSidebar({ placeholder, controls, footer, children }: ListSidebarProps) {
  return (
    <div className="alm-list-sidebar">
      <div className="alm-list-sidebar__search">
        <input type="text" placeholder={placeholder || 'Search...'} />
      </div>
      {controls && <div className="alm-list-sidebar__controls">{controls}</div>}
      <div className="alm-list-sidebar__list">{children}</div>
      {footer && <div className="alm-list-sidebar__footer">{footer}</div>}
    </div>
  );
}
