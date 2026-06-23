import type { ReactNode, Ref } from 'react';
import { m } from '@/lib/i18n';

export interface ListSidebarProps {
  placeholder?: string;
  /** Controlled search value. When provided, the input is controlled. */
  searchValue?: string;
  /** Called when the user types in the search box. */
  onSearchChange?: (value: string) => void;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /**
   * Forward a ref to the scrolling list container so callers can virtualize
   * its contents (the container owns `overflow-y: auto`). When set, the
   * container is tagged `data-virtual-scroll` so a virtualizer can target it.
   */
  scrollRef?: Ref<HTMLDivElement>;
  /** Tag the list container as a virtual-scroll viewport (test/measure hook). */
  virtualized?: boolean;
}

export function ListSidebar({
  placeholder,
  searchValue,
  onSearchChange,
  controls,
  footer,
  children,
  scrollRef,
  virtualized = false,
}: ListSidebarProps) {
  return (
    <div className="alm-list-sidebar">
      <div className="alm-list-sidebar__search">
        <input
          type="text"
          placeholder={placeholder || m.common_search_placeholder()}
          value={searchValue ?? ''}
          onChange={onSearchChange ? (e) => onSearchChange(e.target.value) : undefined}
          readOnly={!onSearchChange}
          aria-label={placeholder || m.common_search_aria()}
        />
      </div>
      {controls && <div className="alm-list-sidebar__controls">{controls}</div>}
      <div
        className={`alm-list-sidebar__list${virtualized ? ' alm-virtual-scroll' : ''}`}
        ref={scrollRef}
        data-virtual-scroll={virtualized ? 'true' : undefined}
      >
        {children}
      </div>
      {footer && <div className="alm-list-sidebar__footer">{footer}</div>}
    </div>
  );
}
