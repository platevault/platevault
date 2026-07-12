import { describe, it, expect } from 'vitest';
import {
  nextOpposition,
  formatOppositionDate,
  oppositionRelative,
  __resetOppositionCacheForTest,
} from './opposition';

/**
 * Seasonal anchor fixtures (spec 047 T021, SC-003 ±7 days). Reference dates
 * were independently derived by scanning the Sun's geocentric RA (the same
 * astronomy-engine primitive the module uses) from `FROM` and confirmed
 * against the spec's stated seasonal anchors: Orion-region targets culminate
 * near midnight in December, Sagittarius-region targets in June/July.
 */
const FROM = new Date('2026-01-01T00:00:00Z');

const FIXTURES: Array<{ name: string; raDeg: number; expectedIso: string }> = [
  { name: 'M31 (Andromeda, autumn)', raDeg: 10.685, expectedIso: '2026-10-05' },
  {
    name: 'M42 (Orion Nebula, December)',
    raDeg: 83.822,
    expectedIso: '2026-12-17',
  },
  {
    name: 'M45 (Pleiades, late autumn)',
    raDeg: 56.75,
    expectedIso: '2026-11-22',
  },
  {
    name: 'M13 (Hercules cluster, June)',
    raDeg: 250.423,
    expectedIso: '2026-06-03',
  },
  {
    name: 'M8 (Lagoon Nebula, June/July)',
    raDeg: 270.9,
    expectedIso: '2026-06-23',
  },
];

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

describe('nextOpposition — seasonal anchors (SC-003, ±7 days)', () => {
  for (const { name, raDeg, expectedIso } of FIXTURES) {
    it(`${name} within ±7 days of the reference date`, () => {
      const result = nextOpposition(raDeg, FROM);
      expect(result).not.toBeNull();
      const expected = new Date(`${expectedIso}T00:00:00Z`);
      expect(daysBetween(result!.date, expected)).toBeLessThanOrEqual(7);
      expect(result!.daysUntil).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('nextOpposition — wrap-around year boundary', () => {
  it('finds next year’s occurrence when searching from just before it', () => {
    // From Dec 20 2026, M42’s opposition (~Dec 17) has just passed for 2026;
    // the next occurrence is ~Dec 2027, inside the 366-day scan window.
    const from = new Date('2026-12-20T00:00:00Z');
    const result = nextOpposition(83.822, from);
    expect(result).not.toBeNull();
    expect(result!.date.getUTCFullYear()).toBe(2027);
    expect(result!.daysUntil).toBeGreaterThan(300);
    expect(result!.daysUntil).toBeLessThanOrEqual(366);
  });
});

describe('nextOpposition — null coordinates', () => {
  it('returns null for null/undefined/NaN RA', () => {
    expect(nextOpposition(null, FROM)).toBeNull();
    expect(nextOpposition(undefined, FROM)).toBeNull();
    expect(nextOpposition(Number.NaN, FROM)).toBeNull();
  });
});

describe('nextOpposition — Sun-RA table memoization (SC-007 perf)', () => {
  it('computes 5,000 rows sharing one `from` well under a 500 ms budget', () => {
    __resetOppositionCacheForTest();
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      const raDeg = (i * 0.073) % 360; // spread across the sky
      nextOpposition(raDeg, FROM);
    }
    const elapsedMs = performance.now() - start;
    // Un-memoized (one Sun GeoVector scan PER ROW) took ~6 s for 5,000 rows in
    // a standalone benchmark; the memoized Sun-RA table keeps this well under
    // a visible-stall budget (SC-007: "sorting completes without visible stall").
    expect(elapsedMs).toBeLessThan(500);
  });

  it('a different `from` invalidates the single-entry cache and still returns correct results', () => {
    __resetOppositionCacheForTest();
    // Start the search just AFTER M42's ~Dec 17 2026 opposition so the next
    // occurrence must be found in ~2027 — proves the second call recomputed
    // the Sun-RA table for the new `from` rather than reusing FROM's cached one.
    const afterOpposition = new Date('2026-12-20T00:00:00Z');
    const a = nextOpposition(83.822, FROM);
    const b = nextOpposition(83.822, afterOpposition);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.date.getUTCFullYear()).toBe(2027);
    expect(b!.daysUntil).toBeGreaterThan(300);
  });
});

describe('formatOppositionDate', () => {
  it('formats a date at month + day precision', () => {
    expect(formatOppositionDate(new Date('2026-12-17T00:00:00Z'))).toMatch(
      /Dec/,
    );
    expect(formatOppositionDate(new Date('2026-12-17T00:00:00Z'))).toMatch(
      /17/,
    );
  });
});

describe('oppositionRelative', () => {
  it('uses days below the days/months boundary', () => {
    expect(oppositionRelative(0)).toEqual({ unit: 'days', count: 0 });
    expect(oppositionRelative(5)).toEqual({ unit: 'days', count: 5 });
    expect(oppositionRelative(59)).toEqual({ unit: 'days', count: 59 });
  });

  it('uses months at/above the boundary, rounded, never zero', () => {
    expect(oppositionRelative(60).unit).toBe('months');
    expect(oppositionRelative(60).count).toBeGreaterThanOrEqual(1);
    expect(oppositionRelative(366).unit).toBe('months');
  });
});
