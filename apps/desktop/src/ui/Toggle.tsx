// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';

export interface ToggleProps
  extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const Toggle = forwardRef<HTMLLabelElement, ToggleProps>(function Toggle(
  { checked, onChange, className, disabled = false, ...rest },
  ref,
) {
  const cls = ['pv-toggle', disabled && 'pv-toggle--disabled', className]
    .filter(Boolean)
    .join(' ');
  // Route any accessible-name props onto the actual checkbox so screen
  // readers announce the switch; the rest stay on the wrapping label.
  const {
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    ...labelRest
  } = rest;
  return (
    <label ref={ref} className={cls} data-testid="toggle" {...labelRest}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
      />
      <span className="pv-toggle__track" />
      <span className="pv-toggle__thumb" />
    </label>
  );
});
Toggle.displayName = 'Toggle';
