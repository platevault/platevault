/**
 * TargetsPage — spec 043 shared list-page adoption (task #73).
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
 * #103a: The page root carries `.alm-targets-page` so targets-fixes.css can
 * scope the layout fix that ensures the virtualizer scroll container always
 * gets a definite measured height in Tauri/Windows WebView.
 *
 * #103b: Text search is whitespace/case-insensitive across the designation and
 * label — "M31", "M 31", and "m31" all resolve to the same target (the
 * normalizer collapses internal whitespace). Full alias resolution (e.g.
 * "Andromeda" → M31) needs the list endpoint to carry aliases and is blocked on
 * backend enrichment (#57/#93); the live `TargetListItem` has no aliases field.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listTargets } from '@/api/commands';
import type { TargetListItem } from '@/api/commands';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { Btn, EmptyState } from '@/ui';
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
  DEFAULT_TARGET_GROUP_BY,
} from './TargetsTable';
import type { TargetSort, TargetSortCol, TargetGroupBy } from './TargetsTable';

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
 * STUB: "My Targets" needs the FITS OBJECT → target_id linkage (task #54) to
 * know which targets actually have sessions/projects. That linkage does not
 * exist yet, so this is empty rather than fabricating coverage. Module-level
 * constant so the empty list keeps a stable identity across renders.
 */
const MY_TARGETS_STUB: TargetListItem[] = [];

/** Group-by options for the Planner top bar (mirrors the other list pages). */
const GROUP_BY_OPTIONS: FilterOption[] = [
  { value: 'catalogue', label: 'Catalogue' },
  { value: 'type', label: 'Object type' },
];

/** Catalogue multi-select options, in canonical display order. */
const CATALOGUE_OPTIONS: FilterOption[] = PLANNER_CATALOGS.map((c) => ({
  value: c.id,
  label: c.label,
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
 * Alias-aware search (#103b): tests whether a target row matches a query.
 *
 * Matching strategy:
 *  1. Normalized exact/prefix/substring match on the collapsed designation and
 *     label (so "M31" matches "M 31" and vice versa).
 *  2. Unnormalized substring on effectiveLabel for free-text names
 *     ("Andromeda" substring of "Andromeda Galaxy").
 *
 * `TargetListItem` carries no aliases field (aliases live on the detail
 * endpoint only). Backend alias search is tracked in task #93.
 */
export function matchesSearch(t: TargetListItem, query: string): boolean {
  const qNorm = normalizeDesig(query);
  if (normalizeDesig(t.primaryDesignation).includes(qNorm)) return true;
  if (normalizeDesig(t.effectiveLabel).includes(qNorm)) return true;
  // Also allow a plain lowercase substring on effectiveLabel for proper names
  // ("andromeda" in "Andromeda Galaxy") without whitespace collapsing, since
  // proper names don't have the spaced-vs-compact ambiguity.
  if (t.effectiveLabel.toLowerCase().includes(query.toLowerCase())) return true;
  return false;
}

/** My Targets filter options for the FilterToolbar single-select (#91). */
const MY_TARGETS_FILTER_OPTIONS: FilterOption[] = [
  { value: MY_TARGETS_VALUE, label: 'My Targets' },
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
  const [groupBy, setGroupBy] = useState<TargetGroupBy>(DEFAULT_TARGET_GROUP_BY);
  // Catalogue multi-select: initialized from the persisted default-enabled
  // catalogues (Settings → Target Resolution), falling back to the in-code
  // default subset until that load resolves.
  const [enabledCatalogues, setEnabledCatalogues] = useState<CatalogueId[]>(
    () => [...DEFAULT_ENABLED_CATALOGUES],
  );

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
      .catch(() => setListState({ status: 'error', message: 'Failed to load targets.' }));
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

  /** When the My Targets filter is active show the stub; otherwise the Planner catalog. */
  const tabTargets = myTargetsFilter === MY_TARGETS_VALUE ? MY_TARGETS_STUB : plannerTargets;

  const visibleTargets = useMemo(() => {
    const q = search.trim();
    return q ? tabTargets.filter((t) => matchesSearch(t, q)) : tabTargets;
  }, [tabTargets, search]);

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
            placeholder: 'Search targets...',
            ariaLabel: 'Search targets',
          }}
          // My Targets filter (#91): single-select with implicit "All targets"
          // leading option that shows the full Planner catalog when selected.
          fields={[
            {
              key: 'myTargets',
              label: 'Show',
              value: myTargetsFilter,
              options: MY_TARGETS_FILTER_OPTIONS,
              onChange: setMyTargetsFilter,
              allLabel: 'All targets',
            },
          ]}
          // Catalogue multi-select and group-by stay visible on both views
          // (#91: consistent filter bar). On My Targets the stub list is empty
          // so the catalogue filter has no effect yet, but the control remains
          // so the bar doesn't shift layout on tab switch.
          multiFields={[
            {
              key: 'catalogues',
              label: 'Catalogues',
              value: enabledCatalogues,
              options: CATALOGUE_OPTIONS,
              onChange: (v) => setEnabledCatalogues(v as CatalogueId[]),
            },
          ]}
          groupBy={{
            value: groupBy,
            options: GROUP_BY_OPTIONS,
            onChange: (v) => setGroupBy(v as TargetGroupBy),
          }}
        />
      }
      actions={
        // "Add target" is a page-level action (creates a new catalog object).
        // Per-item actions ("+ New project here") live in TargetDetailV2's
        // detail body, not the top bar.
        <Btn size="sm" onClick={() => setAddOpen(true)}>Add target</Btn>
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
        detail={selected ? <TargetDetailV2 targetId={selected} /> : undefined}
        onCloseDetail={selected ? clearSelection : undefined}
        detailLabel="Target details"
      >
        {listState.status === 'error' ? (
          <EmptyState title="Error" desc={listState.message} />
        ) : (
          <TargetsTable
            targets={visibleTargets}
            selected={selected ?? null}
            onSelect={onSelect}
            loading={listState.status === 'loading'}
            sort={sort}
            onSort={handleSort}
            groupBy={groupBy}
            emptyMessage={
              isMyTargets
                ? "No targets with sessions yet. Targets appear here once your captured frames are linked to a catalog object — that linkage isn't wired up yet. Switch to 'All targets' to find an object and start a project."
                : 'No catalog targets match the current filters.'
            }
          />
        )}
      </ListPageLayout>
    </div>
  );
}
