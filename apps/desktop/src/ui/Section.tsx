// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  count?: string | number | null;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const Section = forwardRef<HTMLDivElement, SectionProps>(
  function Section(
    { title, count, right, defaultOpen = true, className, children, ...rest },
    ref,
  ) {
    const [open, setOpen] = useState(defaultOpen);
    const cls = ['pv-section', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        <div
          className="pv-section__header"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          <span className="pv-section__toggle">{open ? '▾' : '▸'}</span>
          <span className="pv-section__title">{title}</span>
          {count != null && (
            <span className="pv-section__count">({count})</span>
          )}
          {right && (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- wrapper only stops header-toggle bubbling; nested content carries its own interactivity
            <span
              className="pv-section__right"
              onClick={(e) => e.stopPropagation()}
            >
              {right}
            </span>
          )}
        </div>
        {open && children}
      </div>
    );
  },
);
Section.displayName = 'Section';
