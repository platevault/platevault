// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface DetailPaneProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  children: ReactNode;
  /**
   * Dashboard mode (design v4): the pane fills the available height, the header
   * and metric line stay pinned, and the primary column scrolls independently
   * of the rail. Use with DetailGrid. Without it, the pane scrolls as one block.
   */
  fill?: boolean;
}

/**
 * Extra DOM attributes (className, data- / aria- attrs) pass through to the root —
 * used by `DetailPanel` to stamp its `data-shared-detail` marker (spec 054
 * T012a guard) without every raw `DetailPane` consumer picking it up too.
 */
export function DetailPane({
  children,
  fill,
  className,
  ...rest
}: DetailPaneProps) {
  const classes = ['alm-detail', fill && 'alm-detail--fill', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
