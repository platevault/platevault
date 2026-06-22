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
 * The My Targets | Planner split (task #40) is preserved — the segmented tab
 * control renders in the top bar. The Planner catalog restriction
 * (planner-catalog.ts) is preserved and now exposes a catalogue multi-select
 * filter plus a group-by control (task #82), both Planner-only. Row density
 * follows the GLOBAL density setting (the `density-*` class on <html>); the old
 * per-page density toggle is gone. Selecting a row puts its id in
 * `?selected=<uuid>` and the detail pane loads the full gen-3 detail from SQLite.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listTargets } from '@/api/commands';
import type { TargetListItem } from '@/api/commands';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { Btn, EmptyState, SegControl } from '@/ui';
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
 * Targets tab split (task #40, spec 043 §4).
 *
 * - "Planner" — search a RESTRICTED catalog (Messier/NGC/IC/Sh2/LBN/LDN/
 *   Caldwell/Barnard) to find a new object and start a project. Default tab so
 *   the page lands on something useful instead of the raw ~13k double-star dump.
 * - "My Targets" — objects that actually have linked sessions/projects. That
 *   linkage is backend (task #54) and not yet available, so the tab renders a
 *   STUB empty state rather than fabricating data.
 */
type TargetsTab = 'My Targets' | 'Planner';
const TABS: TargetsTab[] = ['My Targets', 'Planner'];

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

/** Client-side text search across the fields the list endpoint provides. */
function matchesSearch(t: TargetListItem, query: string): boolean {
  const q = query.toLowerCase();
  return (
    t.primaryDesignation.toLowerCase().includes(q) ||
    t.effectiveLabel.toLowerCase().includes(q)
  );
}

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });
  const [listState, setListState] = useState<ListState>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<TargetsTab>('Planner');
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

  const tabTargets = tab === 'Planner' ? plannerTargets : MY_TARGETS_STUB;

  const visibleTargets = useMemo(() => {
    const q = search.trim();
    return q ? tabTargets.filter((t) => matchesSearch(t, q)) : tabTargets;
  }, [tabTargets, search]);

  // Per the top-bar convention (task #80): no title/summary in the bar — the
  // left nav names the page and per-page counts move to the status bar. The
  // segmented My Targets/Planner tabs read as the bar's lead control.
  const topBar = (
    <PageTopBar
      title={
        <SegControl
          options={TABS}
          value={tab}
          onChange={(v) => setTab(v as TargetsTab)}
          aria-label="Targets view"
        />
      }
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Search targets...',
            ariaLabel: 'Search targets',
          }}
          // Catalogue multi-select + group-by are Planner-only controls; the
          // My Targets tab is a stub list with nothing to filter/group yet.
          multiFields={
            tab === 'Planner'
              ? [
                  {
                    key: 'catalogues',
                    label: 'Catalogues',
                    value: enabledCatalogues,
                    options: CATALOGUE_OPTIONS,
                    onChange: (v) => setEnabledCatalogues(v as CatalogueId[]),
                  },
                ]
              : undefined
          }
          groupBy={
            tab === 'Planner'
              ? {
                  value: groupBy,
                  options: GROUP_BY_OPTIONS,
                  onChange: (v) => setGroupBy(v as TargetGroupBy),
                }
              : undefined
          }
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
    <>
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
              tab === 'My Targets'
                ? "No targets with sessions yet. Targets appear here once your captured frames are linked to a catalog object — that linkage isn't wired up yet. Use the Planner to find an object and start a project."
                : 'No catalog targets match the current filters.'
            }
          />
        )}
      </ListPageLayout>
    </>
  );
}
