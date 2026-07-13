import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface CoverageBarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: number;
  max: number;
  /**
   * Unit suffix appended to the value label. Defaults to `'h'` (hours) for
   * backward compatibility. Ignored when `formatLabel` is supplied.
   */
  unit?: string;
  /** Full control over the value label; overrides `unit`. */
  formatLabel?: (value: number, max: number) => string;
}

export const CoverageBar = forwardRef<HTMLDivElement, CoverageBarProps>(
  function CoverageBar(
    { label, value, max, unit = 'h', formatLabel, className, ...rest },
    ref,
  ) {
    const pct = Math.min(100, (value / max) * 100);
    const cls = pct < 40 ? '--low' : pct >= 80 ? '--ok' : '';
    const rootCls = ['alm-coverage', className].filter(Boolean).join(' ');
    const valueLabel = formatLabel
      ? formatLabel(value, max)
      : `${value}${unit}`;
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
        <span className="alm-coverage__value">{valueLabel}</span>
      </div>
    );
  },
);
CoverageBar.displayName = 'CoverageBar';
