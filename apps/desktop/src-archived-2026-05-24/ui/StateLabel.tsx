import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export type StateTone =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "accent";

export interface StateLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StateTone;
  children: ReactNode;
}

/**
 * Plain-text state indicator with a small colored dot.
 * Honors spec 002: state labels stay plain text in rows; the dot is a quiet
 * semantic hint, not decorative chrome.
 */
export function StateLabel({ tone = "neutral", className, children, ...rest }: StateLabelProps) {
  return (
    <span className={clsx("alm-state", className)} data-tone={tone} {...rest}>
      <span className="alm-state__dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
