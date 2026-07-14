// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Short description shown below the title. */
  description?: string;
  /** @deprecated Use `description`. Retained as a backward-compatible alias. */
  desc?: string;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    { title, description, desc, action, className, ...rest },
    ref,
  ) {
    const body = description ?? desc;
    const cls = ['alm-empty', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        <div className="alm-empty__title">{title}</div>
        {body && <div className="alm-empty__desc">{body}</div>}
        {action}
      </div>
    );
  },
);
EmptyState.displayName = 'EmptyState';
