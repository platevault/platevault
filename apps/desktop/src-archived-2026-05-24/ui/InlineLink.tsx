import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export interface InlineLinkProps {
  to: string;
  search?: Record<string, unknown>;
  params?: Record<string, string>;
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * Accent-colored inline link with `.alm-inline-link` styling.
 * Wraps TanStack Router `<Link>`. Always calls stopPropagation
 * on click to prevent row selection from firing.
 */
export function InlineLink({ to, search, params, children, onClick, className }: InlineLinkProps) {
  return (
    <Link
      to={to as never}
      search={search as never}
      params={params as never}
      className={["alm-inline-link", className].filter(Boolean).join(" ")}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );
}
