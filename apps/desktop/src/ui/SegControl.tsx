// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef, useCallback } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

/** A segmented-control option: a stable `value` and a display `label`. */
export interface SegControlOption {
  value: string;
  label: string;
  /**
   * When set, rendered instead of the `label` text (icon-only button).
   * `label` still supplies the button's accessible name (`aria-label`) and
   * hover tooltip so the option stays screen-reader- and hover-discoverable
   * without visible text (#1068).
   */
  icon?: ReactNode;
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
    const cls = ['pv-seg', className].filter(Boolean).join(' ');

    // WAI-ARIA radio-group pattern (#1010): Left/Up selects the previous
    // option, Right/Down the next, wrapping at the ends. Moves both focus
    // and selection together, matching how native radio inputs behave.
    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLButtonElement>) => {
        const currentIndex = options.findIndex((o) => o.value === value);
        let nextIndex: number | null = null;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          nextIndex = (currentIndex - 1 + options.length) % options.length;
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % options.length;
        }
        if (nextIndex == null) return;
        e.preventDefault();
        onChange(options[nextIndex].value);
      },
      [options, value, onChange],
    );

    return (
      <div ref={ref} className={cls} role="radiogroup" {...rest}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className={[
                'pv-seg__btn',
                active && 'pv-seg__btn--active',
                danger &&
                  dangerValue != null &&
                  o.value === dangerValue &&
                  'pv-seg__btn--danger',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onChange(o.value)}
              onKeyDown={handleKeyDown}
              aria-label={o.icon ? o.label : undefined}
              title={o.label}
            >
              {o.icon ?? o.label}
            </button>
          );
        })}
      </div>
    );
  },
);
SegControl.displayName = 'SegControl';
