import type { ReactNode } from "react";
import { Button } from "./Button";

export interface BulkActionBarProps {
  count: number;
  countLabel?: (n: number) => string;
  actions: ReactNode;
  onClear: () => void;
  "aria-label"?: string;
}

/**
 * Sticky bottom bar shown when one or more rows are bulk-selected.
 * Renders count + actions + a ghost "Clear" button on the right.
 */
export function BulkActionBar({
  count,
  countLabel,
  actions,
  onClear,
  "aria-label": ariaLabel,
}: BulkActionBarProps) {
  const label = countLabel ? countLabel(count) : `${count} selected`;
  return (
    <div className="alm-bulkbar" role="region" aria-label={ariaLabel ?? "Bulk actions"}>
      <span className="alm-bulkbar__count">{label}</span>
      {actions}
      <span className="alm-bulkbar__spacer" />
      <Button variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
