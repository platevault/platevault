import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface SegControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  danger?: boolean;
}

export const SegControl = forwardRef<HTMLDivElement, SegControlProps>(
  function SegControl({ options, value, onChange, danger, className, ...rest }, ref) {
    const cls = ['alm-seg', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        {options.map(o => (
          <button
            key={o}
            className={[
              'alm-seg__btn',
              value === o && 'alm-seg__btn--active',
              danger && o === 'Delete' && 'alm-seg__btn--danger',
            ].filter(Boolean).join(' ')}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
);
SegControl.displayName = 'SegControl';
