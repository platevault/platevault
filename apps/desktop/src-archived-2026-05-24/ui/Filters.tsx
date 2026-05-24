import type { ReactNode } from "react";

export interface FiltersProps {
  children: ReactNode;
  right?: ReactNode;
}

/** Filter strip beneath a PageHeader. */
export function Filters({ children, right }: FiltersProps) {
  return (
    <div className="alm-page__filters">
      {children}
      <span className="alm-page__filters-spacer" />
      {right}
    </div>
  );
}

export interface FilterLabelProps {
  children: ReactNode;
}

export function FilterLabel({ children }: FilterLabelProps) {
  return <span style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)" }}>{children}</span>;
}
