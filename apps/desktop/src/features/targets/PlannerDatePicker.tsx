// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PlannerDatePicker — the Planner's "plan a different night" control (spec 044
 * US2, T024, FR-008). A single `<input type="date">` bound to the non-persisted
 * `planner-date-store.ts`; a "Tonight" reset button appears once the user has
 * chosen a date other than tonight. Every planner astronomy computation
 * (`rowAltitudeFor`/`altitudeFor`) reads the resolved date from that store, so
 * changing it here recomputes the whole table/detail pane (SC-004).
 */

import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import {
  setPlannerDateMs,
  useIsPlannerDateOverridden,
  usePlannerDateMs,
} from './planner-date-store';

/** Format an epoch-ms instant as the `YYYY-MM-DD` the browser's date input expects. */
function toDateInputValue(dateMs: number): string {
  const d = new Date(dateMs);
  const y = d.getFullYear();
  const m2 = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m2}-${day}`;
}

/** Parse a `YYYY-MM-DD` date-input value to local noon epoch ms (avoids DST-boundary ambiguity at midnight). */
function fromDateInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0).getTime();
}

export function PlannerDatePicker() {
  const dateMs = usePlannerDateMs();
  const overridden = useIsPlannerDateOverridden();

  return (
    <div className="pv-planner-date-picker" data-testid="planner-date-picker">
      <label className="pv-field-label" htmlFor="planner-date-input">
        {m.targets_planner_date_label()}
      </label>
      <input
        id="planner-date-input"
        type="date"
        className="pv-input"
        value={toDateInputValue(dateMs)}
        aria-label={m.targets_planner_date_label()}
        onChange={(e) => {
          const parsed = fromDateInputValue(e.target.value);
          if (parsed !== null) setPlannerDateMs(parsed);
        }}
      />
      {overridden && (
        <Btn
          size="sm"
          onClick={() => setPlannerDateMs(null)}
          aria-label={m.targets_planner_date_reset()}
        >
          {m.targets_planner_date_reset()}
        </Btn>
      )}
    </div>
  );
}
