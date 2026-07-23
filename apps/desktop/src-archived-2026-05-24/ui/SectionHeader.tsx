// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export interface SectionHeaderProps {
  children: ReactNode;
  /** Extra spacing on top (default 0). Accepts a CSS var string. */
  marginTop?: string;
}

/**
 * Uppercase tracking-wide micro section title.
 * Used in drawers, settings, plan inline summary.
 */
export function SectionHeader({ children, marginTop }: SectionHeaderProps) {
  return (
    <div
      className="alm-fact-group__label"
      style={marginTop ? { marginTop } : undefined}
    >
      {children}
    </div>
  );
}
