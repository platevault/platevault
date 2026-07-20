// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

export interface ListItemProps {
  selected?: boolean;
  onClick?: () => void;
  title: ReactNode;
  pills?: ReactNode;
  meta?: ReactNode;
}

export function ListItem({
  selected,
  onClick,
  title,
  pills,
  meta,
}: ListItemProps) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- interactivity is conditional; role becomes button and a keydown handler is attached only when onClick is provided
    <div
      className={`pv-list-item ${selected ? 'pv-list-item--selected' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- only focusable when onClick is provided, where role becomes button
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? Boolean(selected) : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="pv-list-item__title">
        {title}
        {pills}
      </div>
      {meta && <div className="pv-list-item__meta">{meta}</div>}
    </div>
  );
}
