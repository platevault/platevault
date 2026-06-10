import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Short description shown below the title. */
  desc?: string;
  /** Alias for desc — accepted for backward compatibility. */
  description?: string;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState({ title, desc, description, action, className, ...rest }, ref) {
    const body = desc ?? description;
    const cls = ['alm-empty', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        <div className="alm-empty__title">{title}</div>
        {body && <div className="alm-empty__desc">{body}</div>}
        {action}
      </div>
    );
  }
);
EmptyState.displayName = 'EmptyState';
