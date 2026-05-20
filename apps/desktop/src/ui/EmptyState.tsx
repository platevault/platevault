import type { ReactNode } from "react";

export interface EmptyStateProps {
  message: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="alm-empty">
      <div className="alm-empty__message">{message}</div>
      {action}
    </div>
  );
}
