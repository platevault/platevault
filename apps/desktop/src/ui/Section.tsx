import { useState, type ReactNode } from 'react';

export interface SectionProps {
  title: string;
  count?: string | number | null;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Section({ title, count, right, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="alm-section">
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
