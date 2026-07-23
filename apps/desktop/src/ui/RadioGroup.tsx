// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface RadioOption {
  value: string;
  label: string;
  desc?: string;
  /** Stable automation hook — omit for options a real-UI journey never needs to select individually. */
  testId?: string;
}
export interface RadioGroupProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: (string | RadioOption)[];
  value: string;
  onChange: (value: string) => void;
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup({ options, value, onChange, className, ...rest }, ref) {
    const cls = ['pv-radio-group', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        {options.map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          const desc = typeof o === 'string' ? null : o.desc;
          const testId = typeof o === 'string' ? undefined : o.testId;
          return (
            <button
              key={val}
              className={`pv-radio ${value === val ? 'pv-radio--active' : ''}`}
              onClick={() => onChange(val)}
              data-testid={testId}
            >
              <div>{label}</div>
              {desc && <div className="pv-radio__desc">{desc}</div>}
            </button>
          );
        })}
      </div>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';
