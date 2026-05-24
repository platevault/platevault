import { type ReactNode } from 'react';
import { Button } from '@base-ui-components/react/button';
import { clsx } from 'clsx';

export interface BtnProps {
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** Pass-through HTML attributes (e.g. data-tour for guided tour anchors). */
  [key: `data-${string}`]: string | undefined;
}

export function Btn({
  variant,
  size = 'md',
  active,
  disabled,
  onClick,
  children,
  ...rest
}: BtnProps) {
  return (
    <Button
      className={clsx(
        'alm-btn',
        variant && `alm-btn--${variant}`,
        size === 'sm' && 'alm-btn--sm',
        active && 'alm-btn--active',
      )}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Button>
  );
}
