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
        <div
          className="alm-section__header"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          <span className="alm-section__toggle">{open ? '▾' : '▸'}</span>
          <span className="alm-section__title">{title}</span>
          {count != null && <span className="alm-section__count">({count})</span>}
          {right && (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- wrapper only stops header-toggle bubbling; nested content carries its own interactivity
            <span className="alm-section__right" onClick={e => e.stopPropagation()}>{right}</span>
          )}
        </div>
        {open && children}
      </div>
    );
  }
);
Section.displayName = 'Section';
