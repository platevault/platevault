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
  function Section({ title, count, right, defaultOpen = true, className, children, ...rest }, ref) {
    const [open, setOpen] = useState(defaultOpen);
    const cls = ['alm-section', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        <div className="alm-section__header" onClick={() => setOpen(!open)}>
          <span className="alm-section__toggle">{open ? '▾' : '▸'}</span>
          <span className="alm-section__title">{title}</span>
          {count != null && <span className="alm-section__count">({count})</span>}
          {right && <span className="alm-section__right" onClick={e => e.stopPropagation()}>{right}</span>}
        </div>
        {open && children}
      </div>
    );
  }
);
Section.displayName = 'Section';
