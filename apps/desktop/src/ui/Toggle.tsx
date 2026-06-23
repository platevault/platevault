import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';

export interface ToggleProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const Toggle = forwardRef<HTMLLabelElement, ToggleProps>(
  function Toggle({ checked, onChange, className, ...rest }, ref) {
    const cls = ['alm-toggle', className].filter(Boolean).join(' ');
    // Route any accessible-name props onto the actual checkbox so screen
    // readers announce the switch; the rest stay on the wrapping label.
    const { 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, ...labelRest } = rest;
    return (
       
      <label ref={ref} className={cls} {...labelRest}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
        />
        <span className="alm-toggle__track" />
        <span className="alm-toggle__thumb" />
      </label>
    );
  }
);
Toggle.displayName = 'Toggle';
