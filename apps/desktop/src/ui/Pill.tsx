import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export type PillVariant = 'neutral' | 'ghost' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';
export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  children: ReactNode;
}

export const Pill = forwardRef<HTMLSpanElement, PillProps>(
  function Pill({ variant = 'neutral', className, children, ...rest }, ref) {
    const cls = ['alm-pill', `alm-pill--${variant}`, className].filter(Boolean).join(' ');
    return <span ref={ref} className={cls} {...rest}>{children}</span>;
  }
);
Pill.displayName = 'Pill';
