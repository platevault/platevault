import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx("alm-badge", className)}
      data-tone={tone === "neutral" ? undefined : tone}
      {...rest}
    >
      {children}
    </span>
  );
}
