// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { HTMLAttributes } from 'react';
import { RadioGroup as BaseRadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';

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

export function RadioGroup({
  options,
  value,
  onChange,
  className,
  ...rest
}: RadioGroupProps) {
  const cls = ['pv-radio-group', className].filter(Boolean).join(' ');
  return (
    <BaseRadioGroup
      className={cls}
      value={value}
      onValueChange={(v) => onChange(v as string)}
      {...rest}
    >
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const desc = typeof o === 'string' ? null : o.desc;
        const testId = typeof o === 'string' ? undefined : o.testId;
        return (
          <Radio.Root
            key={val}
            value={val}
            className="pv-radio"
            data-testid={testId}
          >
            <div>{label}</div>
            {desc && <div className="pv-radio__desc">{desc}</div>}
          </Radio.Root>
        );
      })}
    </BaseRadioGroup>
  );
}
RadioGroup.displayName = 'RadioGroup';
