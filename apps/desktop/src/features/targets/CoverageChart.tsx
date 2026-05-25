import { memo } from 'react';

export interface CoverageChartProps {
  coverage: Record<string, number>;
  recommended: Record<string, number>;
}

/**
 * Horizontal bar chart showing filter coverage hours.
 * Matches wireframe: simple bars with filter label, track, hours value.
 * Pure CSS -- no charting library needed.
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
        const barPercent = maxHours > 0 ? Math.min((actual / maxHours) * 100, 100) : 0;

        return (
          <div key={filter} className="alm-coverage-chart__row">
            <span className="alm-coverage-chart__label">{filter}</span>
            <span className="alm-coverage-chart__track">
              <span
                className="alm-coverage-chart__bar"
                style={{ width: `${barPercent}%` }}
                role="meter"
                aria-valuenow={actual}
                aria-valuemax={target || actual}
                aria-label={`${filter}: ${actual.toFixed(1)}h${target ? ` of ${target.toFixed(1)}h recommended` : ''}`}
              />
            </span>
            <span className="alm-coverage-chart__hours">{actual.toFixed(1)}h</span>
          </div>
        );
      })}
    </div>
  );
});
