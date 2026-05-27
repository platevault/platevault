import type { ReactNode, ButtonHTMLAttributes } from 'react';

export type BtnVariant = 'primary' | 'accent' | 'danger' | 'ghost';
export type BtnSize = 'sm';
export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  children: ReactNode;
}

export function Btn({ variant, size, className, children, ...rest }: BtnProps) {
  const cls = [
    'alm-btn',
    variant && `alm-btn--${variant}`,
    size && `alm-btn--${size}`,
    className,
  ].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{children}</button>;
}
