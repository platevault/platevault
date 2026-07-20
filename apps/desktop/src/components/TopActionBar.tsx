// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

export interface TopActionBarProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}

export function TopActionBar({
  title,
  subtitle,
  right,
  children,
}: TopActionBarProps) {
  return (
    <div className="pv-action-bar">
      <span className="pv-action-bar__title">{title}</span>
      {subtitle && <span className="pv-action-bar__subtitle">{subtitle}</span>}
      {children}
      <span className="pv-action-bar__spacer" />
      {right && <div className="pv-action-bar__actions">{right}</div>}
    </div>
  );
}
