import type { HTMLAttributes } from 'react';
import { Tooltip } from './Tooltip';
import { m } from '@/lib/i18n';

export interface LockProps extends HTMLAttributes<HTMLSpanElement> {
  reason?: string;
}

export function Lock({ reason, className, ...rest }: LockProps) {
  const label = reason ?? m.settings_cleanup_protection_protected();
  const cls = ['alm-lock', className].filter(Boolean).join(' ');
  return (
    <Tooltip content={label} className={cls} aria-label={label} {...rest}>
      &#x1F512;
    </Tooltip>
  );
}
