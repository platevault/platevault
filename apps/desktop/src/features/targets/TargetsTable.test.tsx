// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsTable tests — virtualized planner table + planning columns
 * (tasks #84/#85, spec-043 redesign, spec 044 mock columns).
 *
 * Under jsdom there is no layout, so the virtualizer reports zero height and the
 * table falls back to rendering every row (the page/tests rely on all rows being
 * present; windowing is a runtime-only perf optimization). These tests assert:
 *  - the planning columns replaced Constellation/Magnitude (Max alt ·
 *    Sessions kept; Designation + Type kept); the sparkline and
 *    visible-tonight columns are REMOVED (iteration 2026-07-15, FR-007);
 *  - spec 044 columns present: Lunar dist, Filters, Imaging time;
 *  - rows render inside a real <table> with group headers preserved;
 *  - selecting a row fires onSelect;
 *  - sort headers call onSort for all sortable columns;
 *  - usableAltDeg prop changes affect imaging-time tooltip text;
 *  - zero imaging time carries a reason glyph (FR-030);
 *  - filter badges render broadband and/or narrowband bands.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TargetListItem } from '@/bindings/index';

// The no-site banner (spec 044 US3) links to Settings via `Link`, which needs
// a router context this test doesn't provide. Stub it as a plain anchor —
// consistent with TargetDetailV2.test.tsx's `@tanstack/react-router` mock.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: import('react').ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import {
  TargetsTable,
  DEFAULT_TARGET_SORT,
  __testExports,
} from './TargetsTable';
import { __setObservingStateForTest } from './observing-sites/site-store';
import type { ObserverSite } from './observing-sites/observer-site';
import type { ObservingNight } from './astro/moon-state';
import { DEFAULT_MOON_AVOIDANCE } from './astro/moon-avoidance';
import { m } from '@/lib/i18n';

function item(
  primaryDesignation: string,
  objectType = 'other',
): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: primaryDesignation,
    primaryDesignation,
    objectType,
    raDeg: 0,
    decDeg: 0,
    aliases: [],
  };
}

const TARGETS: TargetListItem[] = [
  item('NGC 7000', 'emission_nebula'),
  item('M 31', 'galaxy'),
];

function renderTable(
  overrides: Partial<React.ComponentProps<typeof TargetsTable>> = {},
) {
  const onSelect = vi.fn();
  const onSort = vi.fn();
  render(
    <TargetsTable
      targets={TARGETS}
      selected={null}
      onSelect={onSelect}
      sort={DEFAULT_TARGET_SORT}
      onSort={onSort}
      {...overrides}
    />,
  );
  return { onSelect, onSort };
}

describe('TargetsTable (#84/#85)', () => {
  it('renders the planning columns and drops Constellation/Magnitude', () => {
    renderTable();
    expect(screen.getByText('Max alt')).toBeInTheDocument();
    // Iteration 2026-07-15 (FR-007): sparkline + visible columns removed.
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument();
    expect(screen.queryByText('Visible')).not.toBeInTheDocument();
    expect(screen.getByText('Opposition')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Designation')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.queryByText('Constellation')).not.toBeInTheDocument();
    expect(screen.queryByText('Magnitude')).not.toBeInTheDocument();
  });

  it('renders the spec 044 mock columns: Lunar dist, Filters, Imaging time', () => {
    renderTable();
    // task #5: headers abbreviated to fit widened columns ("Lunar" and "Img time").
    expect(screen.getByText('Lunar')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Img time')).toBeInTheDocument();
  });

  it('renders rows inside a real <table>; FLAT by default (no group headers)', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(within(table).getByText('NGC 7000')).toBeInTheDocument();
    expect(within(table).getByText('M 31')).toBeInTheDocument();
    // Consistent with every list page: flat by default → no catalogue headers.
    expect(within(table).queryByText('Messier')).not.toBeInTheDocument();
    expect(within(table).queryByText('NGC')).not.toBeInTheDocument();
  });

  it('groups by catalogue when dims=["catalogue"] (Messier + NGC headers)', () => {
    renderTable({ dims: ['catalogue'] });
    const table = screen.getByRole('table');
    expect(within(table).getByText('Messier')).toBeInTheDocument();
    expect(within(table).getByText('NGC')).toBeInTheDocument();
  });

  it('renders a max-altitude value per target row, and NO sparkline (FR-007)', () => {
    renderTable();
    // Degree-suffixed max altitude appears (rounded integer + °) — may also
    // match lunar distance values so just confirm at least 2 are present.
    expect(screen.getAllByText(/^\d+°$/).length).toBeGreaterThanOrEqual(2);
    // Iteration 2026-07-15: the per-row altitude sparkline is hard-removed —
    // the detail panel's altitude graph is the canonical altitude view.
    expect(
      screen.queryByLabelText('Altitude tonight for NGC 7000'),
    ).not.toBeInTheDocument();
  });

  it('renders the guidance unknown state when no observing night is provided', () => {
    // Default renderTable() passes no `night`, so real guidance cannot be
    // computed — the pill strip renders the explicit unknown state, not a
    // fabricated per-band recommendation.
    renderTable();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
  });

  it('renders real per-band viability pills with a night (spec 047 US3)', () => {
    render(
      <TargetsTable
        targets={TARGETS}
        selected={null}
        onSelect={vi.fn()}
        sort={DEFAULT_TARGET_SORT}
        onSort={vi.fn()}
        night={nightWithMoonAtVernalEquinox()}
      />,
    );
    // Each row has 7 band pills (L/R/G/B/Ha/SII/OIII), each labelled viable or
    // not-viable — never a fabricated recommendation.
    const haPills = screen.getAllByLabelText(
      /^Ha: (viable|not viable) tonight$/,
    );
    expect(haPills.length).toBeGreaterThanOrEqual(1);
  });

  it('fires onSelect when a target row is clicked', () => {
    const { onSelect } = renderTable();
    const cell = screen.getByText('NGC 7000');
    fireEvent.click(cell.closest('tr') as HTMLTableRowElement);
    expect(onSelect).toHaveBeenCalledWith('NGC 7000');
  });

  it('fires onSort when a sortable header is clicked', () => {
    const { onSort } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Type' }));
    expect(onSort).toHaveBeenCalledWith('type');
  });

  it('fires onSort for all spec 044 sortable columns', () => {
    const { onSort } = renderTable();
    // task #5: aria-labels use the abbreviated header text.
    const sortCases: [string, string][] = [
      ['Sort by Max alt', 'maxAlt'],
      ['Sort by Lunar', 'lunarDist'],
      ['Sort by Img time', 'imagingTime'],
    ];
    for (const [label, col] of sortCases) {
      onSort.mockClear();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onSort).toHaveBeenCalledWith(col);
    }
  });

  it('reflects usableAltDeg in the imaging-time tooltip text', () => {
    // Needs a real site + a winter night: the imaging-time tooltip only
    // references the threshold for the non-zero and altitude-reason states
    // (the darkness reason is threshold-independent).
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T20:00:00Z'));
    try {
      renderTable({ usableAltDeg: 42 });
      // At least one tooltip should reference the custom threshold.
      const spans = document.querySelectorAll('[title*="42°"]');
      expect(spans.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
      __setObservingStateForTest({});
    }
  });

  it('shows the empty message when there are no targets and not loading', () => {
    renderTable({ targets: [], emptyMessage: 'Nothing here.' });
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('shows the loading footer while loading', () => {
    renderTable({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

// ── spec 044 Track B: US6/T015 no-site prompt, T018 tests ──────────────────────

const SITE: ObserverSite = {
  id: 'site-test',
  name: 'Test Site',
  latitudeDeg: 52.37,
  longitudeDeg: 4.9,
  elevationM: 0,
  timezone: 'Europe/Amsterdam',
  twilight: 'astronomical',
  minHorizonAltDeg: 0,
};

describe('TargetsTable — no-site prompt (US6/T015/T018)', () => {
  beforeEach(() => {
    __setObservingStateForTest({});
  });

  it('shows a no-site prompt banner when there is no active observing site', () => {
    renderTable();
    expect(
      screen.getByText(/Add an observing site.*see tonight's real altitude/i),
    ).toBeInTheDocument();
  });

  it('degrades lunar-distance cells to "—" (no throw) when there is no active site', () => {
    renderTable();
    // Every row's lunar-distance cell shows the null-degrade placeholder.
    expect(screen.queryAllByText('—').length).toBeGreaterThan(0);
  });

  it('hides the no-site banner once an active site is set', () => {
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
    renderTable();
    expect(
      screen.queryByText(/Add an observing site.*see tonight's real altitude/i),
    ).not.toBeInTheDocument();
  });

  it('computes real (non-degraded) astronomy for a circumpolar target once a site is active', () => {
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
    const circumpolar: TargetListItem = {
      id: 'circumpolar',
      effectiveLabel: 'Circumpolar Target',
      primaryDesignation: 'Circumpolar Target',
      objectType: 'other',
      raDeg: 0,
      decDeg: 85, // circumpolar at 52°N regardless of date/time
      aliases: [],
    };
    // Pin "now" to a winter night: mid-summer at 52°N never reaches
    // astronomical twilight, so visibleTonight would be false regardless of
    // altitude (FR-017) — not a useful test of the real-astronomy wiring.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T20:00:00Z'));
    try {
      renderTable({ targets: [circumpolar] });
      // A circumpolar target on a winter night has real non-zero imaging
      // time: the cell shows an "Nh"/"NhMm" value and NO warning glyph
      // (FR-030 only marks zero values; not the needsSite degrade state).
      expect(screen.getAllByText(/^\d+h(\d+m)?$/).length).toBeGreaterThan(0);
      expect(document.querySelector('.alm-imgtime-glyph--warn')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('zero imaging time carries a reason glyph (FR-030/SC-015): high-lat summer darkness', () => {
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
    // Mid-June at 52°N never reaches astronomical twilight → no dark window →
    // zero imaging with reason 'darkness' (FR-029) → ☀ warning glyph.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T22:00:00Z'));
    try {
      renderTable();
      const glyphs = document.querySelectorAll('.alm-imgtime-glyph--warn');
      expect(glyphs.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('☀').length).toBeGreaterThanOrEqual(1);
      // The glyph exposes the reason as its accessible name + tooltip.
      expect(
        document.querySelectorAll('[title*="never gets dark"]').length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── US2: real lunar distance + sorting (spec 047 T013/T014) ──────────────────

/** Build a controllable observing night with the Moon pointing at RA0/Dec0. */
function nightWithMoonAtVernalEquinox(): ObservingNight {
  return {
    nightKey: '2026-07-05',
    midnight: new Date('2026-07-05T00:00:00Z'),
    phaseName: 'full',
    waxing: false,
    illuminationFrac: 1,
    moonAgeFromFullDays: 0,
    moonVec: { x: 1, y: 0, z: 0 }, // RA 0h, Dec 0°
  };
}

/** A target row with explicit coordinates (or null for the unknown case). */
function coordItem(
  desig: string,
  raDeg: number | null,
  decDeg: number | null,
): TargetListItem {
  return {
    id: desig,
    effectiveLabel: desig,
    primaryDesignation: desig,
    objectType: 'other',
    raDeg,
    decDeg,
    aliases: [],
  };
}

describe('TargetsTable — lunar distance (US2)', () => {
  const night = nightWithMoonAtVernalEquinox();
  // Sep from Moon@RA0/Dec0: NEAR=0°, MID=90°, FAR=180°, UNK=unknown.
  const NEAR = coordItem('NEAR', 0, 0);
  const MID = coordItem('MID', 90, 0);
  const FAR = coordItem('FAR', 180, 0);
  const UNK = coordItem('UNK', null, null);

  function renderWithNight(sortDir: 'asc' | 'desc', targets: TargetListItem[]) {
    render(
      <TargetsTable
        targets={targets}
        selected={null}
        onSelect={vi.fn()}
        sort={{ col: 'lunarDist', dir: sortDir }}
        onSort={vi.fn()}
        night={night}
      />,
    );
  }

  function rowOrder(): string[] {
    const table = screen.getByRole('table');
    return within(table)
      .getAllByText(/^(NEAR|MID|FAR|UNK)$/)
      .map((el) => el.textContent as string);
  }

  it('renders whole-degree separations and "—" for unknown coordinates', () => {
    renderWithNight('asc', [MID, UNK]);
    // MID is 90° from the Moon.
    expect(screen.getByText('90°')).toBeInTheDocument();
    // UNK shows an explicit dash, never a number.
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('sorts ascending by real separation with unknowns last', () => {
    renderWithNight('asc', [FAR, UNK, NEAR, MID]);
    expect(rowOrder()).toEqual(['NEAR', 'MID', 'FAR', 'UNK']);
  });

  it('sorts descending by real separation, unknowns STILL last', () => {
    renderWithNight('desc', [FAR, UNK, NEAR, MID]);
    expect(rowOrder()).toEqual(['FAR', 'MID', 'NEAR', 'UNK']);
  });

  it('gates off (all "—") when no observing night is provided', () => {
    render(
      <TargetsTable
        targets={[NEAR, MID]}
        selected={null}
        onSelect={vi.fn()}
        sort={DEFAULT_TARGET_SORT}
        onSort={vi.fn()}
      />,
    );
    // No numeric lunar separations; both rows show the unknown dash.
    expect(screen.queryByText('90°')).not.toBeInTheDocument();
  });
});

// ── Row cache contract (#573 perf) ──────────────────────────────────────────
//
// The full-catalogue sort/group pass reuses a per-target-id cache gated by a
// generation key of all astronomy inputs (see TargetsTable.tsx's module doc)
// so growing the revealed target set only pays for the delta. These tests
// assert the cache CONTRACT directly (object-identity reuse on a hit, a
// fresh compute on a miss) rather than timing, which would be flaky on CI.
describe('TargetsTable row cache (#573)', () => {
  const { getCachedRow, rowCacheGenKey } = __testExports;
  const TARGET = coordItem('CACHE-TEST', 10, 20);
  const SITE_A: ObserverSite = {
    id: 'site-a',
    name: 'A',
    latitudeDeg: 52,
    longitudeDeg: 5,
    elevationM: 0,
    timezone: 'Europe/Amsterdam',
    twilight: 'astronomical',
    minHorizonAltDeg: 0,
  };

  it('reuses the same object on a cache hit (same target id + genKey)', () => {
    const cache = new Map();
    const genKey = rowCacheGenKey(
      30,
      SITE_A,
      1000,
      null,
      DEFAULT_MOON_AVOIDANCE,
    );
    const first = getCachedRow(
      cache,
      TARGET,
      genKey,
      30,
      SITE_A,
      1000,
      DEFAULT_MOON_AVOIDANCE,
      null,
    );
    const second = getCachedRow(
      cache,
      TARGET,
      genKey,
      30,
      SITE_A,
      1000,
      DEFAULT_MOON_AVOIDANCE,
      null,
    );
    expect(second).toBe(first);
  });

  it('recomputes (fresh object) when the generation key changes', () => {
    const cache = new Map();
    const genKeyA = rowCacheGenKey(
      30,
      SITE_A,
      1000,
      null,
      DEFAULT_MOON_AVOIDANCE,
    );
    const genKeyB = rowCacheGenKey(
      45,
      SITE_A,
      1000,
      null,
      DEFAULT_MOON_AVOIDANCE,
    );
    const first = getCachedRow(
      cache,
      TARGET,
      genKeyA,
      30,
      SITE_A,
      1000,
      DEFAULT_MOON_AVOIDANCE,
      null,
    );
    const second = getCachedRow(
      cache,
      TARGET,
      genKeyB,
      45,
      SITE_A,
      1000,
      DEFAULT_MOON_AVOIDANCE,
      null,
    );
    expect(second).not.toBe(first);
    // The new entry now occupies the cache slot for this id.
    expect(cache.get(TARGET.id)).toBe(second);
  });

  it('rowCacheGenKey changes with each astronomy input', () => {
    const base = rowCacheGenKey(30, SITE_A, 1000, null, DEFAULT_MOON_AVOIDANCE);
    expect(
      rowCacheGenKey(31, SITE_A, 1000, null, DEFAULT_MOON_AVOIDANCE),
    ).not.toBe(base);
    expect(
      rowCacheGenKey(30, null, 1000, null, DEFAULT_MOON_AVOIDANCE),
    ).not.toBe(base);
    expect(
      rowCacheGenKey(30, SITE_A, 2000, null, DEFAULT_MOON_AVOIDANCE),
    ).not.toBe(base);
    expect(
      rowCacheGenKey(
        30,
        SITE_A,
        1000,
        nightWithMoonAtVernalEquinox(),
        DEFAULT_MOON_AVOIDANCE,
      ),
    ).not.toBe(base);
  });

  it('rowCacheGenKey changes when a site is edited in place (same id, new geometry)', () => {
    // Editing an existing site (Settings → Observing sites) keeps its id but
    // changes lat/lon/elevation; rowAltitudeFor reads geometry off the site
    // object, so the gen key must invalidate on that edit too, not just on a
    // different site id (nJ09c/nJ10a carry-over).
    const SITE_A_MOVED: ObserverSite = {
      ...SITE_A,
      latitudeDeg: SITE_A.latitudeDeg + 1,
      longitudeDeg: SITE_A.longitudeDeg + 1,
      elevationM: 100,
    };
    expect(
      rowCacheGenKey(30, SITE_A_MOVED, 1000, null, DEFAULT_MOON_AVOIDANCE),
    ).not.toBe(rowCacheGenKey(30, SITE_A, 1000, null, DEFAULT_MOON_AVOIDANCE));
  });
});

// ── #757: needs-coordinates is a distinct table state, not 0°/"low" ────────────

describe('TargetsTable — needs-coordinates state (#757)', () => {
  beforeEach(() => {
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
  });

  it('shows the unresolved chip (never "0°") in Max alt for a target with no coordinates', () => {
    renderTable({ targets: [coordItem('UNK', null, null)] });
    expect(screen.queryByText('0°')).not.toBeInTheDocument();
    // One chip in the Max alt cell — the sparkline column is removed
    // (iteration 2026-07-15, FR-007), so exactly one chip renders.
    expect(screen.getAllByTestId('unresolved-chip').length).toBe(1);
  });

  it('needs-coordinates stays distinct from a genuinely low target (#757 under the glyph model)', () => {
    // Pin to a winter night (see the circumpolar test above): mid-summer at
    // 52°N never reaches astronomical twilight, which would make the
    // low-altitude fixture read as darkness-blocked instead of
    // altitude-blocked — not a useful test of the #757 distinction.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T20:00:00Z'));
    try {
      renderTable({
        targets: [coordItem('UNK', null, null), coordItem('LOW', 0, -80)],
      });
      // Iteration 2026-07-15 (FR-007/FR-030): the visible-tonight column is
      // gone; the distinction now reads as the unresolved chip (UNK) vs the
      // ▲ altitude-reason glyph on the LOW target's zero imaging time — a
      // no-coordinates target must never look like a merely low one.
      expect(screen.getAllByTestId('unresolved-chip').length).toBe(1);
      expect(
        screen.getByLabelText(/never clears 30° during darkness/),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── #579: no-dark-window nights still discriminate by altitude ───────────────
//
// At lat 52 there is no astronomical darkness for months (summer). Under the
// iteration 2026-07-15 glyph model the Visible column is gone (FR-007) — the
// #579 discrimination now reads as: BOTH extremes carry the ☀ darkness-reason
// glyph on their zero imaging time (FR-029 precedence: darkness is the most
// upstream blocker for every target), while Max alt still separates the
// zenith target (large real value) from the never-riser (0°/low). The
// derive-level "observable in twilight" flag itself is pinned in
// planner-derive.test.ts (#579 describe).
describe('TargetsTable — no-dark-window summer night (#579, glyph model)', () => {
  beforeEach(() => {
    __setObservingStateForTest({
      sites: [SITE],
      activeSiteId: SITE.id,
      defaultSiteId: SITE.id,
    });
  });

  it('zenith vs never-riser: same darkness reason, but Max alt discriminates', () => {
    vi.useFakeTimers();
    // Mid-July at 52°N: no astronomical dark window exists all night.
    vi.setSystemTime(new Date('2026-07-15T21:00:00Z'));
    try {
      renderTable({
        targets: [
          coordItem('ZENITH', 270, 52), // transits near the zenith
          coordItem('NEVER', 0, -80), // never rises at 52°N
        ],
      });
      const table = screen.getByRole('table');
      const zenithRow = within(table)
        .getByText('ZENITH')
        .closest('tr') as HTMLTableRowElement;
      const neverRow = within(table)
        .getByText('NEVER')
        .closest('tr') as HTMLTableRowElement;
      // Both zero imaging-time cells expose the darkness reason (SC-015)…
      expect(
        zenithRow.querySelectorAll('.alm-imgtime-glyph--warn').length,
      ).toBe(1);
      expect(neverRow.querySelectorAll('.alm-imgtime-glyph--warn').length).toBe(
        1,
      );
      // …while Max alt keeps the two extremes visibly different: the zenith
      // target renders a large real altitude, the never-riser does not.
      expect(within(zenithRow).getByText(/^(8[5-9]|90)°$/)).toBeInTheDocument();
      expect(within(neverRow).queryByText(/^(8[5-9]|90)°$/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a normal dark night renders a real value with NO warning glyph', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T20:00:00Z'));
    try {
      renderTable({ targets: [coordItem('HIGH', 90, 52)] });
      const table = screen.getByRole('table');
      const row = within(table)
        .getByText('HIGH')
        .closest('tr') as HTMLTableRowElement;
      expect(within(row).getByText(/^\d+h(\d+m)?$/)).toBeInTheDocument();
      expect(row.querySelector('.alm-imgtime-glyph--warn')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// spec 054 US5 (FR-006/FR-007): permanent column order + pinned identity columns.
describe('TargetsTable column order + pinned identity columns (spec 054 US5)', () => {
  it('renders header + first body row columns in the FR-006 permanent order', () => {
    renderTable();
    const table = screen.getByRole('table');

    const headerCells = within(
      table.querySelector('thead tr') as HTMLTableRowElement,
    ).getAllByRole('columnheader');
    // Star header is icon-only (no text label) — identify it via its title
    // attribute instead; every other column asserts on its visible label text.
    expect(headerCells[0].title).toBe(m.targets_col_favourite());
    // Designation is the default active sort column, so its header carries
    // the shared SortHeader direction-arrow glyph appended to the label.
    expect(headerCells.slice(1).map((c) => c.textContent?.trim())).toEqual([
      'Designation▲',
      'Img time',
      'Opposition',
      'Type',
      'Filters',
      'Max alt',
      'Lunar',
      'Sessions',
    ]);

    // First body row (sorted by designation asc: "M 31" before "NGC 7000").
    const bodyRow = within(table)
      .getByText('M 31')
      .closest('tr') as HTMLTableRowElement;
    const cells = within(bodyRow).getAllByRole('cell');
    expect(cells).toHaveLength(9);
  });

  it('marks the star and designation cells as pinned (sticky-left)', () => {
    renderTable();
    const table = screen.getByRole('table');

    // Header corner cells.
    const headerCells = within(
      table.querySelector('thead tr') as HTMLTableRowElement,
    ).getAllByRole('columnheader');
    expect(headerCells[0].className).toContain('alm-targets-pin-star');
    expect(headerCells[1].className).toContain('alm-targets-pin-designation');

    // Body cells for a data row.
    const bodyRow = within(table)
      .getByText('M 31')
      .closest('tr') as HTMLTableRowElement;
    const bodyCells = within(bodyRow).getAllByRole('cell');
    expect(bodyCells[0].className).toContain('alm-targets-pin-star');
    expect(bodyCells[1].className).toContain('alm-targets-pin-designation');
  });
});
