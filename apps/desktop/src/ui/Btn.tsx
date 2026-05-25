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
  /** Optional inline style override. */
  style?: React.CSSProperties;
  /** Optional extra class name. */
  className?: string;
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
  style: inlineStyle,
  className: extraClassName,
  ...rest
}: BtnProps) {
  return (
    <Button
      className={clsx(
        'alm-btn',
        variant && `alm-btn--${variant}`,
        size === 'sm' && 'alm-btn--sm',
        active && 'alm-btn--active',
        extraClassName,
      )}
      disabled={disabled}
      onClick={onClick}
      style={inlineStyle}
      {...rest}
    >
      {children}
    </Button>
  );
}
