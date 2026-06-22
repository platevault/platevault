/**
 * planner-catalog.ts — Allowed-catalog filter for the Target Planner (task #40, spec 043 §4).
 *
 * The Planner must list ONLY catalog objects a user would realistically plan a
 * session around — Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell, Barnard —
 * NOT the ~13k SIMBAD double stars the raw `target.list` endpoint returns.
 *
 * STUB: this is a CLIENT-SIDE designation-prefix filter. The real fix is a
 * backend catalog filter on the list endpoint (task #57 — "Targets list-endpoint
 * enrichment"). Until that lands, we filter the full list in the browser by the
 * `primaryDesignation` prefix. This is a heuristic on the designation string,
 * not a catalog-membership lookup, so it can over- or under-match unusual
 * designations.
 */

import type { TargetListItem } from '@/api/commands';

/**
 * Allowed planner catalogs, keyed by the designation prefix that identifies
 * each. Matching is case-insensitive and anchored at the start of the
 * `primaryDesignation`, with the prefix followed by whitespace or a digit so
 * that e.g. "IC" does not also match "ICRS" and "B" (Barnard) does not match
 * arbitrary "B..." designations that are not "B <number>".
 */
export const PLANNER_CATALOGS = [
  { prefix: 'M', label: 'Messier' },
  { prefix: 'NGC', label: 'NGC' },
  { prefix: 'IC', label: 'IC' },
  { prefix: 'Sh2', label: 'Sharpless' },
  { prefix: 'LBN', label: 'LBN' },
  { prefix: 'LDN', label: 'LDN' },
  { prefix: 'C', label: 'Caldwell' },
  { prefix: 'B', label: 'Barnard' },
] as const;

/**
 * Build a single regex that matches an allowed-catalog designation.
 *
 * Each prefix must be followed by optional whitespace and then a digit (catalog
 * designations are "<prefix> <number>"), e.g. "M 31", "NGC 7000", "Sh2-155",
 * "C 14". The trailing `[\s-]?\d` guard prevents matching unrelated tokens that
 * merely start with the same letters (e.g. "Cygnus", "ICRS", "Barnard's Star"
 * spelled out).
 */
const PLANNER_DESIGNATION_RE = new RegExp(
  `^(?:${PLANNER_CATALOGS.map((c) => c.prefix).join('|')})[\\s-]?\\d`,
  'i',
);

/** True when the target's primary designation belongs to an allowed planner catalog. */
export function isPlannerCatalogTarget(t: TargetListItem): boolean {
  return PLANNER_DESIGNATION_RE.test(t.primaryDesignation.trim());
}

/**
 * STUB: client-side catalog filter. Returns only targets whose designation
 * belongs to an allowed planner catalog. Replace with a backend catalog filter
 * (task #57) once the list endpoint can filter server-side.
 */
export function filterPlannerCatalog(targets: TargetListItem[]): TargetListItem[] {
  return targets.filter(isPlannerCatalogTarget);
}
