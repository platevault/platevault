// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TargetsTable — spec 043 shared list-page adoption (task #73), refined #82,
 * VIRTUALIZED + planning columns (#84/#85), spec 044 mock columns.
 *
 * A DENSE, FULL-WIDTH sortable table (shared `Table` look) that is the primary
 * content of the Targets page's `ListPageLayout`; TargetDetailV2 lives in the
 * detail pane.
 *
 * Columns (spec 044): Designation · Type · Max alt · (sparkline) · Visible
 * tonight · Opposition · Lunar dist · Filters · Imaging time · Sessions.
 *
 * Task #84 — VIRTUALIZATION (padding-spacer pattern):
 *   The Planner catalogue is large; rendering every row synchronously blocks the
 *   main thread. Rows (group-header rows AND target rows) are flattened into one
 *   list and windowed with `@tanstack/react-virtual`.
 *
 *   IMPORTANT — mixing a real CSS `<table>` with TanStack Virtual requires the
 *   PADDING-SPACER pattern, NOT the tbody-height + transform pattern:
 *
 *   Problem: setting `height: totalSize` on `<tbody>` and leaving rows in normal
 *   table flow (display:table-row) causes the browser to distribute the total
 *   height across the rendered rows — each row stretches to totalSize/rowCount
 *   (~1.7 M px with 13 rows rendered from 11 k). If `measureElement` is also
 *   attached it reads the stretched height and re-inflates totalSize → runaway
 *   feedback loop → effectively invisible table.
 *
 *   Fix: keep `<tbody>` height unstyled (natural). Render two sentinel spacer
 *   `<tr>` rows — one before the windowed slice (height = start of first virtual
 *   row) and one after (height = totalSize − end of last virtual row). Real data
 *   rows render between them in normal table flow at their natural ~36 px height.
 *   No transforms, no absolutepositioning, no tbody height, no measureElement.
 *   Row heights are uniform so fixed `estimateSize` is exact.
 *
 *   jsdom fallback: when the scroll element has no measurable height the
 *   virtualizer yields zero virtual items. In that case all rows render with no
 *   spacers — windowing is a runtime perf optimization, not a behavior change.
 *
 * Task #85 — PLANNING COLUMNS:
 *   The low-value Constellation/Magnitude columns are replaced with
 *   planning-relevant ones driven by the real per-site ephemeris
 *   (`planner-altitude.ts`/`planner-astronomy.ts`, spec 044 Track B,
 *   astronomy-engine): max altitude tonight, a tiny inline altitude SPARKLINE
 *   per row, and a visible-tonight indicator, all computed from the target's
 *   real J2000 coordinates and the active observing site — never derived from
 *   the designation.
 *
 * Spec 047 real Track-A astronomy columns (date/time + catalogued RA/Dec only;
 * replaces the former spec 044 §3 mock columns):
 *   - Lunar dist: real target↔Moon separation from the shared `ObservingNight`
 *     (US2); unknown coordinates/no site → explicit "—", never a number.
 *   - Filters: real per-band Moon-avoidance viability pills + derived
 *     recommendation (US3, `GuidanceCell`/`astro/moon-avoidance.ts`), with a
 *     hover/focus explanation popover.
 *   - Opposition: real next-opposition date (US4, `astro/opposition.ts`),
 *     date-level + relative "in N days/months"; unknown → "—".
 *   - Imaging time: real hours above the user-configured altitude threshold
 *     tonight (spec 044 Track B, dark-window-gated).
 *   All are SORTABLE; the usable-altitude threshold is configurable via Settings.
 *
 * Task #82:
 *   Row density follows the GLOBAL density setting (`density-*` on <html>).
 *   GROUP-BY: rows render under spanning group-header rows, grouped by Catalogue
 *   (default) or Object type.
 *
 * Search + the catalogue / group-by controls live in the page top bar; this
 * surface owns no toolbar state. Selecting a row opens TargetDetailV2 (selection
 * is driven by the host page via `?selected`).
 */

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from '@tanstack/react-router';
import type { TargetListItem, TargetObjectType } from '@/bindings/index';
import { Pill, Banner, Skeleton, tableIndent } from '@/ui';
import { SortHeader, ariaSortFor } from '@/components';
import { UnresolvedChip } from '@/components/RenderValue';
import { objectTypeLabel } from '@/components/TargetSearch/objectType';
import { catalogueOf, catalogueLabel } from './planner-catalog';
import {
  rowAltitudeFor,
  USABLE_ALT_DEG,
  type RowAltitude,
} from './planner-altitude';
import type { ObservingNight } from './astro/moon-state';
import {
  deriveRowMoonPlanning,
  UNKNOWN_ROW_PLANNING,
  type RowMoonPlanning,
} from './astro/row-planning';
import {
  DEFAULT_MOON_AVOIDANCE,
  type MoonAvoidanceParams,
} from './astro/moon-avoidance';
import { formatOppositionDate, oppositionRelative } from './astro/opposition';
import { AltitudeSparkline } from './AltitudeSparkline';
import { GuidanceCell } from './GuidanceCell';
import { recommendationLabel } from './FilterBadges';
import { m } from '@/lib/i18n';
import { useFavourites } from './useFavourites';
import { useActiveSite } from './observing-sites/site-store';
import type { ObserverSite } from './observing-sites/observer-site';
import { usePlannerDateMs } from './planner-date-store';
import {
  groupByDimensions,
  flattenVisibleGroups,
  type DimensionAccessor,
} from '@/lib/grouping';
import { useCollapsibleGroups } from '@/lib/use-grouping';

// ── Sort model ────────────────────────────────────────────────────────────────

/**
 * Columns the table can sort by.
 *
 * Spec 044/047 additions, sortable:
 *   - maxAlt: sorts by peak altitude tonight (Track B placeholder)
 *   - visible: sorts by visibleTonight flag then hoursAboveUsable
 *   - opposition: sorts by real days-to-next-opposition, soonest first;
 *     unknown coordinates always sort last regardless of direction (spec 047 US4)
 *   - lunarDist: sorts by real target↔Moon separation; unknowns sort last
 *     regardless of direction (spec 047 US2)
 *   - imagingTime: sorts by hoursAboveUsable (Track B placeholder)
 *   - sessions: stub — all values 0; sort is a no-op
 */
export type TargetSortCol =
  | 'designation'
  | 'type'
  | 'maxAlt'
  | 'visible'
  | 'opposition'
  | 'lunarDist'
  | 'imagingTime'
  | 'sessions';
export type SortDir = 'asc' | 'desc';

export interface TargetSort {
  col: TargetSortCol;
  dir: SortDir;
}

export const DEFAULT_TARGET_SORT: TargetSort = {
  col: 'designation',
  dir: 'asc',
};

// ── Grouping model (task #82) ───────────────────────────────────────────────────

/** What the table groups rows by (Planner top-bar Group-by control). */
export type TargetGroupBy = 'catalogue' | 'type';
export const DEFAULT_TARGET_GROUP_BY: TargetGroupBy = 'catalogue';

/** Formats the objectType string into a readable, localized label. */
export function formatType(objectType: string): string {
  return objectTypeLabel(objectType as TargetObjectType);
}

/** Resolve the group key + display headline for a target under `groupBy`. */
function groupHeadlineOf(t: TargetListItem, groupBy: TargetGroupBy): string {
  if (groupBy === 'type') {
    return t.objectType
      ? formatType(t.objectType)
      : m.targets_table_unknown_type();
  }
  const cat = catalogueOf(t);
  return cat ? catalogueLabel(cat) : m.targets_objtype_other();
}

function compareStr(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Compare two target+altitude pairs for sorting. Altitude-derived columns
 * require the pre-computed `RowAltitude` values (which encode the user's
 * threshold), so the comparator receives them alongside the list items.
 */
function compareTargetRows(
  a: TargetListItem,
  altA: RowAltitude,
  moonA: RowMoonPlanning,
  b: TargetListItem,
  altB: RowAltitude,
  moonB: RowMoonPlanning,
  sort: TargetSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'designation':
      cmp = compareStr(a.effectiveLabel, b.effectiveLabel);
      break;
    case 'type':
      cmp = compareStr(a.objectType, b.objectType);
      break;
    case 'maxAlt':
      cmp = altA.maxAltDeg - altB.maxAltDeg;
      break;
    case 'visible':
      // Primary: visible flag (true > false). Secondary: hours above threshold.
      cmp =
        Number(altA.visibleTonight) - Number(altB.visibleTonight) ||
        altA.hoursAboveUsable - altB.hoursAboveUsable;
      break;
    case 'opposition': {
      // Real next-opposition date (US4). Unknowns (no coordinates / no site)
      // always sort AFTER known values regardless of direction, mirroring the
      // lunarDist convention (FR-014), soonest-next first when ascending.
      const da = moonA.daysToOpposition;
      const db = moonB.daysToOpposition;
      if (da === null && db === null)
        return compareStr(a.effectiveLabel, b.effectiveLabel);
      if (da === null) return 1;
      if (db === null) return -1;
      cmp = da - db || compareStr(a.effectiveLabel, b.effectiveLabel);
      break;
    }
    case 'lunarDist': {
      // Real lunar separation (US2). Unknowns (no coordinates / no site) always
      // sort AFTER known values regardless of direction, with a deterministic
      // designation tie-break (FR-007).
      const sa = moonA.lunarSeparationDeg;
      const sb = moonB.lunarSeparationDeg;
      if (sa === null && sb === null)
        return compareStr(a.effectiveLabel, b.effectiveLabel);
      if (sa === null) return 1;
      if (sb === null) return -1;
      cmp = sa - sb || compareStr(a.effectiveLabel, b.effectiveLabel);
      break;
    }
    case 'imagingTime':
      cmp = altA.hoursAboveUsable - altB.hoursAboveUsable;
      break;
    case 'sessions':
      // All values are 0 until backend #57 lands; preserve input order.
      cmp = 0;
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

interface TargetGroup {
  label: string;
  /** Each entry holds the item, its altitude row, and its moon-planning row. */
  rows: Array<{
    target: TargetListItem;
    alt: RowAltitude;
    moon: RowMoonPlanning;
  }>;
}

// ── Per-target row cache (#573) ─────────────────────────────────────────────
//
// The full-catalogue sort/group pass below (up to ~13k rows) is the
// unbackgrounded synchronous work that froze the app on open (#573): each
// row runs astronomy-engine altitude sampling (rowAltitudeFor) + Moon
// planning (deriveRowMoonPlanning), which is not free at catalogue scale
// (see rowAltitudeFor's doc — "a real perf cliff... a Layer-2 CI timeout
// against the full ~13k-entry bundled seed catalogue"). Re-running that for
// every target on every render (every sort/filter/group/reveal-chunk change)
// is wasted work when the astronomy INPUTS (site/date/night/threshold/
// guidance params) haven't changed for a given target. `rowCache` memoizes
// per target id, gated by `genKey` (all astronomy inputs); TargetsPage's
// incremental reveal (growing the `targets` array in chunks) then only pays
// for the newly-revealed delta each step instead of recomputing the whole
// set, since previously-seen ids hit the cache.
interface RowCacheEntry {
  genKey: string;
  alt: RowAltitude;
  moon: RowMoonPlanning;
}

/** Generation key gating `rowCache`: changes whenever any astronomy input does. */
function rowCacheGenKey(
  usableAltDeg: number,
  site: ObserverSite | null,
  dateMs: number,
  night: ObservingNight | null,
  guidanceParams: MoonAvoidanceParams,
): string {
  return `${usableAltDeg}|${site?.id ?? ''}|${dateMs}|${night?.nightKey ?? ''}|${JSON.stringify(guidanceParams)}`;
}

/**
 * Look up (or compute + cache) a target's full-catalogue-pass altitude/moon
 * values. `includeMoonGeometry` is always `false` here — same contract as
 * the call sites this replaces.
 */
function getCachedRow(
  cache: Map<string, RowCacheEntry>,
  t: TargetListItem,
  genKey: string,
  usableAltDeg: number,
  site: ObserverSite | null,
  dateMs: number,
  guidanceParams: MoonAvoidanceParams,
  night: ObservingNight | null,
): { alt: RowAltitude; moon: RowMoonPlanning } {
  const cached = cache.get(t.id);
  if (cached && cached.genKey === genKey) return cached;
  const alt = rowAltitudeFor(
    t,
    usableAltDeg,
    site,
    dateMs,
    guidanceParams,
    false,
  );
  const moon = deriveRowMoonPlanning(t, night, guidanceParams);
  const entry: RowCacheEntry = { genKey, alt, moon };
  cache.set(t.id, entry);
  return entry;
}

/**
 * Group targets by the selected key, compute altitude + moon planning for each,
 * sort within groups, then order groups by their first (sorted) row.
 */
function groupTargets(
  targets: TargetListItem[],
  sort: TargetSort,
  groupBy: TargetGroupBy,
  usableAltDeg: number,
  site: ObserverSite | null,
  night: ObservingNight | null,
  guidanceParams: MoonAvoidanceParams,
  dateMs: number,
  cache: Map<string, RowCacheEntry>,
  genKey: string,
): TargetGroup[] {
  const byKey = new Map<
    string,
    Array<{ target: TargetListItem; alt: RowAltitude; moon: RowMoonPlanning }>
  >();
  for (const t of targets) {
    const key = groupHeadlineOf(t, groupBy);
    const { alt, moon } = getCachedRow(
      cache,
      t,
      genKey,
      usableAltDeg,
      site,
      dateMs,
      guidanceParams,
      night,
    );
    const bucket = byKey.get(key);
    if (bucket) bucket.push({ target: t, alt, moon });
    else byKey.set(key, [{ target: t, alt, moon }]);
  }

  const groups: TargetGroup[] = [];
  for (const [label, rows] of byKey) {
    groups.push({
      label,
      rows: [...rows].sort((ra, rb) =>
        compareTargetRows(
          ra.target,
          ra.alt,
          ra.moon,
          rb.target,
          rb.alt,
          rb.moon,
          sort,
        ),
      ),
    });
  }

  groups.sort((ga, gb) => {
    const cmp = compareTargetRows(
      ga.rows[0].target,
      ga.rows[0].alt,
      ga.rows[0].moon,
      gb.rows[0].target,
      gb.rows[0].alt,
      gb.rows[0].moon,
      sort,
    );
    return cmp !== 0 ? cmp : compareStr(ga.label, gb.label);
  });
  return groups;
}

// ── Flattened virtual-row model ────────────────────────────────────────────────
//
// The virtualizer windows a single flat list, so groups + targets are flattened
// into a discriminated union. Group-header rows and target rows estimate to the
// same row height (keyed off --alm-row-height in CSS).

type FlatRow =
  | {
      kind: 'group';
      key: string;
      label: string;
      count: number;
      path?: string;
      depth?: number;
      collapsible?: boolean;
      collapsed?: boolean;
    }
  | {
      kind: 'target';
      key: string;
      target: TargetListItem;
      alt: RowAltitude;
      moon: RowMoonPlanning;
      depth?: number;
    };

// ── Multi-level grouping accessors ────────────────────────────────────────────

/**
 * Build the multi-level grouping accessors for the current night + guidance
 * params (US3, FR-011): the `filters` dimension groups by the REAL derived
 * recommendation category, so it must be rebuilt whenever the night or the
 * live per-band params change rather than being a static module export.
 */
function buildTargetAccessors(
  night: ObservingNight | null,
  guidanceParams: MoonAvoidanceParams,
  // #573 perf: reuse the moon planning already computed by the cached
  // full-catalogue pass (moonMap) instead of re-deriving it per target.
  moonLookup?: (t: TargetListItem) => RowMoonPlanning,
): Readonly<Record<string, DimensionAccessor<TargetListItem>>> {
  return {
    constellation: (t) =>
      (t as TargetListItem & { constellation?: string }).constellation ?? null,
    type: (t) => (t.objectType ? formatType(t.objectType) : null),
    catalogue: (t) => {
      const cat = catalogueOf(t);
      return cat ? catalogueLabel(cat) : m.targets_objtype_other();
    },
    // Applicable filters: group by the target's REAL derived recommendation
    // category (broadband-ok / narrowband-only / avoid-tonight / unknown).
    filters: (t) => {
      const { recommendation } = moonLookup
        ? moonLookup(t)
        : deriveRowMoonPlanning(t, night, guidanceParams);
      return recommendationLabel(recommendation);
    },
  };
}

function flattenGroups(groups: TargetGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: 'group',
      key: `g:${group.label}`,
      label: group.label,
      count: group.rows.length,
    });
    for (const { target, alt, moon } of group.rows) {
      rows.push({ kind: 'target', key: target.id, target, alt, moon });
    }
  }
  return rows;
}

// ── Column model (#85 + spec 044) ──────────────────────────────────────────────
//
// Designation + Type + Sessions are kept. Constellation/Magnitude are replaced
// by planning columns. Spec 044 adds Lunar dist, Filters possible, Imaging time.
//
// Opposition: real next midnight-transit peak date (spec 047 US4,
// astro/opposition.ts); unknown coordinates render '—'.
// Sessions: linked-session count not on TargetListItem yet (#57). Renders '—'.
// All non-text columns are sortable on their mock value.

// `label`/`title` are render-time thunks (spec 046 #8b) so headers re-read the active locale.
const COLUMNS: Array<{
  key: string;
  label: () => string;
  sort?: TargetSortCol;
  className?: string;
  title?: () => string;
}> = [
  // task #18: star column (no label — icon-only header)
  {
    key: 'star',
    label: () => '★',
    className: 'alm-targets-cell--center',
    title: () => m.targets_col_favourite(),
  },
  {
    key: 'designation',
    label: () => m.targets_col_designation(),
    sort: 'designation',
  },
  { key: 'type', label: () => m.cmp_target_search_type_label(), sort: 'type' },
  {
    key: 'maxAlt',
    label: () => m.targets_col_max_alt(),
    sort: 'maxAlt',
    className: 'alm-targets-cell--num',
    title: () => m.targets_table_max_alt_title(),
  },
  {
    key: 'spark',
    label: () => m.targets_col_tonight(),
    className: 'alm-targets-cell--spark',
  },
  {
    key: 'visible',
    label: () => m.targets_col_visible(),
    sort: 'visible',
    className: 'alm-targets-cell--center',
    title: () => m.targets_col_visible_title(),
  },
  {
    key: 'opposition',
    label: () => m.targets_col_opposition(),
    sort: 'opposition',
    className: 'alm-targets-cell--opposition',
    title: () => m.targets_table_next_opposition(),
  },
  // task #5: abbreviated header "Lunar" fits the widened 80px column without clipping
  {
    key: 'lunarDist',
    label: () => m.targets_col_lunar(),
    sort: 'lunarDist',
    className: 'alm-targets-cell--num',
    title: () => m.targets_col_lunar_title(),
  },
  {
    key: 'filters',
    label: () => m.common_filters(),
    className: 'alm-targets-cell--filters',
    title: () => m.targets_col_filters_title(),
  },
  // task #5: abbreviated header "Img time" fits the widened 100px column without clipping
  {
    key: 'imagingTime',
    label: () => m.targets_col_img_time(),
    sort: 'imagingTime',
    className: 'alm-targets-cell--num',
    title: () => m.targets_col_img_time_title(),
  },
  {
    key: 'sessions',
    label: () => m.common_sessions(),
    sort: 'sessions',
    className: 'alm-targets-cell--num',
    title: () => m.targets_col_sessions_title(),
  },
];

// COL_COUNT is derived from COLUMNS so adding/removing a column stays in sync.
const COL_COUNT = COLUMNS.length;

/** Estimated row height (px) for the virtualizer's first measurement pass. */
const ROW_ESTIMATE = 36;
/** Extra rows rendered above/below the viewport to avoid blank flashes on scroll. */
const OVERSCAN = 12;

interface Props {
  targets: TargetListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  sort: TargetSort;
  onSort: (col: TargetSortCol) => void;
  /**
   * Legacy single-tier group-by (kept for back-compat with tests).
   * When `dims` is provided it takes precedence; `groupBy` is only used as
   * the fallback when `dims` is empty.
   * @deprecated Prefer `dims` from `useGrouping`.
   */
  groupBy?: TargetGroupBy;
  /**
   * Active ordered grouping dimension ids from `useGrouping`.
   * When non-empty, drives multi-level collapsible grouping; overrides `groupBy`.
   * When empty, falls back to `groupBy` (single-tier, legacy).
   */
  dims?: string[];
  /** Message shown when the list is empty (tab-specific). */
  emptyMessage?: string;
  /**
   * User-configured usable-altitude threshold in degrees (default USABLE_ALT_DEG).
   * Drives hoursAboveUsable, visibleTonight, and the Imaging time column.
   * Pass `useAltitudeThreshold()` from the host page.
   */
  usableAltDeg?: number;
  /**
   * The memoized observing night (spec 047), or `null` when no observing site
   * exists (site gate) so real astronomy is suppressed. Drives real per-row
   * lunar distance (US2), filter guidance (US3), and opposition (US4). One
   * `ObservingNight` per `nightKey` is computed by the host page and passed
   * down so per-row work stays O(1) and the Moon state is shared (SC-007).
   */
  night?: ObservingNight | null;
  /**
   * Active per-band Moon-avoidance parameters (spec 047 US3, Settings →
   * Target Planner). Defaults to the shipped table; pass `useGuidanceParams()`
   * from the host page so live edits recompute pills/recommendation (SC-008).
   */
  guidanceParams?: MoonAvoidanceParams;
  /**
   * Set of currently-favourited target ids (task #18, spec 051 US2).
   * When provided the star column renders filled for matched ids.
   */
  favouriteIds?: ReadonlySet<string>;
  /**
   * Called when the user clicks the star button in a row (task #18).
   */
  onToggleFavourite?: (targetId: string) => void;
}

export function TargetsTable({
  targets,
  selected,
  onSelect,
  loading,
  sort,
  onSort,
  // No default: when neither `dims` nor an explicit `groupBy` is supplied the
  // table renders a FLAT sorted list (previously this defaulted to
  // 'catalogue', which grouped Targets by catalogue even with nothing selected).
  groupBy,
  dims,
  emptyMessage = m.targets_table_no_match(),
  usableAltDeg = USABLE_ALT_DEG,
  night = null,
  guidanceParams = DEFAULT_MOON_AVOIDANCE,
  favouriteIds,
  onToggleFavourite,
}: Props) {
  // task #18: subscribe to the local favourites store.  The host page (TargetsPage)
  // passes its own useFavourites result down; if it doesn't (e.g. tests that don't
  // need favourites), we fall back to an internal subscription.  This keeps the
  // table self-contained when used standalone.
  const internalFavourites = useFavourites();
  const resolvedFavouriteIds = favouriteIds ?? internalFavourites.favouriteIds;
  const resolvedToggle = onToggleFavourite ?? internalFavourites.toggle;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle: toggleCollapsed } = useCollapsibleGroups();

  // US6/T015: the active observing site drives every row's real astronomy.
  // Self-contained subscription (mirrors useFavourites above) so callers don't
  // need to thread a `site` prop through — when there is no active site every
  // row degrades to the "needs a site" zero/not-visible state (T013) and the
  // banner below prompts the user to add one.
  const site = useActiveSite();

  // US2/T024: the Planner's chosen date (defaults to "tonight", never
  // persisted — FR-008). Every rowAltitudeFor call below reads it so choosing
  // a different date recomputes the whole table (SC-004).
  const dateMs = usePlannerDateMs();

  // #573 perf: per-target-id cache for the full-catalogue astronomy pass
  // below, persisted across renders for this component instance (a ref, not
  // state — it never needs to trigger a re-render itself). See the
  // `getCachedRow`/`rowCacheGenKey` doc above.
  const rowCacheRef = useRef<Map<string, RowCacheEntry>>(new Map());
  const genKey = rowCacheGenKey(
    usableAltDeg,
    site,
    dateMs,
    night,
    guidanceParams,
  );

  // Grouping + sorting + per-row altitude are all derived here so a filter
  // or sort change does one O(n) pass off the render hot path, not per-row work
  // inside the virtualized render loop. usableAltDeg + site are included in the
  // dep array so that changing the altitude threshold or the active site
  // re-derives all rows.
  //
  // When `dims` is non-empty we use the shared multi-level groupByDimensions
  // engine (with collapsible headers); when empty we fall back to the
  // legacy single-tier groupTargets (using `groupBy`).
  const useMultiGroup = dims != null && dims.length > 0;

  const flatRows = useMemo(() => {
    if (useMultiGroup) {
      // Pre-compute altitude + moon planning for all items (needed for sort +
      // display), reusing the per-id cache (#573) — see getCachedRow's doc.
      const withAlt = targets.map((t) => {
        const { alt, moon } = getCachedRow(
          rowCacheRef.current,
          t,
          genKey,
          usableAltDeg,
          site,
          dateMs,
          guidanceParams,
          night,
        );
        return { target: t, alt, moon };
      });
      // Sort the flat list first.
      const sortedWithAlt = [...withAlt].sort((a, b) =>
        compareTargetRows(
          a.target,
          a.alt,
          a.moon,
          b.target,
          b.alt,
          b.moon,
          sort,
        ),
      );
      const sorted = sortedWithAlt.map((r) => r.target);
      const altMap = new Map(sortedWithAlt.map((r) => [r.target.id, r.alt]));
      const moonMap = new Map(sortedWithAlt.map((r) => [r.target.id, r.moon]));

      // Build the group tree using shared engine. moonMap reuse (#573):
      // avoids re-deriving moon planning already computed above.
      const tree = groupByDimensions(
        sorted,
        dims!,
        buildTargetAccessors(
          night,
          guidanceParams,
          (t) => moonMap.get(t.id) ?? UNKNOWN_ROW_PLANNING,
        ),
      );
      // Flatten with collapse state, then map to our FlatRow shape.
      const visRows = flattenVisibleGroups(tree, collapsed);
      return visRows.map((vrow): FlatRow => {
        if (vrow.kind === 'header') {
          return {
            kind: 'group',
            key: vrow.path,
            label: vrow.node.label,
            count: vrow.node.count,
            path: vrow.path,
            depth: vrow.depth,
            collapsible: true,
            collapsed: vrow.collapsed,
          };
        }
        const t = vrow.item;
        return {
          kind: 'target',
          key: t.id,
          target: t,
          alt:
            altMap.get(t.id) ??
            rowAltitudeFor(
              t,
              usableAltDeg,
              site,
              dateMs,
              guidanceParams,
              false,
            ),
          moon: moonMap.get(t.id) ?? UNKNOWN_ROW_PLANNING,
          depth: vrow.depth,
        };
      });
    }
    // Single-tier legacy grouping ONLY if a caller explicitly asks for it.
    if (groupBy) {
      const groups = groupTargets(
        targets,
        sort,
        groupBy,
        usableAltDeg,
        site,
        night,
        guidanceParams,
        dateMs,
        rowCacheRef.current,
        genKey,
      );
      return flattenGroups(groups);
    }
    // Default: no grouping selected → FLAT sorted list (no group headers).
    // Full-catalogue pass (potentially ~13k rows pre-filter/pre-windowing)
    // needed only for sort, reusing the per-id cache (#573) — the real Moon
    // time-series is still computed per visible row at render time instead
    // (a real Layer-2 CI perf regression otherwise: see rowAltitudeFor's doc).
    const withAlt = targets.map((t) => {
      const { alt, moon } = getCachedRow(
        rowCacheRef.current,
        t,
        genKey,
        usableAltDeg,
        site,
        dateMs,
        guidanceParams,
        night,
      );
      return { target: t, alt, moon };
    });
    const sortedWithAlt = [...withAlt].sort((a, b) =>
      compareTargetRows(a.target, a.alt, a.moon, b.target, b.alt, b.moon, sort),
    );
    return sortedWithAlt.map(
      (r): FlatRow => ({
        kind: 'target',
        key: r.target.id,
        target: r.target,
        alt: r.alt,
        moon: r.moon,
        depth: 0,
      }),
    );
  }, [
    targets,
    sort,
    groupBy,
    usableAltDeg,
    site,
    night,
    guidanceParams,
    dateMs,
    useMultiGroup,
    dims,
    collapsed,
    genKey,
  ]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Windowing fallback: in a non-layout environment (jsdom under vitest) the
  // scroll element has no measurable height, so the virtualizer yields zero
  // items. Render every row without spacers in that case — tests rely on all
  // rows being present; windowing is purely a runtime perf optimization.
  const useWindowing = virtualItems.length > 0;

  // Indices of the visible slice. In non-windowed mode we render everything.
  const renderIndices: number[] = useWindowing
    ? virtualItems.map((vi) => vi.index)
    : flatRows.map((_, i) => i);

  // Padding-spacer pattern for real CSS <table> (see module header):
  // two sentinel spacer rows bracket the visible slice. Their combined height
  // equals totalSize so the scrollbar reflects the full virtual list length,
  // but the rendered data rows are in normal table flow at their natural height.
  const paddingBefore =
    useWindowing && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingAfter =
    useWindowing && virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  const columns = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    title: c.title?.(),
    // aria-sort belongs on the <th> (this table renders its own header row).
    ariaSort: c.sort ? ariaSortFor(sort.col === c.sort, sort.dir) : undefined,
    header: c.sort ? (
      <SortHeader
        label={c.label()}
        active={sort.col === c.sort}
        dir={sort.dir}
        onClick={() => onSort(c.sort as TargetSortCol)}
        ariaLabel={m.targets_table_sort_by_aria({ col: c.label() })}
        title={c.title?.()}
      />
    ) : (
      c.label()
    ),
  }));

  const count = targets.length;

  if (count === 0 && loading) {
    return (
      <div className="alm-targets-table__empty">
        <Skeleton variant="block" count={8} label={m.common_loading()} />
      </div>
    );
  }

  if (count === 0 && !loading) {
    return <div className="alm-targets-table__empty">{emptyMessage}</div>;
  }

  return (
    <div className="alm-targets-table__wrap">
      {!site && (
        <Banner variant="info" className="alm-targets-table__no-site-banner">
          {m.targets_planner_no_site_banner()}{' '}
          <Link
            to="/settings/$pane"
            params={{ pane: 'planner' }}
            className="alm-banner__action-link"
          >
            {m.targets_planner_no_site_banner_action()}
          </Link>
        </Banner>
      )}
      <div ref={scrollRef} className="alm-targets-table__scroll">
        <table className="alm-table alm-targets-table">
          {/* Fixed-layout colgroup: column widths are pinned so the table
              does NOT recompute widths per windowed page as pill text varies
              (e.g. "galaxy" vs "open cluster" would shift all columns).
              Designation is auto (fills remaining width); fixed widths on
              the right prevent the per-page column-shift bug.
              task #18: star col added first (28 px, wave2 CSS block). */}
          <colgroup>
            <col className="alm-targets-col--star" />
            <col className="alm-targets-col--designation" />
            <col className="alm-targets-col--type" />
            <col className="alm-targets-col--maxalt" />
            <col className="alm-targets-col--spark" />
            <col className="alm-targets-col--visible" />
            <col className="alm-targets-col--opposition" />
            {/* task #5: lunardist widened to 80px (wave2 CSS block). */}
            <col className="alm-targets-col--lunardist" />
            <col className="alm-targets-col--filters" />
            {/* task #5: imagingtime widened to 100px (wave2 CSS block). */}
            <col className="alm-targets-col--imagingtime" />
            <col className="alm-targets-col--sessions" />
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.className}
                  title={c.title}
                  aria-sort={c.ariaSort}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="alm-targets-table__body">
            {/* Before-spacer: reserve height for virtual rows above the window.
                Height is dynamic (virtualizer offset), allowed by convention. */}
            {paddingBefore > 0 && (
              <tr aria-hidden="true" className="alm-targets-table__spacer">
                {/* eslint-disable no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer before-spacer height; empty presentational cell inside an aria-hidden spacer row (no label needed) */}
                <td
                  colSpan={COL_COUNT}
                  style={{ height: `${paddingBefore}px` }}
                />
                {/* eslint-enable no-restricted-syntax, jsx-a11y/control-has-associated-label */}
              </tr>
            )}

            {renderIndices.map((index) => {
              const row = flatRows[index];

              if (row.kind === 'group') {
                if (row.collapsible && row.path != null) {
                  // Multi-level collapsible group header.
                  return (
                    <tr
                      key={row.key}
                      data-index={index}
                      className="alm-listgroup"
                    >
                      <td colSpan={COL_COUNT}>
                        <button
                          type="button"
                          className="alm-listgroup__cell"
                          data-testid={`targets-group-${row.key}`}
                          aria-expanded={!row.collapsed}
                          aria-label={row.label}
                          onClick={() => toggleCollapsed(row.path!)}
                          // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based group-header indent
                          style={{ paddingLeft: tableIndent(row.depth ?? 0) }}
                        >
                          <span
                            className="alm-listgroup__caret"
                            aria-hidden="true"
                          >
                            {row.collapsed ? '▸' : '▾'}
                          </span>
                          <span className="alm-listgroup__label">
                            {row.label}
                          </span>
                          <span className="alm-listgroup__count">
                            {m.targets_table_target_count({ count: row.count })}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                // Legacy non-collapsible group header.
                return (
                  <tr
                    key={row.key}
                    data-index={index}
                    className="alm-listgroup"
                  >
                    <td colSpan={COL_COUNT}>
                      {row.label}
                      <span className="alm-listgroup__count">
                        {m.targets_table_target_count({ count: row.count })}
                      </span>
                    </td>
                  </tr>
                );
              }

              const t = row.target;
              const alt = row.alt;
              const moon = row.moon;
              // Real per-band moon-free hours (US5/T029), recomputed HERE at
              // render time — only for the ~20-30 rows actually windowed on
              // screen, not the full (possibly ~13k-entry) catalogue `alt`
              // came from (that pass used includeMoonGeometry=false for
              // performance; see rowAltitudeFor's doc).
              const altMoon = rowAltitudeFor(
                t,
                usableAltDeg,
                site,
                dateMs,
                guidanceParams,
                true,
              );
              const showAltDesig = t.effectiveLabel !== t.primaryDesignation;
              const isSelected = selected === t.id;

              const isFav = resolvedFavouriteIds.has(t.id);

              return (
                <tr
                  key={row.key}
                  data-index={index}
                  className={
                    'alm-targets-table__row alm-table__row--clickable' +
                    (isSelected ? ' alm-targets-table__row--selected' : '')
                  }
                  onClick={() => onSelect(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(t.id);
                    }
                  }}
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- selectable row: focusable, activated by Enter/Space
                  tabIndex={0}
                  aria-selected={isSelected}
                >
                  {/* task #18: favourite star toggle.
                      STUB: stored in localStorage only until task #54 (backend linkage) lands.
                      stopPropagation prevents the row-select click from firing. */}
                  <td className="alm-targets-cell--center">
                    <button
                      type="button"
                      className={
                        'alm-targets-star' +
                        (isFav ? ' alm-targets-star--active' : '')
                      }
                      aria-label={
                        isFav
                          ? m.targets_star_unfavourite_aria({
                              label: t.effectiveLabel,
                            })
                          : m.targets_star_favourite_aria({
                              label: t.effectiveLabel,
                            })
                      }
                      aria-pressed={isFav}
                      title={
                        isFav
                          ? m.targets_star_remove_title()
                          : m.targets_star_add_title()
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        resolvedToggle(t.id);
                      }}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <span className="alm-targets-cell__desig">
                      <span className="alm-targets-cell__label">
                        {t.effectiveLabel}
                      </span>
                      {showAltDesig && (
                        <span className="alm-targets-cell__alt">
                          {t.primaryDesignation}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <Pill variant="ghost">{formatType(t.objectType)}</Pill>
                  </td>
                  {/* Real peak altitude tonight (spec 044 Track B ephemeris).
                      #757: no catalogued coordinates → the shared unresolved
                      chip, never a fabricated 0°. */}
                  <td className="alm-targets-cell--num">
                    {alt.needsCoordinates ? (
                      <span title={m.targets_table_needs_coordinates_title()}>
                        <UnresolvedChip />
                      </span>
                    ) : (
                      <span title={m.targets_table_max_alt_title()}>
                        {Math.round(alt.maxAltDeg)}°
                      </span>
                    )}
                  </td>
                  {/* Real inline altitude sparkline for the night (spec 044
                      Track B). #757: no coordinates → the unresolved chip
                      instead of a blank, ambiguous-looking curve. */}
                  <td className="alm-targets-cell--spark">
                    {alt.needsCoordinates ? (
                      <span title={m.targets_table_needs_coordinates_title()}>
                        <UnresolvedChip />
                      </span>
                    ) : (
                      <AltitudeSparkline
                        alt={alt}
                        label={m.targets_table_alt_sparkline_aria({
                          label: t.effectiveLabel,
                        })}
                      />
                    )}
                  </td>
                  {/* Visible-tonight indicator (peaks above usable alt).
                      #757: no catalogued coordinates is a distinct
                      un-plannable state, checked first — it must never look
                      like a genuinely low/not-visible target (FR-024).
                      US4/T033: a site/date with no qualifying dark window
                      (FR-017) discloses that explicitly instead of implying
                      the target is simply too low. */}
                  <td className="alm-targets-cell--center">
                    {alt.needsCoordinates ? (
                      <span
                        className="alm-targets-vis alm-targets-vis--no"
                        title={m.targets_table_needs_coordinates_title()}
                      >
                        ◌
                        <span className="alm-targets-vis__label">
                          {m.targets_table_needs_coordinates()}
                        </span>
                      </span>
                    ) : alt.noDarkWindow ? (
                      <span
                        className="alm-targets-vis alm-targets-vis--no"
                        title={m.targets_table_no_dark_window_title()}
                      >
                        ○
                        <span className="alm-targets-vis__label">
                          {m.targets_table_no_dark_window()}
                        </span>
                      </span>
                    ) : alt.visibleTonight ? (
                      <span
                        className="alm-targets-vis alm-targets-vis--yes"
                        title={m.targets_table_visible_reaches_title({
                          deg: Math.round(alt.maxAltDeg),
                          hours: alt.hoursAboveUsable.toFixed(1),
                          threshold: usableAltDeg,
                        })}
                      >
                        ●
                        <span className="alm-targets-vis__label">
                          {m.targets_table_visible_tonight()}
                        </span>
                      </span>
                    ) : (
                      <span
                        className="alm-targets-vis alm-targets-vis--no"
                        title={m.targets_table_visible_peaks_title({
                          deg: Math.round(alt.maxAltDeg),
                          threshold: usableAltDeg,
                        })}
                      >
                        ○
                        <span className="alm-targets-vis__label">
                          {m.targets_table_visible_low()}
                        </span>
                      </span>
                    )}
                  </td>
                  {/* Real next-opposition date (spec 047 US4). Unknown
                      coordinates / no site → explicit "—", never a date. */}
                  <td className="alm-targets-cell--opposition">
                    {moon.nextOppositionDate === null ||
                    moon.daysToOpposition === null ? (
                      <span
                        className="alm-targets-cell--muted"
                        title={m.targets_opposition_unknown_title()}
                      >
                        —
                      </span>
                    ) : (
                      (() => {
                        const rel = oppositionRelative(moon.daysToOpposition);
                        const relText =
                          rel.unit === 'days'
                            ? m.targets_opposition_in_days({ count: rel.count })
                            : m.targets_opposition_in_months({
                                count: rel.count,
                              });
                        return (
                          <span title={m.targets_table_next_opposition()}>
                            {formatOppositionDate(
                              new Date(`${moon.nextOppositionDate}T00:00:00Z`),
                            )}
                            {' · '}
                            {relText}
                          </span>
                        );
                      })()
                    )}
                  </td>
                  {/* Real lunar angular separation (spec 047 US2). Unknown
                      coordinates / no site → explicit "—", never a number. */}
                  <td className="alm-targets-cell--num">
                    {moon.lunarSeparationDeg === null ? (
                      <span
                        className="alm-targets-cell--muted"
                        title={m.targets_lunar_unknown_title()}
                      >
                        —
                      </span>
                    ) : (
                      <span
                        className="alm-targets-cell--lunardist"
                        title={m.targets_table_lunar_dist_title({
                          deg: Math.round(moon.lunarSeparationDeg),
                        })}
                      >
                        {Math.round(moon.lunarSeparationDeg)}°
                      </span>
                    )}
                  </td>
                  {/* Real per-band filter guidance from the Moon-avoidance rule
                      (spec 047 US3): pills + explanation popover. */}
                  <td className="alm-targets-cell--filters">
                    <GuidanceCell
                      night={night}
                      moon={moon}
                      params={guidanceParams}
                      targetLabel={t.effectiveLabel}
                      moonFreeMinutesByBand={
                        altMoon.needsCoordinates || altMoon.needsSite
                          ? null
                          : altMoon.moonFreeMinutesByBand
                      }
                    />
                  </td>
                  {/* MOCK (spec 044): hours above the usable-altitude threshold. */}
                  <td className="alm-targets-cell--num">
                    <span
                      title={m.targets_table_hours_above_title({
                        hours: alt.hoursAboveUsable.toFixed(1),
                        threshold: usableAltDeg,
                      })}
                    >
                      {alt.hoursAboveUsable > 0
                        ? m.targets_hours_above({
                            hours: alt.hoursAboveUsable.toFixed(1),
                          })
                        : '—'}
                    </span>
                  </td>
                  {/* MOCK (#57): linked-session count not on TargetListItem yet. */}
                  <td className="alm-targets-cell--num">
                    <span className="alm-targets-cell--muted">—</span>
                  </td>
                </tr>
              );
            })}

            {/* After-spacer: reserve height for virtual rows below the window.
                Height is dynamic (virtualizer remainder), allowed by convention. */}
            {paddingAfter > 0 && (
              <tr aria-hidden="true" className="alm-targets-table__spacer">
                {/* eslint-disable no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer after-spacer height; empty presentational cell inside an aria-hidden spacer row (no label needed) */}
                <td
                  colSpan={COL_COUNT}
                  style={{ height: `${paddingAfter}px` }}
                />
                {/* eslint-enable no-restricted-syntax, jsx-a11y/control-has-associated-label */}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="alm-targets-table__footer">
        {loading ? m.common_loading() : m.targets_table_target_count({ count })}
      </div>
    </div>
  );
}

// ── Test-only exports (#573) ────────────────────────────────────────────────
//
// Direct unit-testable access to the row cache contract (getCachedRow +
// rowCacheGenKey), mirroring the `__setObservingStateForTest` convention in
// site-store.ts. Not used by any non-test caller.
export const __testExports = { getCachedRow, rowCacheGenKey };
