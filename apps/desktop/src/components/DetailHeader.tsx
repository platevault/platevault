// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

export interface DetailHeaderProps {
  title: ReactNode;
  titleExtra?: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function DetailHeader({
  title,
  titleExtra,
  subtitle,
  actions,
  children,
}: DetailHeaderProps) {
  return (
    <div className="alm-detail__header">
      <div className="alm-detail__header-content">
        <div className="alm-detail__title">
          {title}
          {titleExtra}
        </div>
        {subtitle && <div className="alm-detail__subtitle">{subtitle}</div>}
        {children}
      </div>
      {actions && <div className="alm-detail__actions">{actions}</div>}
    </div>
  );
}
