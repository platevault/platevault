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
 * (planner-catalog.ts) and the density toggle are preserved; density now lives
 * in the FilterToolbar. Selecting a row puts its id in `?selected=<uuid>` and
 * the detail pane loads the full gen-3 detail from SQLite.
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
import { filterPlannerCatalog } from './planner-catalog';
import {
  TargetsTable,
  DEFAULT_TARGET_SORT,
  DEFAULT_TARGET_DENSITY,
} from './TargetsTable';
import type { TargetSort, TargetSortCol, TargetDensity } from './TargetsTable';

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

const DENSITY_OPTIONS: FilterOption[] = [
  { value: 'Dense', label: 'Dense' },
  { value: 'Rich', label: 'Rich' },
];

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
  const [density, setDensity] = useState<TargetDensity>(DEFAULT_TARGET_DENSITY);

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
  // the list endpoint (task #57) once `target.list` can filter server-side.
  const plannerTargets = useMemo(
    () => (listState.status === 'loaded' ? filterPlannerCatalog(listState.items) : []),
    [listState],
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
          actions={
            <label className="alm-targets-density">
              <span className="alm-targets-density__label">Density</span>
              <select
                className="alm-filterbar__select"
                value={density}
                onChange={(e) => setDensity(e.target.value as TargetDensity)}
                aria-label="Row density"
              >
                {DENSITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
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
            density={density}
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
