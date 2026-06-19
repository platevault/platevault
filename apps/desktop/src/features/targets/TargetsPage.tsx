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

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listTargets } from '@/api/commands';
import type { TargetListItem } from '@/api/commands';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { TargetList } from './TargetList';
import { TargetDetailV2 } from './TargetDetailV2';
import { AddTargetDialog } from './AddTargetDialog';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: TargetListItem[] };

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });
  const [listState, setListState] = useState<ListState>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);

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

  const targets = listState.status === 'loaded' ? listState.items : [];
  const count = listState.status === 'loaded' ? listState.items.length : '…';

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
            subtitle={`${count} targets`}
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
          listState.status === 'error' ? (
            <EmptyState title="Error" desc={listState.message} />
          ) : (
            <TargetList
              targets={targets}
              selected={selected ?? null}
              onSelect={onSelect}
            />
          )
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
