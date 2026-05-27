import { useState } from 'react';
import { TARGETS_DATA } from '@/data/fixtures/targets';
import type { TargetFixture } from '@/data/fixtures/targets';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import { TargetList } from './TargetList';
import { TargetDetailPaneInline } from './TargetDetail';

export function TargetsPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const target: TargetFixture | null = TARGETS_DATA.find(t => t.id === selected) ?? null;

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Targets"
            subtitle={`${TARGETS_DATA.length} targets`}
            right={<Btn variant="accent">New project</Btn>}
          />
        }
        list={<TargetList targets={TARGETS_DATA} selected={selected} onSelect={setSelected} />}
        detail={<TargetDetailPaneInline target={target} />}
      />
    </PageShell>
  );
}
