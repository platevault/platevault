import type { ReactNode } from "react";

export type ChipTone =
  | "neutral"
  | "success"
  | "warn"
  | "danger"
  | "accent"
  | "info"
  | "archival";

export interface ChipProps {
  tone?: ChipTone;
  active?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  /** aria-pressed is set automatically when onClick is provided */
  "aria-pressed"?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Generic pill chip with a leading dot.
 * When `onClick` is provided it renders as a button; otherwise as a span.
 */
export function Chip({
  tone = "neutral",
  active,
  onClick,
  children,
  "aria-pressed": ariaPressedProp,
  "aria-label": ariaLabel,
  className,
}: ChipProps) {
  const ariaPressed = ariaPressedProp ?? (onClick ? active : undefined);
  const dataActive = active ? "true" : undefined;
  const shared = {
    className: ["alm-statechip", className].filter(Boolean).join(" "),
    "data-active": dataActive,
    "data-tone": tone,
  } as const;

  if (onClick) {
    return (
      <button
        type="button"
        {...shared}
        onClick={onClick}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  return (
    <span {...shared} aria-label={ariaLabel}>
      {children}
    </span>
  );
}

export interface ChipGroupProps {
  children: ReactNode;
  "aria-label": string;
  className?: string;
  wrap?: boolean;
}

/**
 * Row/group of Chip components.
 */
export function ChipGroup({
  children,
  "aria-label": ariaLabel,
  className,
  wrap,
}: ChipGroupProps) {
  return (
    <div
      className={["alm-statechips", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
      style={wrap ? { flexWrap: "wrap" } : undefined}
    >
      {children}
    </div>
  );
}
