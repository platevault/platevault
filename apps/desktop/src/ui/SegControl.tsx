// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

/** A segmented-control option: a stable `value` and a display `label`. */
export interface SegControlOption {
  value: string;
  label: string;
}

export interface SegControlProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: ReadonlyArray<SegControlOption>;
  value: string;
  onChange: (value: string) => void;
  danger?: boolean;
  /** Which option value receives the danger styling (only when `danger` is set). */
  dangerValue?: string;
}

export const SegControl = forwardRef<HTMLDivElement, SegControlProps>(
  function SegControl(
    { options, value, onChange, danger, dangerValue, className, ...rest },
    ref,
  ) {
    const cls = ['alm-seg', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        {options.map((o) => (
          <button
            key={o.value}
            className={[
              'alm-seg__btn',
              value === o.value && 'alm-seg__btn--active',
              danger &&
                dangerValue != null &&
                o.value === dangerValue &&
                'alm-seg__btn--danger',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  },
);
SegControl.displayName = 'SegControl';
