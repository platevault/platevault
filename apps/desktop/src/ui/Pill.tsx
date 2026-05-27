import type { ReactNode } from 'react';

export type PillVariant = 'neutral' | 'ghost' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';
export interface PillProps {
  variant?: PillVariant;
  children: ReactNode;
}

export function Pill({ variant = 'neutral', children }: PillProps) {
  return <span className={`alm-pill alm-pill--${variant}`}>{children}</span>;
}
