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
    <div className="alm-action-bar">
      <span className="alm-action-bar__title">{title}</span>
      {subtitle && <span className="alm-action-bar__subtitle">{subtitle}</span>}
      {children}
      <span className="alm-action-bar__spacer" />
      {right && <div className="alm-action-bar__actions">{right}</div>}
    </div>
  );
}
