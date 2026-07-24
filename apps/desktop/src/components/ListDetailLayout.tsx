// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

export interface ListDetailLayoutProps {
  topBar?: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  sidebar?: ReactNode;
}

export function ListDetailLayout({
  topBar,
  list,
  detail,
  sidebar,
}: ListDetailLayoutProps) {
  if (sidebar) {
    return (
      <>
        {topBar && (
          <div className="pv-page__bar" data-testid="page-bar">
            {topBar}
          </div>
        )}
        <div className="pv-three-pane">
          {list}
          <div className="pv-three-pane__content">{detail}</div>
          <div className="pv-three-pane__sidebar">{sidebar}</div>
        </div>
      </>
    );
  }
  return (
    <>
      {topBar && (
        <div className="pv-page__bar" data-testid="page-bar">
          {topBar}
        </div>
      )}
      <div className="pv-two-pane">
        {list}
        <div className="pv-two-pane__detail" data-testid="two-pane-detail">
          {detail}
        </div>
      </div>
    </>
  );
}
