import { useNavigate, useSearch } from '@tanstack/react-router';
import { TARGETS_DATA } from '@/data/fixtures/targets';
import type { TargetFixture } from '@/data/fixtures/targets';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { TargetList } from './TargetList';
import { TargetDetailPaneInline } from './TargetDetail';

export function TargetsPage() {
  const { selected } = useSearch({ from: '/shell/targets' });
  const navigate = useNavigate({ from: '/targets' });
  const target: TargetFixture | null = TARGETS_DATA.find((t) => t.id === selected) ?? null;

  useStaleSelectionCleanup(selected, target !== null, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Targets"
            subtitle={`${TARGETS_DATA.length} targets`}
            right={
              target ? (
                <>
                  <Btn size="sm" variant="primary">New project</Btn>
                  <Btn size="sm">Edit aliases</Btn>
                  <Btn size="sm">Link plan</Btn>
                </>
              ) : (
                <Btn size="sm">Add target</Btn>
              )
            }
          />
        }
        list={<TargetList targets={TARGETS_DATA} selected={selected ?? null} onSelect={onSelect} />}
        detail={<TargetDetailPaneInline target={target} />}
      />
    </PageShell>
  );
}
