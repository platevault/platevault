import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface CoverageBarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: number;
  max: number;
}

export const CoverageBar = forwardRef<HTMLDivElement, CoverageBarProps>(
  function CoverageBar({ label, value, max, className, ...rest }, ref) {
    const pct = Math.min(100, (value / max) * 100);
    const cls = pct < 40 ? '--low' : pct >= 80 ? '--ok' : '';
    const rootCls = ['alm-coverage', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={rootCls} {...rest}>
        <span className="alm-coverage__label">{label}</span>
        <div className="alm-coverage__bar">
          <div
            className={`alm-coverage__fill${cls ? ` alm-coverage__fill${cls}` : ''}`}
            // eslint-disable-next-line no-restricted-syntax -- dynamic: coverage bar fill width %
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* eslint-disable-next-line alm/no-user-string -- decorative: 'h' is a unit abbreviation, not translatable prose */}
        <span className="alm-coverage__value">{value}h</span>
      </div>
    );
  }
);
CoverageBar.displayName = 'CoverageBar';
