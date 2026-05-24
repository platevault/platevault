import { memo } from 'react';
import { clsx } from 'clsx';

export interface CoverageChartProps {
  coverage: Record<string, number>;
  recommended: Record<string, number>;
}

/**
 * Horizontal bar chart showing filter coverage vs. recommended hours.
 * Pure CSS bars — no charting library needed.
 */
export const CoverageChart = memo(function CoverageChart({ coverage, recommended }: CoverageChartProps) {
  // Collect all filters from both maps
  const filters = Array.from(
    new Set([...Object.keys(recommended), ...Object.keys(coverage)]),
  );

  // Find the max value to normalise bar widths
  const maxHours = Math.max(
    ...filters.map((f) => Math.max(coverage[f] ?? 0, recommended[f] ?? 0)),
    1, // guard against all-zero
  );

  return (
    <div className="alm-coverage-chart" role="img" aria-label="Filter coverage chart">
      {filters.map((filter) => {
        const actual = coverage[filter] ?? 0;
        const target = recommended[filter] ?? 0;
        const belowRecommended = target > 0 && actual < target;
        const barPercent = Math.min((actual / maxHours) * 100, 100);

        return (
          <div key={filter} className="alm-coverage-chart__row">
            <span className="alm-coverage-chart__label">{filter}</span>
            <div className="alm-coverage-chart__track">
              <div
                className={clsx(
                  'alm-coverage-chart__bar',
                  belowRecommended && 'alm-coverage-chart__bar--below',
                )}
                style={{ width: `${barPercent}%` }}
                aria-valuenow={actual}
                aria-valuemax={target}
                role="meter"
                aria-label={`${filter}: ${actual.toFixed(1)}h of ${target.toFixed(1)}h recommended`}
              />
              {target > 0 && (
                <div
                  className="alm-coverage-chart__target-mark"
                  style={{ left: `${Math.min((target / maxHours) * 100, 100)}%` }}
                  title={`Recommended: ${target.toFixed(1)}h`}
                />
              )}
            </div>
            <span className="alm-coverage-chart__hours">
              {actual.toFixed(1)}h
            </span>
            {belowRecommended && (
              <span
                className="alm-coverage-chart__warning"
                title={`Below recommended (${target.toFixed(1)}h)`}
              >
                &#x26A0; Below recommended
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});
