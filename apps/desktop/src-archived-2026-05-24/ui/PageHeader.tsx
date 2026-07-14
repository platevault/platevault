// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="alm-page__head">
      <div className="alm-page__title">
        <h1>{title}</h1>
        {subtitle ? <span className="alm-page__subtitle">{subtitle}</span> : null}
      </div>
      {actions ? <div className="alm-page__actions">{actions}</div> : null}
    </div>
  );
}
