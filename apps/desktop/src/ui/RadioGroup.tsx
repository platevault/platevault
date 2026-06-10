import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface RadioOption {
  value: string;
  label: string;
  desc?: string;
}
export interface RadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: (string | RadioOption)[];
  value: string;
  onChange: (value: string) => void;
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup({ options, value, onChange, className, ...rest }, ref) {
    const cls = ['alm-radio-group', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        {options.map(o => {
          const val = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          const desc = typeof o === 'string' ? null : o.desc;
          return (
            <button
              key={val}
              className={`alm-radio ${value === val ? 'alm-radio--active' : ''}`}
              onClick={() => onChange(val)}
            >
              <div>{label}</div>
              {desc && <div className="alm-radio__desc">{desc}</div>}
            </button>
          );
        })}
      </div>
    );
  }
);
RadioGroup.displayName = 'RadioGroup';
