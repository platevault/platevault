/**
 * ListItem -- consistent selectable list row used inside ListSidebar.
 *
 * Renders a button-like element with selected state. The children render
 * the domain-specific content (target name, session info, etc.).
 *
 * Uses `.alm-list-item` and `.alm-list-item--selected` CSS classes.
 */

import { useCallback } from 'react';
import { clsx } from 'clsx';

export interface ListItemProps {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function ListItem({
  id,
  selected,
  onSelect,
  className,
  children,
}: ListItemProps) {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(id);
      }
    },
    [id, onSelect],
  );

  return (
    <div
      role="listitem"
      tabIndex={0}
      className={clsx(
        'alm-list-item',
        selected && 'alm-list-item--selected',
        className,
      )}
      aria-selected={selected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
