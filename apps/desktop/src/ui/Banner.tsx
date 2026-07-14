// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export type BannerVariant = 'warn' | 'danger' | 'info';
export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BannerVariant;
  children: ReactNode;
}

export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { variant = 'warn', className, children, ...rest },
  ref,
) {
  const cls = ['alm-banner', `alm-banner--${variant}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  );
});
Banner.displayName = 'Banner';
