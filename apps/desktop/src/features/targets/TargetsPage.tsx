/**
 * TargetsPage — spec 023 wired list+detail layout.
 *
 * List side: fixture data (TARGETS_DATA) — the legacy `targets.list` Tauri
 * command returns the spec-029 stub shape (Target), not spec-023 TargetIdentity.
 * Migrating the list to the backend is a follow-up once a spec-023
 * `target.list` command is added; keeping the list on fixtures here is
 * intentional and documented.
 *
 * Detail side: fully wired to the real `target.get` backend via TargetDetailV2.
 * Selecting any list item puts its UUID in `?selected=<uuid>` and the detail
 * loads identity + aliases + catalog refs + notes from SQLite.
 *
 * The Cmd+K palette navigates directly to `/targets/$id` which redirects to
 * this page with `?selected=<uuid>` (see router.tsx targetDetailRoute).
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { TARGETS_DATA } from '@/data/fixtures/targets';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { TargetList } from './TargetList';
import { TargetDetailV2 } from './TargetDetailV2';

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });

  // `selected` is now a UUID string (spec 023). Verify it matches a known
  // fixture entry so stale links from a different library are cleaned up.
  const isKnownTarget = selected != null && TARGETS_DATA.some((t) => t.uuid === selected);

  useStaleSelectionCleanup(selected, isKnownTarget, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (uuid: string) => navigate({ search: (prev) => ({ ...prev, selected: uuid }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Targets"
            subtitle={`${TARGETS_DATA.length} targets`}
            right={
              selected ? (
                <Btn size="sm" variant="primary">New project</Btn>
              ) : (
                <Btn size="sm">Add target</Btn>
              )
            }
          />
        }
        list={
          <TargetList
            targets={TARGETS_DATA}
            selected={selected ?? null}
            onSelect={onSelect}
          />
        }
        detail={
          selected ? (
            <TargetDetailV2 targetId={selected} />
          ) : (
            <EmptyState
              title="Select a target"
              desc="Choose a target from the list to view its identity, aliases, notes, and history."
            />
          )
        }
      />
    </PageShell>
  );
}
