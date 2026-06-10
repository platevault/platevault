import type { ReactNode } from 'react';

export interface DetailPaneProps {
  children: ReactNode;
  /**
   * Dashboard mode (design v4): the pane fills the available height, the header
   * and metric line stay pinned, and the primary column scrolls independently
   * of the rail. Use with DetailGrid. Without it, the pane scrolls as one block.
   */
  fill?: boolean;
}

export function DetailPane({ children, fill }: DetailPaneProps) {
  return <div className={`alm-detail${fill ? ' alm-detail--fill' : ''}`}>{children}</div>;
}
