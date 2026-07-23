// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  variant?: "default" | "bordered";
  active?: boolean;
  /** ARIA-required label since icon buttons have no text */
  "aria-label": string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ size = "md", variant = "default", active, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={clsx("alm-iconbtn", className)}
        data-size={size === "md" ? undefined : size}
        data-variant={variant === "default" ? undefined : variant}
        data-active={active ? "true" : undefined}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
