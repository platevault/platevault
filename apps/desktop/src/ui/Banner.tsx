import type { ReactNode, CSSProperties } from 'react';

export type BannerVariant = 'warn' | 'danger' | 'info';
export interface BannerProps {
  variant?: BannerVariant;
  style?: CSSProperties;
  children: ReactNode;
}

export function Banner({ variant = 'warn', style, children }: BannerProps) {
  return <div className={`alm-banner alm-banner--${variant}`} style={style}>{children}</div>;
}
