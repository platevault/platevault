import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  /** Short description shown below the title. */
  desc?: string;
  /** Alias for desc — accepted for backward compatibility. */
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, desc, description, action }: EmptyStateProps) {
  const body = desc ?? description;
  return (
    <div className="alm-empty">
      <div className="alm-empty__title">{title}</div>
      {body && <div className="alm-empty__desc">{body}</div>}
      {action}
    </div>
  );
}
