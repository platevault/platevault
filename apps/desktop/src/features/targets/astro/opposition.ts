/**
 * opposition.ts — next opposition-like (midnight-culmination) date (spec 047,
 * plan D6, FR-014).
 *
 * For a fixed-RA target, "opposition" is approximated as the date the Sun's
 * apparent geocentric right ascension equals `targetRaDeg − 180°` (i.e. the
 * Sun sits opposite the target on the sky, so the target culminates near
 * local midnight). No observer coordinates are used — only the target's
 * catalogued RA and the Sun's date-dependent position — so this is pure
 * Track A (date/time + catalogued coordinates only).
 *
 * Method: a coarse daily scan of the Sun's geocentric equatorial RA
 * (`GeoVector(Body.Sun, …)`, same EQJ frame as the Moon/target vectors used
 * elsewhere in this module) across up to 366 days from the search start,
 * picking the day with the smallest circular RA difference from the target's
 * anti-solar RA. One-day resolution is well inside the ±7-day tolerance
 * (SC-003); the Sun's RA advances roughly 1°/day, and closest-day-of-366 is a
 * sufficient index into that slow drift. Null coordinates return `null`
 * (explicit unknown), never a fabricated date.
 *
 * Performance (SC-007, plan §6 memoization rule): the Sun's daily RA sequence
 * is the SAME for every target on a given night — it does not depend on the
 * target's coordinates. Recomputing it per row (as an earlier version of this
 * module did) cost ~1.2 ms/row × 5,000 rows ≈ 6 s, an unacceptable stall.
 * `sunRaTable` computes the 367-day sequence ONCE per distinct `from` instant
 * (memoized on the last-seen value — every row in one table render shares the
 * identical `from`, so a single-entry cache is sufficient) and `nextOpposition`
 * reuses it; the remaining per-row work is a cheap O(367) numeric scan.
 */

import { Body, GeoVector } from 'astronomy-engine';
import type { Vec3 } from './moon-state';

const MS_PER_DAY = 86_400_000;
/** Scan window: a touch over one synodic year of RA drift (plan D6: ≤ 366 days). */
const SCAN_DAYS = 366;

/** Right ascension (0…360°) of an EQJ vector, via atan2(y, x). */
function raDegFromVec(v: Vec3): number {
  const a = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** Signed circular difference `a − b` normalised to (−180°, 180°]. */
function circularDiffDeg(a: number, b: number): number {
  return ((((a - b + 540) % 360) + 360) % 360) - 180;
}

// ── Memoized Sun-RA table (SC-007) ──────────────────────────────────────────

let cachedFromMs: number | null = null;
let cachedSunRaTable: number[] | null = null;

/**
 * The Sun's geocentric RA (degrees) for each day offset `0…SCAN_DAYS` from
 * `from`, memoized on the last-seen `from` instant. Every row in one
 * `TargetsTable` render shares the identical `from` (the observing-night
 * midnight), so this single-entry cache turns 5,000 rows × 367
 * `GeoVector` calls into 367 total calls per night.
 */
function sunRaTable(from: Date): number[] {
  const fromMs = from.getTime();
  if (cachedFromMs === fromMs && cachedSunRaTable) return cachedSunRaTable;

  const table = new Array<number>(SCAN_DAYS + 1);
  for (let day = 0; day <= SCAN_DAYS; day++) {
    const at = new Date(fromMs + day * MS_PER_DAY);
    table[day] = raDegFromVec(GeoVector(Body.Sun, at, true));
  }
  cachedFromMs = fromMs;
  cachedSunRaTable = table;
  return table;
}

/** Test-only: clear the Sun-RA table cache (avoid cross-test leakage). */
export function __resetOppositionCacheForTest(): void {
  cachedFromMs = null;
  cachedSunRaTable = null;
}

/** Result of a next-opposition search. */
export interface OppositionResult {
  /** The date (whole-day resolution) of the next opposition-like culmination. */
  date: Date;
  /** Whole days from `from` to `date` (≥ 0). */
  daysUntil: number;
}

/**
 * Find the next date a target at `raDeg` culminates near local midnight
 * (Sun's RA opposite the target's RA), searching forward from `from`.
 *
 * @param raDeg - Target J2000 right ascension in degrees, or `null`/`undefined`
 *   for unknown coordinates (returns `null`).
 * @param from - Search start instant (typically tonight's observing-night
 *   midnight anchor). Reuses the memoized Sun-RA table for this instant
 *   (SC-007) — pass the SAME `Date` instance/value across a batch of rows.
 * @returns The best (closest-match) date within the scan window, or `null`
 *   when coordinates are unknown.
 */
export function nextOpposition(
  raDeg: number | null | undefined,
  from: Date,
): OppositionResult | null {
  if (raDeg == null || !Number.isFinite(raDeg)) return null;

  const targetOppositionRaDeg = (((raDeg - 180) % 360) + 360) % 360;
  const table = sunRaTable(from);

  let bestDay = 0;
  let bestAbsDiff = Infinity;
  for (let day = 0; day < table.length; day++) {
    const absDiff = Math.abs(
      circularDiffDeg(table[day], targetOppositionRaDeg),
    );
    if (absDiff < bestAbsDiff) {
      bestAbsDiff = absDiff;
      bestDay = day;
    }
  }

  return {
    date: new Date(from.getTime() + bestDay * MS_PER_DAY),
    daysUntil: bestDay,
  };
}

/** The explicit unknown opposition result (no coordinates). */
export const UNKNOWN_OPPOSITION: OppositionResult | null = null;

/** Date-level display month + day (e.g. "Dec 17"), locale-aware. */
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC', // dates from nextOpposition are whole-day UTC instants
});

/** Format the opposition date at date-level precision (e.g. "Dec 17"). */
export function formatOppositionDate(date: Date): string {
  return SHORT_DATE_FORMAT.format(date);
}

/** Days-per-month approximation for the relative "in N months" qualifier. */
const DAYS_PER_MONTH = 30.44;
/** Below this many days, the relative qualifier shows days rather than months. */
const DAYS_MONTHS_BOUNDARY = 60;

/** The relative qualifier form + rounded count for a days-until value. */
export interface OppositionRelative {
  unit: 'days' | 'months';
  count: number;
}

/**
 * Choose the relative "in N days"/"in N months" qualifier for a days-until
 * value (plan D6 / T022): short horizons read as days, longer ones as months.
 */
export function oppositionRelative(daysUntil: number): OppositionRelative {
  if (daysUntil < DAYS_MONTHS_BOUNDARY) {
    return { unit: 'days', count: Math.round(daysUntil) };
  }
  return {
    unit: 'months',
    count: Math.max(1, Math.round(daysUntil / DAYS_PER_MONTH)),
  };
}
