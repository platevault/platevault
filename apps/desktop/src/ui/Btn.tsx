import { forwardRef } from 'react';
import type { ReactNode, ButtonHTMLAttributes } from 'react';

export type BtnVariant = 'primary' | 'accent' | 'danger' | 'ghost';
export type BtnSize = 'sm' | 'md';
export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  children: ReactNode;
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(
  // Omitting `variant` yields the base `.alm-btn`; `md` is the base size and
  // emits no modifier so callers passing no size render exactly as before.
  function Btn({ variant, size = 'md', className, children, ...rest }, ref) {
    const cls = [
      'alm-btn',
      variant && `alm-btn--${variant}`,
      size !== 'md' && `alm-btn--${size}`,
      className,
    ].filter(Boolean).join(' ');
    return <button ref={ref} className={cls} {...rest}>{children}</button>;
  }
);
Btn.displayName = 'Btn';
