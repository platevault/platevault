/**
 * TargetsPage — spec 036 gen-3 list+detail layout.
 *
 * List side: loaded from the real `target.list` backend (gen-3
 * `canonical_target` table). No fixture data — the legacy `TARGETS_DATA`
 * fixture and the `targets.list` stub command are retired by spec 036.
 *
 * Detail side: wired to `target.get` (gen-3) via TargetDetailV2.
 * Selecting any list item puts its id in `?selected=<uuid>` and the detail
 * pane loads the full gen-3 TargetDetailV3 from SQLite.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listTargets } from '@/api/commands';
import type { TargetListItem } from '@/api/commands';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState, SegControl } from '@/ui';
import { TargetList } from './TargetList';
import { TargetDetailV2 } from './TargetDetailV2';
import { AddTargetDialog } from './AddTargetDialog';
import { filterPlannerCatalog } from './planner-catalog';

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
 *   STUB teaching/empty state rather than fabricating data.
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

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });
  const [listState, setListState] = useState<ListState>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<TargetsTab>('Planner');

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

  const handleAdded = useCallback(
    (targetId: string) => {
      load();
      void navigate({ search: (prev) => ({ ...prev, selected: targetId }) });
    },
    [load, navigate],
  );

  // STUB: client-side catalog filter. Replace with a backend catalog filter on
  // the list endpoint (task #57) once `target.list` can filter server-side.
  const plannerTargets = useMemo(
    () => (listState.status === 'loaded' ? filterPlannerCatalog(listState.items) : []),
    [listState],
  );

  const visibleTargets = tab === 'Planner' ? plannerTargets : MY_TARGETS_STUB;
  const count = listState.status === 'loaded' ? visibleTargets.length : '…';
  const countLabel = tab === 'Planner' ? 'catalog targets' : 'with sessions';

  return (
    <PageShell>
      <AddTargetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleAdded}
      />
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Targets"
            subtitle={`${count} ${countLabel}`}
            right={
              selected ? (
                <Btn size="sm" variant="primary">New project</Btn>
              ) : (
                <Btn size="sm" onClick={() => setAddOpen(true)}>Add target</Btn>
              )
            }
          />
        }
        list={
          <div className="alm-targets-list">
            <div className="alm-targets-list__tabs">
              <SegControl
                options={TABS}
                value={tab}
                onChange={(v) => setTab(v as TargetsTab)}
                aria-label="Targets view"
              />
            </div>
            {listState.status === 'error' ? (
              <EmptyState title="Error" desc={listState.message} />
            ) : tab === 'My Targets' && visibleTargets.length === 0 ? (
              /* STUB: no FITS OBJECT → target_id linkage yet (task #54). */
              <EmptyState
                title="No targets with sessions yet"
                desc="Targets appear here once your captured frames are linked to a catalog object. That linkage isn't wired up yet — use the Planner to find an object and start a project."
              />
            ) : (
              <TargetList
                targets={visibleTargets}
                selected={selected ?? null}
                onSelect={onSelect}
              />
            )}
          </div>
        }
        detail={
          selected ? (
            <TargetDetailV2 targetId={selected} />
          ) : (
            <EmptyState
              title="Select a target"
              desc="Choose a target from the list to view its identity, aliases, and coordinates."
            />
          )
        }
      />
    </PageShell>
  );
}
