// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { TargetListItem } from '@/bindings/index';
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
import { TargetsTable, DEFAULT_TARGET_SORT } from './TargetsTable';
import type { TargetSort, TargetSortCol } from './TargetsTable';
import { useAltitudeThreshold } from './altitude-settings';
import { useFavourites } from './useFavourites';
import { useObservingNight } from './astro/observing-night';
import { computeObservingNight, type ObservingNight } from './astro/moon-state';
import { useObserverSiteExists } from './site-gate';
import { MoonSummary } from './MoonSummary';
import { PlannerDatePicker } from './PlannerDatePicker';
import { PlannerComputedFor } from './PlannerComputedFor';
import { useGuidanceParams, loadGuidanceParams } from './guidance-settings';
import { usePlannerSensorConfig } from './planner-sensor';
import { deriveRowMoonPlanning } from './astro/row-planning';
import { recommendationLabel } from './FilterBadges';
import type { Recommendation } from './astro/moon-avoidance';

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
// Render-time factory (spec 046 #8b) so labels re-read the active locale.
const TARGETS_DIMENSIONS = (): FilterOption[] => [
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
// Render-time factory (spec 046 #8b) so the label re-reads the active locale.
const MY_TARGETS_FILTER_OPTIONS = (): FilterOption[] => [
  { value: MY_TARGETS_VALUE, label: m.nav_my_targets() },
];

/**
 * Filter-by-recommendation options (spec 047 US3, FR-011): the real derived
 * recommendation categories. Selecting one or more keeps only rows whose
 * REAL `deriveRowMoonPlanning` recommendation matches a selected category —
 * replaces the former spec 044 mock per-band filter.
 */
// Render-time factory (spec 046 #8b) so labels re-read the active locale.
const RECOMMENDATION_FILTER_OPTIONS = (): FilterOption[] => [
  { value: 'broadband-ok', label: recommendationLabel('broadband-ok') },
  { value: 'narrowband-only', label: recommendationLabel('narrowband-only') },
  { value: 'avoid-tonight', label: recommendationLabel('avoid-tonight') },
  { value: 'unknown', label: recommendationLabel('unknown') },
];

/**
 * Progressive-reveal chunk size for the Planner catalogue load (#573). See
 * the `revealCount` effects below for why: TargetsTable's per-row astronomy
 * pass over the WHOLE catalogue synchronously on first render froze the app,
 * so `TargetsPage` grows what it feeds TargetsTable in chunks of this size
 * instead of handing over the full (possibly ~13k-row) set at once.
 */
const REVEAL_CHUNK = 300;

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
   * Filter-by-recommendation (spec 047 US3, FR-011): selected recommendation
   * categories. Empty = no filter. When non-empty, only targets whose REAL
   * derived recommendation matches one of the selected categories are shown.
   */
  const [filterRecommendations, setFilterRecommendations] = useState<
    Recommendation[]
  >([]);
  /**
   * User-configured usable-altitude threshold from Settings → Target Planner.
   * Subscribes to localStorage so updates in the Settings pane immediately
   * re-derive imaging-time and visible-tonight for every row.
   */
  const usableAltDeg = useAltitudeThreshold();

  /**
   * Site gate (spec 047 D7): the planner renders no astronomy until a default
   * observing site exists. Track B (spec 044/048) owns the ObserverSite key;
   * until it lands `useObserverSiteExists()` returns false and the planner bar
   * shows the "set up your observing site" prompt instead of the Moon summary.
   */
  const siteExists = useObserverSiteExists();
  /**
   * The observing-night anchor, re-checked on focus / hourly (spec 047 D1).
   * Memoized to one `ObservingNight` per `nightKey` so the Moon state is
   * computed once per night and reused by the table rows (US2/US3), and nothing
   * flips at local midnight mid-session (FR-005, SC-007).
   */
  const nightAnchor = useObservingNight();
  const night = useMemo<ObservingNight | null>(
    () => (siteExists ? computeObservingNight(nightAnchor) : null),
    // nightAnchor identity is stable per nightKey; guard on the key + gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nightAnchor.nightKey, siteExists],
  );
  /**
   * Live per-band Moon-avoidance params (spec 047 US3, Settings → Target
   * Planner). Subscribes so filter-by-recommendation and the table's pills
   * recompute immediately on a settings change (SC-008).
   */
  const guidanceParams = useGuidanceParams();
  // FR-036/T046: OSC single-pass model when equipment is unambiguously OSC;
  // null (mono/unknown) keeps the per-filter model unchanged (FR-038).
  const sensorConfig = usePlannerSensorConfig();

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

  // spec 047 T017: hydrate the live per-band Moon-avoidance params cache from
  // the backend on mount (Settings → Target Planner writes update the same
  // cache live via useGuidanceParams — SC-008). Without this the planner would
  // silently keep showing shipped defaults after a restart until the user
  // re-saved a value.
  useEffect(() => {
    void loadGuidanceParams();
  }, []);

  const load = useCallback(() => {
    setListState({ status: 'loading' });
    commands
      .targetList()
      .then(unwrap)
      .then((items) => setListState({ status: 'loaded', items }))
      .catch(() =>
        setListState({ status: 'error', message: m.targets_page_error_load() }),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Progressive reveal of the Planner catalogue (#573): `commands.targetList()`
   * IPC-loads every target at once (thousands of rows), and TargetsTable's
   * per-row astronomy pass over the WHOLE set synchronously on first render is
   * what froze the app on open. Capping what reaches TargetsTable to a small
   * first chunk, then growing it in the background via `setTimeout` (a real
   * macrotask boundary, so the browser gets to paint/handle input between
   * chunks) keeps the page interactive immediately. TargetsTable's per-target-
   * id row cache (see its module doc) means each growth step only pays for the
   * newly-revealed delta, not the whole set again — so total work stays
   * roughly linear in catalogue size instead of blocking once, all at once.
   * Resets to the first chunk on every fresh `load()` (mount + "Add target").
   */
  const [revealCount, setRevealCount] = useState(REVEAL_CHUNK);

  useEffect(() => {
    if (listState.status === 'loading') setRevealCount(REVEAL_CHUNK);
  }, [listState.status]);

  useEffect(() => {
    if (listState.status !== 'loaded') return;
    const total = listState.items.length;
    if (revealCount >= total) return;
    const handle = setTimeout(() => {
      setRevealCount((n) => Math.min(n + REVEAL_CHUNK, total));
    }, 0);
    return () => clearTimeout(handle);
  }, [listState, revealCount]);

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const clearSelection = useCallback(
    () =>
      navigate({
        search: (prev) => ({ ...prev, selected: undefined }),
        replace: true,
      }),
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
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' },
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
   * #573: the "All targets" view is what the progressive reveal caps — a
   * prefix slice of the full filtered catalogue, growing via `revealCount`.
   * Order is the raw fetch order (not the user's chosen sort — TargetsTable
   * sorts whatever it's given), so this only affects which rows exist during
   * the brief initial-load window, not final correctness once fully loaded.
   */
  const revealedPlannerTargets = useMemo(
    () => plannerTargets.slice(0, revealCount),
    [plannerTargets, revealCount],
  );

  /**
   * task #18: when "My Targets" is active, filter the Planner catalog to only
   * the targets the user has starred (stored client-side via useFavourites).
   * STUB: favouriteIds comes from localStorage only until task #54 lands and
   * provides real backend "has linked sessions/projects" data.
   *
   * Uses the FULL `plannerTargets` (not the progressive-reveal slice, #573):
   * favourites are a small set regardless of catalogue size, so there's no
   * perf reason to cap it, and capping it would make a starred target
   * transiently vanish from "My Targets" until reveal catches up to it.
   */
  const tabTargets = useMemo(() => {
    if (myTargetsFilter !== MY_TARGETS_VALUE) return revealedPlannerTargets;
    if (favouriteIds.size === 0) return MY_TARGETS_EMPTY;
    return plannerTargets.filter((t) => favouriteIds.has(t.id));
  }, [myTargetsFilter, revealedPlannerTargets, plannerTargets, favouriteIds]);

  const visibleTargets = useMemo(() => {
    const q = search.trim();
    let result = q ? tabTargets.filter((t) => matchesSearch(t, q)) : tabTargets;

    // Filter-by-recommendation (spec 047 US3, FR-011): keep only targets whose
    // REAL derived recommendation is one of the selected categories.
    // deriveRowMoonPlanning is O(1) per target (pure, no fetch); night/params
    // are included in deps so a settings change or the nightly Moon state
    // re-filters too.
    if (filterRecommendations.length > 0) {
      const selected = new Set(filterRecommendations);
      result = result.filter((t) => {
        const { recommendation } = deriveRowMoonPlanning(
          t,
          night,
          guidanceParams,
        );
        return selected.has(recommendation);
      });
    }

    return result;
  }, [tabTargets, search, filterRecommendations, night, guidanceParams]);

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
              options: MY_TARGETS_FILTER_OPTIONS(),
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
              // Filter-by-recommendation (spec 047 US3, FR-011): narrow to
              // targets whose REAL derived recommendation category is
              // selected — includes an explicit "unknown" choice (FR-013).
              key: 'filterRecommendations',
              label: m.common_filters(),
              value: filterRecommendations,
              options: RECOMMENDATION_FILTER_OPTIONS(),
              onChange: (v) => setFilterRecommendations(v as Recommendation[]),
            },
          ]}
          grouping={{
            dimensions: TARGETS_DIMENSIONS(),
            dims,
            setSlot,
          }}
        />
      }
      actions={
        // "Add target" is a page-level action (creates a new catalog object).
        // Per-item actions ("+ New project here") live in TargetDetailV2's
        // detail body, not the top bar.
        //
        // Planner astronomy (spec 047): tonight's Moon summary sits left of the
        // action, gated behind a default observing site (D7). Until a site
        // exists the slot shows the set-up-your-site prompt.
        <>
          {/* FR-033/T043: always-visible computation-context label — the one
              place disclosing site/twilight/threshold behind every number. */}
          <PlannerComputedFor usableAltDeg={usableAltDeg} />
          {/* US2/T024: plan an arbitrary future night — every table/detail
              computation reads this chosen date (SC-004). */}
          <PlannerDatePicker />
          {night ? (
            <MoonSummary night={night} />
          ) : (
            <div
              className="alm-planner-site-prompt"
              data-testid="planner-site-prompt"
            >
              <span className="alm-planner-site-prompt__title">
                {m.targets_planner_site_prompt_title()}
              </span>
              <span className="alm-planner-site-prompt__desc">
                {m.targets_planner_site_prompt_desc()}
              </span>
            </div>
          )}
          <Btn size="sm" onClick={() => setAddOpen(true)}>
            {m.targets_add_target()}
          </Btn>
        </>
      }
    />
  );

  return (
    // .alm-targets-page scopes the layout fix from targets-fixes.css (#103a):
    // the virtualizer scroll container gets a definite measured height in the
    // Tauri/Windows WebView by overriding .alm-listpage__main to overflow:hidden
    // and positioning .alm-targets-table__wrap absolutely within it.
    <div className="alm-targets-page">
      <AddTargetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleAdded}
      />
      <ListPageLayout
        topBar={topBar}
        detail={
          selected ? (
            <TargetDetailV2
              targetId={selected}
              item={plannerTargets.find((t) => t.id === selected) ?? null}
              usableAltDeg={usableAltDeg}
              night={night}
              sensorConfig={sensorConfig}
            />
          ) : undefined
        }
        onCloseDetail={selected ? clearSelection : undefined}
        detailLabel="Target details"
      >
        {listState.status === 'error' ? (
          <EmptyState
            title={m.settings_advanced_log_error()}
            desc={listState.message}
          />
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
            // spec 047: the memoized observing night (null when no site) drives
            // real per-row lunar distance / filter guidance / opposition (US2+).
            night={night}
            // Live per-band Moon-avoidance params (US3, SC-008): edits in
            // Settings → Target Planner recompute pills/recommendation here
            // without a restart.
            guidanceParams={guidanceParams}
            // FR-036: OSC single-pass headline when equipment is OSC.
            sensorConfig={sensorConfig}
            // task #18: pass the local favourite set down so the star column renders correctly.
            // STUB: localStorage only until task #54 backend linkage lands.
            favouriteIds={favouriteIds}
            onToggleFavourite={toggleFavourite}
            emptyMessage={
              isMyTargets
                ? favouriteIds.size === 0
                  ? // No stars yet — nudge the user to star something.
                    m.targets_page_my_targets_no_favs()
                  : // Stars exist but filters excluded them all.
                    m.targets_page_my_targets_no_match()
                : m.targets_page_no_match()
            }
          />
        )}
      </ListPageLayout>
    </div>
  );
}
