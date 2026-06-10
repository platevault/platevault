import type { ReactNode } from 'react';

export interface Metric {
  value: ReactNode;
  label: string;
}

export interface MetricLineProps {
  metrics: Metric[];
}

/**
 * The single standard summary-metrics row that sits directly under a
 * DetailHeader (design v4). Replaces the per-page `alm-detail__stats` and
 * boxed KV/coverage treatments with one consistent horizontal strip:
 * `<value> <label>` pairs, no bounding boxes.
 */
export function MetricLine({ metrics }: MetricLineProps) {
  return (
    <div className="alm-metricline">
      {metrics.map((m, i) => (
        <span className="alm-metricline__m" key={i}>
          <b>{m.value}</b>
          <span>{m.label}</span>
        </span>
      ))}
    </div>
  );
}
