import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';

export interface ToggleProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const Toggle = forwardRef<HTMLLabelElement, ToggleProps>(
  function Toggle({ checked, onChange, className, ...rest }, ref) {
    const cls = ['alm-toggle', className].filter(Boolean).join(' ');
    return (
      <label ref={ref} className={cls} {...rest}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="alm-toggle__track" />
        <span className="alm-toggle__thumb" />
      </label>
    );
  }
);
Toggle.displayName = 'Toggle';
