import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Lucide icon element rendered at 36px in --text-faint. Pass e.g. <HardDrive size={36} /> */
  icon?: ReactNode;
  /** Main heading. Rendered at --fs-md / --fw-semibold. */
  heading?: ReactNode;
  /** One-line description below the heading. Rendered at --fs-small / --text-dim. */
  description?: ReactNode;
  /** Primary CTA — a Button or Link. */
  action?: ReactNode;
  /** Secondary affordance — rendered below the primary CTA. */
  secondaryAction?: ReactNode;
}

export function EmptyState({
  icon,
  heading,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="alm-empty">
      {icon ? (
        <div className="alm-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      {heading ? (
        <div className="alm-empty__heading">{heading}</div>
      ) : null}
      {description ? (
        <div className="alm-empty__desc">{description}</div>
      ) : null}
      {action ? <div className="alm-empty__action">{action}</div> : null}
      {secondaryAction ? (
        <div className="alm-empty__secondary">{secondaryAction}</div>
      ) : null}
    </div>
  );
}
