/**
 * TargetsPage — spec 043 shared list-page adoption (task #73), spec 044 mock
 * columns + filter-by-filter + altitude threshold setting.
 *
 * Standardized on the Sessions layout system: a pinned `PageTopBar` (title +
 * summary counts + `FilterToolbar` + right-aligned actions) over a
 * `ListPageLayout` body — a dense FULL-WIDTH sortable `TargetsTable` as primary
 * content and the existing planner detail (`TargetDetailV2`) in the right-side
 * detail pane that mounts on selection.
 *
 * List side: loaded from the real `target.list` backend (gen-3
 * `canonical_target` table). No fixture data.
 *
 * My Targets | Planner filter (#91): a single-select FilterField in the top
 * bar replaces the old SegControl tab — "All targets" shows the Planner
 * catalog, "My Targets" filters to objects with linked sessions/projects
 * (stub: empty until task #54 backend linkage lands). Search, catalogue
 * multi-select, and group-by controls are present on BOTH views so the bar
 * stays consistent (#91). Row density follows the GLOBAL density
 * setting (the `density-*` class on <html>). Selecting a row puts its id in
 * `?selected=<uuid>` and the detail pane loads the full gen-3 detail from
 * SQLite.
 *
 * #103a: The page root carries `.alm-targets-page` so the layout fix scoped
 * to it ensures the virtualizer scroll container always gets a definite measured
 * height in Tauri/Windows WebView.
 *
 * #103b: Text search is whitespace/case-insensitive across the designation and
 * label — "M31", "M 31", and "m31" all resolve to the same target (the
 * normalizer collapses internal whitespace). Full alias resolution (e.g.
 * "Andromeda" → M31) needs the list endpoint to carry aliases and is blocked on
 * backend enrichment (#57/#93); the live `TargetListItem` has no aliases field.
 *
 * Spec 044:
 *   - Filter-by-filter: a "Filters" multi-select in the top bar lets the user
 *     narrow to targets whose mock-recommended filter set includes specific bands
 *     (e.g. show only targets where "Ha" is recommended tonight). MOCK — the
 *     filter recommendation is NOT astronomy (spec 044 §3).
 *   - Usable altitude threshold: loaded from localStorage via `useAltitudeThreshold`
 *     and passed to TargetsTable so imaging-time and visible-tonight react to the
 *     user's Settings → Target Planner preference without a page reload.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listTargets } from '@/api/commands';
import type { TargetListItem } from '@/api/commands';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { m } from '@/lib/i18n';
import { Btn, EmptyState } from '@/ui';
import { useGrouping } from '@/lib/use-grouping';
import { AddTargetDialog } from './AddTargetDialog';
import { TargetDetailV2 } from './TargetDetailV2';
import {
  filterByCatalogues,
  PLANNER_CATALOGS,
  type CatalogueId,
} from './planner-catalog';
import {
  DEFAULT_ENABLED_CATALOGUES,
  loadDefaultCatalogues,
} from './catalogue-settings';
import {
  TargetsTable,
  DEFAULT_TARGET_SORT,
} from './TargetsTable';
import type { TargetSort, TargetSortCol } from './TargetsTable';
import { rowAltitudeFor, type FilterBand } from './planner-altitude';
import { useAltitudeThreshold } from './altitude-settings';
import { useFavourites } from './useFavourites';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: TargetListItem[] };

/**
 * "My Targets" filter value (task #91, spec 043 §4).
 *
 * - '' (empty, "All") — show the full Planner catalog. Default so the page
 *   lands on something useful rather than the raw ~13k double-star dump.
 * - 'my' — objects with linked sessions/projects. That linkage is backend
 *   (task #54) and not yet available, so this filter shows a STUB empty state
 *   rather than fabricating data.
 */
const MY_TARGETS_VALUE = 'my';

/**
 * STUB: "My Targets" uses client-side localStorage favourites (useFavourites)
 * until the FITS OBJECT → target_id linkage (task #54) is wired in the
 * backend.  When #54 lands, replace this with a backend query for targets
 * that have linked sessions or projects.
 *
 * The constant below is kept as the fallback for the empty-favourite case
 * (no items starred) so the empty-state renders correctly.
 */
const MY_TARGETS_EMPTY: TargetListItem[] = [];

/** Multi-level grouping dimensions for the Planner top bar. */
const TARGETS_DIMENSIONS: FilterOption[] = [
  { value: 'catalogue', label: m.cmp_target_search_catalogue_label() },
  { value: 'type', label: m.targets_groupby_object_type() },
  { value: 'constellation', label: m.targets_dim_constellation() },
  { value: 'filters', label: m.targets_dim_applicable_filters() },
];

/** Catalogue multi-select options, in canonical display order. */
const CATALOGUE_OPTIONS: FilterOption[] = PLANNER_CATALOGS.map((c) => ({
  value: c.id,
  label: c.label(),
}));

/**
 * Normalize a designation or label for alias-aware matching (#103b).
 *
 * Collapses internal whitespace so "M31" and "M 31" become identical tokens
 * ("m31"). Case is folded to lower. This means "M31", "M 31", and "m 31" all
 * normalize to "m31" and match each other — the key astrophotography UX need
 * where catalog designations appear both spaced ("M 31") and compact ("M31").
 */
export function normalizeDesig(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * Alias-aware search (#103b, #29): tests whether a target row matches a query.
 *
 * Matching strategy:
 *  1. Normalized exact/prefix/substring match on the collapsed designation and
 *     label (so "M31" matches "M 31" and vice versa).
 *  2. Unnormalized substring on effectiveLabel for proper names
 *     ("Andromeda" substring of "Andromeda Galaxy").
 *  3. Normalized and unnormalized substring over each alias in `t.aliases`
 *     so a proper-name query ("Andromeda") resolves to M31 even when
 *     effectiveLabel is the bare designation. Backend now carries aliases
 *     on the list payload (backend task #29 / spec-043 alias enrichment).
 */
export function matchesSearch(t: TargetListItem, query: string): boolean {
  const qNorm = normalizeDesig(query);
  const qLower = query.toLowerCase();
  if (normalizeDesig(t.primaryDesignation).includes(qNorm)) return true;
  if (normalizeDesig(t.effectiveLabel).includes(qNorm)) return true;
  // Plain lowercase substring on effectiveLabel for proper names
  // ("andromeda" in "Andromeda Galaxy") without whitespace collapsing, since
  // proper names don't have the spaced-vs-compact ambiguity.
  if (t.effectiveLabel.toLowerCase().includes(qLower)) return true;
  // Search over all aliases carried on the list item (backend-enriched since #29).
  // Covers the "Andromeda" → M31 case where effectiveLabel is just "M 31".
  const aliases = t.aliases ?? [];
  for (const alias of aliases) {
    if (normalizeDesig(alias).includes(qNorm)) return true;
    if (alias.toLowerCase().includes(qLower)) return true;
  }
  return false;
}

/** My Targets filter options for the FilterToolbar single-select (#91). */
const MY_TARGETS_FILTER_OPTIONS: FilterOption[] = [
  { value: MY_TARGETS_VALUE, label: m.nav_my_targets() },
];

/**
 * Filter-by-filter options (spec 044, MOCK): all individual bands the user can
 * filter on. Broadband (LRGB) first, then narrowband (Ha/OIII/SII).
 *
 * Selecting one or more bands keeps only rows whose mock `filtersFor`
 * recommendation includes ALL selected bands. Example: selecting "Ha" + "OIII"
 * shows only rows where both are recommended — which in the simple mock means
 * any narrowband-possible target. MOCK — not astronomy.
 */
const FILTER_BAND_OPTIONS: FilterOption[] = [
  { value: 'L', label: m.targets_band_l_lum() },
  { value: 'R', label: m.targets_band_r() },
  { value: 'G', label: m.targets_band_g() },
  { value: 'B', label: m.targets_band_b() },
  { value: 'Ha', label: m.targets_band_ha() },
  { value: 'OIII', label: m.targets_band_oiii() },
  { value: 'SII', label: m.targets_band_sii() },
];

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });
  const [listState, setListState] = useState<ListState>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  /** '' = show full Planner catalog; 'my' = My Targets stub (#91). */
  const [myTargetsFilter, setMyTargetsFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TargetSort>(DEFAULT_TARGET_SORT);
  const { dims, setSlot } = useGrouping({
    storageKey: 'targets.grouping.dims.v1',
    validIds: ['catalogue', 'type', 'constellation', 'filters'],
    // defaultDims is empty: when no dims are selected the table falls back to
    // the legacy single-tier groupBy='catalogue' path which preserves the
    // sort-group ordering that the existing tests exercise.
    defaultDims: [],
  });
  // Catalogue multi-select: initialized from the persisted default-enabled
  // catalogues (Settings → Target Resolution), falling back to the in-code
  // default subset until that load resolves.
  const [enabledCatalogues, setEnabledCatalogues] = useState<CatalogueId[]>(
    () => [...DEFAULT_ENABLED_CATALOGUES],
  );
  /**
   * Filter-by-filter (spec 044, MOCK): selected bands. Empty = no band filter.
   * When non-empty, only targets whose mock filter recommendation includes ALL
   * selected bands are shown. NOT astronomy — mock per spec 044 §3.
   */
  const [filterBands, setFilterBands] = useState<FilterBand[]>([]);
  /**
   * User-configured usable-altitude threshold from Settings → Target Planner.
   * Subscribes to localStorage so updates in the Settings pane immediately
   * re-derive imaging-time and visible-tonight for every row.
   */
  const usableAltDeg = useAltitudeThreshold();

  /**
   * task #18: client-side favourite set.
   * STUB: stored in localStorage only until task #54 (backend linkage) lands.
   * See useFavourites.ts for the replacement contract.
   */
  const { favouriteIds, toggle: toggleFavourite } = useFavourites();

  useEffect(() => {
    let cancelled = false;
    loadDefaultCatalogues()
      .then((ids) => {
        if (!cancelled) setEnabledCatalogues(ids);
      })
      .catch(() => {
        // Keep the in-code default subset.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(() => {
    setListState({ status: 'loading' });
    listTargets()
      .then((items) => setListState({ status: 'loaded', items }))
      .catch(() => setListState({ status: 'error', message: m.targets_page_error_load() }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const clearSelection = useCallback(
    () => navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );

  const handleAdded = useCallback(
    (targetId: string) => {
      load();
      void navigate({ search: (prev) => ({ ...prev, selected: targetId }) });
    },
    [load, navigate],
  );

  const handleSort = useCallback((col: TargetSortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  }, []);

  // STUB: client-side catalog filter. Replace with a backend catalog filter on
  // the list endpoint (task #57) once `target.list` can filter server-side. The
  // catalogue multi-select (task #82) restricts to the user-selected subset.
  const plannerTargets = useMemo(
    () =>
      listState.status === 'loaded'
        ? filterByCatalogues(listState.items, new Set(enabledCatalogues))
        : [],
    [listState, enabledCatalogues],
  );

  /**
   * task #18: when "My Targets" is active, filter the Planner catalog to only
   * the targets the user has starred (stored client-side via useFavourites).
   * STUB: favouriteIds comes from localStorage only until task #54 lands and
   * provides real backend "has linked sessions/projects" data.
   */
  const tabTargets = useMemo(() => {
    if (myTargetsFilter !== MY_TARGETS_VALUE) return plannerTargets;
    if (favouriteIds.size === 0) return MY_TARGETS_EMPTY;
    return plannerTargets.filter((t) => favouriteIds.has(t.id));
  }, [myTargetsFilter, plannerTargets, favouriteIds]);

  const visibleTargets = useMemo(() => {
    const q = search.trim();
    let result = q ? tabTargets.filter((t) => matchesSearch(t, q)) : tabTargets;

    // Filter-by-filter (spec 044, MOCK): keep only targets whose mock filter
    // recommendation includes ALL selected bands. Each band check calls
    // rowAltitudeFor which is O(1) per target (no side effects, no fetch).
    // usableAltDeg is included in deps so threshold changes re-filter too.
    if (filterBands.length > 0) {
      result = result.filter((t) => {
        const { filters } = rowAltitudeFor(t, usableAltDeg);
        return filterBands.every((band) => filters.bands.includes(band));
      });
    }

    return result;
  }, [tabTargets, search, filterBands, usableAltDeg]);

  // Per the top-bar convention (task #80/#91): no title/summary in the bar —
  // the left nav names the page and per-page counts move to the status bar.
  // The My Targets filter, search, catalogue multi-select, and group-by ALL
  // remain visible on both the "All targets" and "My Targets" views so the
  // bar is consistent regardless of which view is active (#91 correction:
  // the bar must not collapse on tab switch).
  const isMyTargets = myTargetsFilter === MY_TARGETS_VALUE;
  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: m.targets_page_search_placeholder(),
            ariaLabel: m.targets_page_search_aria(),
          }}
          // My Targets filter (#91): single-select with implicit "All targets"
          // leading option that shows the full Planner catalog when selected.
          fields={[
            {
              key: 'myTargets',
              label: m.targets_filter_show_label(),
              value: myTargetsFilter,
              options: MY_TARGETS_FILTER_OPTIONS,
              onChange: setMyTargetsFilter,
              allLabel: m.targets_page_filter_all_targets(),
            },
          ]}
          // Catalogue multi-select, filter-by-filter, and group-by stay visible
          // on both views (#91: consistent filter bar). On My Targets the stub
          // list is empty so these filters have no effect yet, but the controls
          // remain so the bar doesn't shift layout on tab switch.
          multiFields={[
            {
              key: 'catalogues',
              label: m.targets_filter_catalogues_label(),
              value: enabledCatalogues,
              options: CATALOGUE_OPTIONS,
              onChange: (v) => setEnabledCatalogues(v as CatalogueId[]),
            },
            {
              // Filter-by-filter (spec 044, MOCK): narrow to targets whose
              // mock-recommended filter set includes ALL selected bands.
              // NOT astronomy — see planner-altitude.ts for the mock rule.
              key: 'filterBands',
              label: m.common_filters(),
              value: filterBands,
              options: FILTER_BAND_OPTIONS,
              onChange: (v) => setFilterBands(v as FilterBand[]),
            },
          ]}
          grouping={{
            dimensions: TARGETS_DIMENSIONS,
            dims,
            setSlot,
          }}
        />
      }
      actions={
        // "Add target" is a page-level action (creates a new catalog object).
        // Per-item actions ("+ New project here") live in TargetDetailV2's
        // detail body, not the top bar.
        <Btn size="sm" onClick={() => setAddOpen(true)}>{m.targets_add_target()}</Btn>
      }
    />
  );

  return (
    // .alm-targets-page scopes the layout fix from targets-fixes.css (#103a):
    // the virtualizer scroll container gets a definite measured height in the
    // Tauri/Windows WebView by overriding .alm-listpage__main to overflow:hidden
    // and positioning .alm-targets-table__wrap absolutely within it.
    <div className="alm-targets-page">
      <AddTargetDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={handleAdded} />
      <ListPageLayout
        topBar={topBar}
        detail={
          selected ? (
            <TargetDetailV2
              targetId={selected}
              item={plannerTargets.find((t) => t.id === selected) ?? null}
              usableAltDeg={usableAltDeg}
            />
          ) : undefined
        }
        onCloseDetail={selected ? clearSelection : undefined}
        detailLabel="Target details"
      >
        {listState.status === 'error' ? (
          <EmptyState title={m.settings_advanced_log_error()} desc={listState.message} />
        ) : (
          <TargetsTable
            targets={visibleTargets}
            selected={selected ?? null}
            onSelect={onSelect}
            loading={listState.status === 'loading'}
            sort={sort}
            onSort={handleSort}
            dims={dims}
            usableAltDeg={usableAltDeg}
            // task #18: pass the local favourite set down so the star column renders correctly.
            // STUB: localStorage only until task #54 backend linkage lands.
            favouriteIds={favouriteIds}
            onToggleFavourite={toggleFavourite}
            emptyMessage={
              isMyTargets
                ? favouriteIds.size === 0
                  // No stars yet — nudge the user to star something.
                  ? m.targets_page_my_targets_no_favs()
                  // Stars exist but filters excluded them all.
                  : m.targets_page_my_targets_no_match()
                : m.targets_page_no_match()
            }
          />
        )}
      </ListPageLayout>
    </div>
  );
}
