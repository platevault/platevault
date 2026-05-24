import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Reusable empty state placeholder shown when a page or list has no data.
 * Renders a centered icon, title, optional description, and optional action CTA.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="alm-empty-state" role="status" aria-label={title}>
      {icon && <div className="alm-empty-state__icon" aria-hidden="true">{icon}</div>}
      <h3 className="alm-empty-state__title">{title}</h3>
      {description && <p className="alm-empty-state__description">{description}</p>}
      {action && <div className="alm-empty-state__action">{action}</div>}
    </div>
  );
}
