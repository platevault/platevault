import { clsx } from 'clsx';

export interface PillProps {
  label: string;
  variant?: 'neutral' | 'ghost' | 'ok' | 'warn' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Pill({ label, variant = 'neutral', size = 'md' }: PillProps) {
  return (
    <span
      className={clsx(
        'alm-pill',
        `alm-pill--${variant}`,
        size === 'sm' && 'alm-pill--sm',
      )}
    >
      {label}
    </span>
  );
}
