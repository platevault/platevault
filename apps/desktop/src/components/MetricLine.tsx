// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
 * DetailHeader (design v4). Replaces the per-page `pv-detail__stats` and
 * boxed KV/coverage treatments with one consistent horizontal strip:
 * `<value> <label>` pairs, no bounding boxes.
 */
export function MetricLine({ metrics }: MetricLineProps) {
  return (
    <div className="pv-metricline">
      {metrics.map((m, i) => (
        <span className="pv-metricline__m" key={i}>
          <b>{m.value}</b>
          <span>{m.label}</span>
        </span>
      ))}
    </div>
  );
}
