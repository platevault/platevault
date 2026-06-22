/**
 * ProjectStatusTag — spec 043 task #105.
 *
 * Replaces the filled-background Pill badge used for project lifecycle state
 * in both the ProjectsTable status column and the ProjectDetail header.
 *
 * Design: a 6px colored dot + plain text label. Color is used only as a small
 * accent dot (never as a full filled background), keeping the dense data table
 * readable without the visual noise of colored badges on every row.
 *
 * The variant prop maps directly to the same PillVariant semantics already
 * produced by `projectStateVariant()` in @/lib/lifecycle, so callers need no
 * extra mapping — just swap <Pill variant={v}> for <ProjectStatusTag variant={v}>.
 */

import type { PillVariant } from '@/ui';

export interface ProjectStatusTagProps {
  variant: PillVariant;
  children: string;
}

export function ProjectStatusTag({ variant, children }: ProjectStatusTagProps) {
  return (
    <span className={`alm-status-tag alm-status-tag--${variant}`}>
      <span className="alm-status-tag__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
